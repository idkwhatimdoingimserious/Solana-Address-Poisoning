import inquirer from 'inquirer';
import { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair, Transaction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import fs from 'fs/promises';
import { log } from './logger.js';
import { loadExistingData, clearTargetAddresses } from './data.js';
import clear from 'clear';
import { getTargetsWithTimeout, logTransactionDetails, fundGeneratedWallet, returnRemainingFunds, sendTransactionsInParallel } from './transaction.js';
import bs58 from 'bs58';
import { settings } from './settings.js';

const RPC_URL = 'RPC_URL_HERE';
const connection = new Connection(RPC_URL, 'confirmed');

const MAIN_WALLET_SECRET_KEY = 'PRIVATE_KEY_HERE';
const mainWalletKeypair = Keypair.fromSecretKey(bs58.decode(MAIN_WALLET_SECRET_KEY));

let monitoredWallets = [];

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const loadMonitoredWallets = async () => {
    try {
        const data = await fs.readFile('./src/data/monitored_wallets.json', 'utf-8');
        monitoredWallets = JSON.parse(data);
        log('INFO', `Loaded ${monitoredWallets.length} monitored wallets`);
    } catch (error) {
        log('WARNING', 'No existing monitored wallets file, starting fresh.');
    }
};

const refreshBalance = async (wallet) => {
    const generatedPublicKey = new PublicKey(wallet.generatedWallet.publicKey);

    try {
        const balance = await connection.getBalance(generatedPublicKey);
        wallet.generatedWallet.balance = balance / LAMPORTS_PER_SOL;
        log('INFO', `Updated balance for ${wallet.generatedWallet.publicKey}: ${wallet.generatedWallet.balance} SOL`);
        await saveMonitoredWallets();
    } catch (error) {
        log('CRITICAL', `Error refreshing balance: ${error.message}`);
    }
};

const fetchMainWalletBalance = async () => {
    return await fetchWalletBalance(mainWalletKeypair.publicKey);
};

const fetchGeneratedWalletBalance = async (publicKey) => {
    return await fetchWalletBalance(publicKey);
};

const fetchWalletBalance = async (publicKey) => {
    try {
        const balanceLamports = await connection.getBalance(new PublicKey(publicKey), 'confirmed');
        return balanceLamports / LAMPORTS_PER_SOL;
    } catch (error) {
        log('CRITICAL', `Error fetching wallet balance for ${publicKey}: ${error.message}`);
        return null;
    }
};

const fetchTransactions = async (publicKey) => {
    try {
        const signatures = await connection.getSignaturesForAddress(new PublicKey(publicKey), { limit: 10 });
        const transactions = await Promise.all(signatures.map(async (signatureInfo) => {
            const tx = await connection.getTransaction(signatureInfo.signature, { commitment: 'confirmed' });
            const from = tx.transaction.message.accountKeys[0].toBase58();
            const to = tx.transaction.message.accountKeys[1].toBase58();
            const amount = (tx.meta.postBalances[1] - tx.meta.preBalances[1]) / LAMPORTS_PER_SOL;
            const time = new Date(signatureInfo.blockTime * 1000).toLocaleString();
            return {
                from,
                to,
                amount,
                time
            };
        }));
        return transactions;
    } catch (error) {
        log('CRITICAL', `Error fetching transactions: ${error.message}`);
        return [];
    }
};

const viewWalletDetails = async (wallet) => {
    const publicKey = new PublicKey(wallet.generatedWallet.publicKey);
    const balance = await connection.getBalance(publicKey);
    const transactions = await fetchTransactions(wallet.generatedWallet.publicKey);

    const receivedTransaction = transactions.find(tx => tx.to === wallet.generatedWallet.publicKey && tx.amount > 0.01);
    const status = receivedTransaction ? 'Successful' : 'Unsuccessful';

    console.log(`\nWallet: ${wallet.generatedWallet.publicKey}`);
    console.log(`Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    console.log(`Status: ${status}`);
    console.log(`Transactions:`);

    transactions.forEach(tx => {
        if (tx.from === wallet.generatedWallet.publicKey) {
            console.log(`  - To: ${tx.to}, Amount: ${tx.amount.toFixed(6)} SOL, Time: ${tx.time}`);
        } else {
            console.log(`  - From: ${tx.from}, Amount: ${tx.amount.toFixed(6)} SOL, Time: ${tx.time}`);
        }
    });

    wallet.generatedWallet.balance = Number((balance / LAMPORTS_PER_SOL).toFixed(6));
    wallet.lastActiveTime = transactions.length > 0 ? transactions[0].time : 'Unknown';
    await saveMonitoredWallets();

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Select an action:',
            choices: ['Send New Transaction', 'Send All SOL to Main Wallet', 'Return to Monitoring Menu']
        }
    ]);

    if (action === 'Send New Transaction') {
        await sendTransactionFromViewedWallet(wallet);
    } else if (action === 'Send All SOL to Main Wallet') {
        await sendAllSolToMainWallet(wallet);
    } else if (action === 'Return to Monitoring Menu') {
        clear();
        await monitoringMenu();
    }
};

const sendTransactionFromViewedWallet = async (wallet) => {
    if (!wallet) {
        log('CRITICAL', 'No wallet details found.');
        return;
    }

    const activeWalletPublicKey = wallet.activeWallet.publicKey;
    const generatedKeypair = Keypair.fromSecretKey(bs58.decode(wallet.generatedWallet.keypair));

    console.log(`Fetching targets for ${activeWalletPublicKey}...`);

    await clearTargetAddresses();

    const targets = await getTargetsWithTimeout(activeWalletPublicKey, settings.minSolTarget);

    console.log(`Main Wallet Balance: ${(await fetchMainWalletBalance()).toFixed(2)} SOL`);
    console.log(`Settings: Min Sol Target: ${settings.minSolTarget} SOL, Max Targets: ${settings.maxTargets}, Amount to Send: ${settings.amountToSend} SOL`);
    console.log(`Active Wallet Balance: ${(await fetchWalletBalance(activeWalletPublicKey)).toFixed(2)} SOL`);
    console.log(`Generated Wallet Balance: ${(await fetchGeneratedWalletBalance(generatedKeypair.publicKey)).toFixed(2)} SOL`);

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
        await delay(200);
        const generatedBalanceAfterFunding = await fetchGeneratedWalletBalance(generatedKeypair.publicKey);
        console.log(`Generated Wallet Balance after funding: ${generatedBalanceAfterFunding.toFixed(2)} SOL`);
        const transactionResults = await sendTransactionsInParallel(generatedKeypair, targets);
        await returnRemainingFunds(generatedKeypair, mainWalletKeypair.publicKey);
        await logTransactionDetails(generatedKeypair, activeWalletPublicKey, targets, transactionResults);
    }
};

const sendAllSolToMainWallet = async (wallet) => {
    const generatedKeypair = Keypair.fromSecretKey(bs58.decode(wallet.generatedWallet.keypair));
    const generatedPublicKey = new PublicKey(wallet.generatedWallet.publicKey);
    const mainWalletPublicKey = mainWalletKeypair.publicKey;

    const balance = await connection.getBalance(generatedPublicKey, 'confirmed');

    if (balance > 0) {
        const transaction = new Transaction().add(SystemProgram.transfer({
            fromPubkey: generatedPublicKey,
            toPubkey: mainWalletPublicKey,
            lamports: balance - 5000 // leaving a small amount for transaction fee
        }));
        await sendAndConfirmTransaction(connection, transaction, [generatedKeypair], { commitment: 'confirmed' });
        log('INFO', `Returned remaining funds from ${generatedPublicKey.toString()} to ${mainWalletPublicKey.toString()}`);
    }
};

const saveMonitoredWallets = async () => {
    await fs.writeFile('./src/data/monitored_wallets.json', JSON.stringify(monitoredWallets, null, 2));
};

const batchFetchBalances = async (wallets, batchSize = 15, delayMs = 1000) => {
    const results = [];

    for (let i = 0; i < wallets.length; i += batchSize) {
        const batch = wallets.slice(i, i + batchSize);
        const batchPromises = batch.map(async (wallet) => {
            try {
                const generatedPublicKey = new PublicKey(wallet.generatedWallet.publicKey);
                const balance = await connection.getBalance(generatedPublicKey);
                wallet.generatedWallet.balance = balance / LAMPORTS_PER_SOL;
                log('INFO', `Updated balance for ${wallet.generatedWallet.publicKey}: ${wallet.generatedWallet.balance} SOL`);
            } catch (error) {
                log('CRITICAL', `Error refreshing balance: ${error.message}`);
            }
            return wallet;
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        if (i + batchSize < wallets.length) {
            await delay(delayMs);
        }
    }

    return results;
};

const refreshAllWallets = async () => {
    monitoredWallets = await batchFetchBalances(monitoredWallets);
    await saveMonitoredWallets();
    log('INFO', 'All wallet balances and last active times refreshed.');
};

const monitoringMenu = async () => {
    clear();
    await loadMonitoredWallets();

    if (monitoredWallets.length === 0) {
        console.log('No monitored wallets found.');
        return;
    }

    const uniqueWallets = Array.from(new Set(monitoredWallets.map(wallet => wallet.generatedWallet.publicKey)))
        .map(publicKey => monitoredWallets.find(wallet => wallet.generatedWallet.publicKey === publicKey));

    const choices = uniqueWallets.map(wallet => ({
        name: `${wallet.generatedWallet.publicKey} - ${typeof wallet.generatedWallet.balance === 'number' ? wallet.generatedWallet.balance.toFixed(6) : 'Unknown'} SOL - Last Active: ${wallet.lastActiveTime || 'Unknown'}`,
        value: wallet
    }));

    choices.push({ name: 'Refresh All Wallets', value: 'refreshAll' });
    choices.push({ name: 'Return to Main Menu', value: null });

    const { selectedWallet } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selectedWallet',
            message: 'Select a wallet to view details:',
            choices
        }
    ]);

    if (selectedWallet === 'refreshAll') {
        await refreshAllWallets();
        await monitoringMenu();
    } else if (selectedWallet) {
        await viewWalletDetails(selectedWallet);
    } else {
        // Return to Main Menu functionality
        // Call the function that initiates the main menu
    }
};

const init = async () => {
    await loadExistingData();
    await monitoringMenu();
};

export { monitoringMenu, init };
