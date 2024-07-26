import WebSocket from 'ws';
import { Keypair, PublicKey, Connection, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL, SendTransactionError } from '@solana/web3.js';
import inquirer from 'inquirer';
import bs58 from 'bs58';
import { log } from './logger.js';
import { loadExistingData, saveTargetAddresses, clearTargetAddresses, appendToMonitoredFile, similarAddresses } from './data.js';
import { settings } from './settings.js';

const RPC_URL = 'RPC_URL_HERE';
const connection = new Connection(RPC_URL, 'confirmed');

const MAIN_WALLET_SECRET_KEY = 'PRIVATE_KEY_HERE';
const mainWalletKeypair = Keypair.fromSecretKey(bs58.decode(MAIN_WALLET_SECRET_KEY));
const EXCLUDED_ADDRESSES = [
    'Vote111111111111111111111111111111111111111', 
    'SysvarStakeHistory1111111111111111111111111', 
    'Stake11111111111111111111111111111111111111', 
    'SysvarC1ock11111111111111111111111111111111',
    'ComputeBudget111111111111111111111111111111', 
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 
    '11111111111111111111111111111111',
];

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const fetchWalletBalance = async (publicKey) => {
    try {
        const balanceLamports = await connection.getBalance(new PublicKey(publicKey), 'confirmed');
        return balanceLamports / LAMPORTS_PER_SOL;
    } catch (error) {
        log('CRITICAL', `Error fetching wallet balance for ${publicKey}: ${error.message}`);
        return null;
    }
};

const fetchGeneratedWalletBalance = async (publicKey) => {
    return await fetchWalletBalance(publicKey);
};

const fetchMainWalletBalance = async () => {
    return await fetchWalletBalance(mainWalletKeypair.publicKey);
};

const fundGeneratedWallet = async (generatedKeypair, amount) => {
    const transaction = new Transaction().add(SystemProgram.transfer({
        fromPubkey: mainWalletKeypair.publicKey,
        toPubkey: generatedKeypair.publicKey,
        lamports: amount
    }));
    await sendAndConfirmTransaction(connection, transaction, [mainWalletKeypair], { commitment: 'confirmed' });
    log('INFO', `Funded generated wallet: ${generatedKeypair.publicKey.toBase58()} with ${amount / LAMPORTS_PER_SOL} SOL`);
};

const returnRemainingFunds = async (generatedKeypair, mainWalletPublicKey) => {
    const generatedPublicKey = new PublicKey(generatedKeypair.publicKey);
    const balance = await connection.getBalance(generatedPublicKey, 'confirmed');

    if (balance > 0) {
        const transactionFee = 5000; // approximate transaction fee
        const lamportsToSend = balance - transactionFee;

        if (lamportsToSend > 0) {
            const transaction = new Transaction().add(SystemProgram.transfer({
                fromPubkey: generatedPublicKey,
                toPubkey: mainWalletPublicKey,
                lamports: lamportsToSend
            }));
            await sendAndConfirmTransaction(connection, transaction, [generatedKeypair], { commitment: 'confirmed' });
            log('INFO', `Returned remaining funds from ${generatedPublicKey.toString()} to ${mainWalletPublicKey.toString()}`);
        } else {
            log('WARNING', `Not enough balance to send remaining funds. Balance: ${balance}, Fee: ${transactionFee}`);
        }
    }
};

const batchGetBalances = async (addresses) => {
    const balancePromises = addresses.map((address) =>
        connection.getBalance(new PublicKey(address), 'confirmed')
    );

    const balances = await Promise.all(balancePromises);
    return addresses.map((address, index) => ({
        address,
        balance: balances[index] / LAMPORTS_PER_SOL
    }));
};

const getTargets = async (activeWallet, minSolTarget) => {
    const targets = [];
    const activeWalletPublicKey = new PublicKey(activeWallet);
    const signatures = await connection.getSignaturesForAddress(activeWalletPublicKey, { limit: 50 });

    const addressSet = new Set();
    for (const signatureInfo of signatures) {
        const tx = await connection.getTransaction(signatureInfo.signature, { maxSupportedTransactionVersion: 0 });
        if (!tx || !tx.transaction || !tx.transaction.message || !Array.isArray(tx.transaction.message.accountKeys)) continue;

        for (const accountKey of tx.transaction.message.accountKeys) {
            const targetPublicKey = new PublicKey(accountKey);
            const accountInfo = await connection.getAccountInfo(targetPublicKey, 'confirmed');
            if (accountInfo?.executable || !accountInfo || EXCLUDED_ADDRESSES.includes(targetPublicKey.toBase58())) continue;

            if (!targetPublicKey.equals(PublicKey.default) &&
                !targetPublicKey.equals(activeWalletPublicKey)) {
                addressSet.add(targetPublicKey.toBase58());
            }
        }
    }

    const addressArray = Array.from(addressSet);
    const balanceResults = await batchGetBalances(addressArray);

    for (const { address, balance } of balanceResults) {
        if (balance >= minSolTarget) {
            targets.push({ publicKey: address, balance });
        }
    }

    const activeWalletBalance = await connection.getBalance(activeWalletPublicKey, 'confirmed') / LAMPORTS_PER_SOL;
    if (activeWalletBalance >= minSolTarget) {
        targets.push({ publicKey: activeWalletPublicKey.toBase58(), balance: activeWalletBalance });
    }

    await saveTargetAddresses(targets);
    return targets.slice(0, settings.maxTargets);
};

const sendTransactionsInParallel = async (generatedKeypair, targets) => {
    const generatedPublicKey = new PublicKey(generatedKeypair.publicKey);
    const generatedBalance = await fetchGeneratedWalletBalance(generatedPublicKey.toBase58());

    // Check if the generated wallet has enough funds for rent
    const minBalanceForRent = 0.00203928; // Minimum balance required to avoid rent issues
    if (generatedBalance < minBalanceForRent) {
        log('CRITICAL', `Generated wallet does not have enough funds for rent. Balance: ${generatedBalance} SOL`);
        return [];
    }

    const transactions = targets.map(target => {
        const targetPublicKey = new PublicKey(target.publicKey);
        const transaction = new Transaction().add(SystemProgram.transfer({
            fromPubkey: generatedPublicKey,
            toPubkey: targetPublicKey,
            lamports: settings.amountToSend * LAMPORTS_PER_SOL
        }));
        return sendAndConfirmTransaction(connection, transaction, [generatedKeypair], { commitment: 'confirmed' })
            .then(() => {
                log('INFO', `Sent transaction from ${generatedPublicKey.toString()} to ${targetPublicKey.toString()}`);
                return { success: true, target: target.publicKey };
            })
            .catch(async error => {
                let logs = [];
                if (error instanceof SendTransactionError) {
                    logs = await error.getLogs();
                }
                log('CRITICAL', `Transaction failed with error: ${error.message}`, logs);
                return { success: false, target: target.publicKey, error: error.message, logs };
            });
    });
    return Promise.all(transactions);
};

const logTransactionDetails = async (generatedKeypair, activeWallet, targets, transactionResults) => {
    const generatedPublicKey = generatedKeypair.publicKey.toBase58();
    const generatedBalance = await fetchGeneratedWalletBalance(generatedPublicKey);
    const activeBalance = await fetchWalletBalance(activeWallet);
    const mainWalletBalance = await fetchMainWalletBalance();

    const logEntry = {
        timestamp: new Date().toISOString(),
        generatedWallet: {
            publicKey: generatedPublicKey,
            balance: generatedBalance,
            keypair: bs58.encode(generatedKeypair.secretKey),
        },
        activeWallet: {
            publicKey: activeWallet,
            balance: activeBalance
        },
        mainWallet: {
            balance: mainWalletBalance
        },
        targets: targets.map(target => ({
            publicKey: target.publicKey,
            balance: target.balance,
            sentSuccessful: transactionResults.find(result => result.target === target.publicKey)?.success || false
        })),
        transactionStatus: transactionResults.every(result => result.success) ? 'Success' : 'Partial Failure'
    };

    await appendToMonitoredFile(logEntry);
};

const viewTargets = async (selectedPair) => {
    const activeBalance = selectedPair.activeBalance;

    let generatedKeypair;
    try {
        generatedKeypair = Keypair.fromSecretKey(bs58.decode(selectedPair.generatedSecretKey));
    } catch (error) {
        log('CRITICAL', 'Failed to recreate the generated keypair:', error);
        return;
    }

    const generatedBalance = await fetchGeneratedWalletBalance(generatedKeypair.publicKey);
    const mainWalletBalance = await fetchMainWalletBalance();

    console.log(`Fetching targets for ${selectedPair.activeAddress}...`);

    await clearTargetAddresses();

    const targets = await getTargetsWithTimeout(selectedPair.activeAddress, settings.minSolTarget);

    console.log(`Main Wallet Balance: ${mainWalletBalance.toFixed(2)} SOL`);
    console.log(`Settings: Min Sol Target: ${settings.minSolTarget} SOL, Max Targets: ${settings.maxTargets}, Amount to Send: ${settings.amountToSend} SOL`);
    console.log(`Active Wallet Balance: ${activeBalance.toFixed(2)} SOL`);
    console.log(`Generated Wallet Balance: ${generatedBalance.toFixed(2)} SOL`);

    if (targets.length === 0) {
        log('WARNING', 'No suitable targets found.');
        return;
    }

    console.log('Targets:');
    targets.forEach(target => {
        console.log(`${target.publicKey} - ${target.balance.toFixed(4)} SOL`);
    });

    const { confirm } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirm',
            message: 'Send transaction to these targets?'
        }
    ]);

    if (confirm) {
        const totalAmount = Math.ceil((settings.amountToSend * targets.length + 0.002) * LAMPORTS_PER_SOL);
        await fundGeneratedWallet(generatedKeypair, totalAmount);
        await delay(500);
        const generatedBalanceAfterFunding = await fetchGeneratedWalletBalance(generatedKeypair.publicKey);
        await delay(2000);
        console.log(`Generated Wallet Balance after funding: ${generatedBalanceAfterFunding.toFixed(6)} SOL`);
        const transactionResults = await sendTransactionsInParallel(generatedKeypair, targets);
        await returnRemainingFunds(generatedKeypair, mainWalletKeypair.publicKey);
        await logTransactionDetails(generatedKeypair, selectedPair.activeAddress, targets, transactionResults);
    }
};

const getTargetsWithTimeout = async (activeWallet, minSolTarget) => {
    const start = Date.now();
    let targets = await getTargets(activeWallet, minSolTarget);
    while (targets.length < settings.maxTargets && Date.now() - start < 10000) {
        console.log(`Found ${targets.length} targets so far, continuing to search...`);
        targets = await getTargets(activeWallet, minSolTarget);
    }
    if (targets.length < settings.maxTargets) {
        const { lowerMinSol } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'lowerMinSol',
                message: 'Not enough targets found. Lower minimum target amount to 0 for this transaction set?'
            }
        ]);
        if (lowerMinSol) {
            targets = await getTargets(activeWallet, 0);
        }
    }
    return targets;
};

const sendTransactionMenu = async () => {
    await loadExistingData();

    if (!similarAddresses || similarAddresses.size === 0) {
        log('CRITICAL', 'No similar addresses found.');
        return;
    }

    const choices = Array.from(similarAddresses).map(addr => {
        const { activeAddress, generatedPublicKey, frontMatches, endMatches, activeBalance } = addr;
        return {
            name: `${generatedPublicKey.slice(0, 4)}...${generatedPublicKey.slice(-4)} - ${frontMatches}F ${endMatches}R - Active Balance: ${activeBalance.toFixed(2)} SOL`,
            value: generatedPublicKey
        };
    });

    const { selected } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selected',
            message: 'Select an address:',
            choices
        }
    ]);

    const selectedPair = Array.from(similarAddresses).find(addr => addr.generatedPublicKey === selected);
    if (!selectedPair) {
        log('CRITICAL', 'Selected pair not found.');
        return;
    }

    await viewTargets(selectedPair);
};

export { sendTransactionMenu, loadExistingData, getTargetsWithTimeout, fundGeneratedWallet, logTransactionDetails, returnRemainingFunds, sendTransactionsInParallel, fetchMainWalletBalance };
