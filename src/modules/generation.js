import WebSocket from 'ws';
import { PublicKey, Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { log } from './logger.js';
import {
  loadExistingData,
  saveGeneratedKeypairs,
  saveSimilarAddresses,
  appendToFile,
  generatedKeypairs,
  activeAddresses,
  similarAddresses,
  saveActiveAddresses
} from './data.js';
import { settings } from './settings.js';

const RPC_URL = 'RPC_URL_HERE';
const connection = new Connection(RPC_URL, 'confirmed');
const HELIUS_WEBSOCKET = 'WEBSOCKET_RPC_URL_HERE';
const MINIMUM_BALANCE = settings.minSolActive * 1e9;
const MAX_RPC_REQUESTS_PER_SECOND = 20;
const EXCLUDED_ADDRESSES = ['Vote111111111111111111111111111111111111111'];
const DATA_DIR = './src/data/';
const MIN_FRONT_SIMILARITY = 4;

let autoMode = false;
let addressesToExplore = new Set();

class RateLimiter {
  constructor(maxRequests, perSeconds) {
    this.maxRequests = maxRequests;
    this.perSeconds = perSeconds;
    this.tokens = maxRequests;
    this.lastRefilled = Date.now();
  }

  async waitForToken() {
    while (true) {
      this.refillTokens();
      if (this.tokens > 0) {
        this.tokens--;
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  refillTokens() {
    const now = Date.now();
    const timePassed = now - this.lastRefilled;
    const refillAmount = (timePassed / 1000) * (this.maxRequests / this.perSeconds);
    this.tokens = Math.min(this.maxRequests, this.tokens + refillAmount);
    this.lastRefilled = now;
  }
}

const rateLimiter = new RateLimiter(MAX_RPC_REQUESTS_PER_SECOND, 1);

const generateAndSaveKeypair = async () => {
  while (autoMode) {
    try {
      const keypair = Keypair.generate();
      const publicKey = keypair.publicKey.toBase58();
      if (!generatedKeypairs.has(publicKey)) {
        const keypairData = {
          publicKey: publicKey,
          secretKey: bs58.encode(keypair.secretKey)
        };
        generatedKeypairs.set(publicKey, keypairData);
        await appendToFile(`${DATA_DIR}generated_keypairs.json`, keypairData);
        await saveGeneratedKeypairs(generatedKeypairs);
      }
    } catch (error) {
      log('CRITICAL', `Error in generateAndSaveKeypair: ${error.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

const findSimilarKeysForActiveAddresses = async (activePublicKey, activeBalance, lastActivity) => {
  const firstSix = activePublicKey.slice(0, 6);
  const lastSix = activePublicKey.slice(-6).split('');

  for (let [generatedPublicKey, keypairData] of generatedKeypairs.entries()) {
    const generatedFirstSix = generatedPublicKey.slice(0, 6);
    const generatedLastSix = generatedPublicKey.slice(-6).split('');
    const frontMatches = [...firstSix].filter((char, index) => char === generatedFirstSix[index]).length;
    const endMatches = countEndMatches(lastSix, generatedLastSix);

    if (firstSix.slice(0, MIN_FRONT_SIMILARITY) === generatedFirstSix.slice(0, MIN_FRONT_SIMILARITY)) {
      const similarAddress = {
        activeAddress: activePublicKey,
        generatedPublicKey,
        generatedSecretKey: keypairData.secretKey,
        activeBalance,
        frontMatches,
        endMatches,
        lastActivity
      };
      if (!Array.from(similarAddresses).some(addr => addr.activeAddress === activePublicKey && addr.generatedPublicKey === generatedPublicKey)) {
        similarAddresses.add(similarAddress);
        await appendToFile(`${DATA_DIR}similar_addresses.json`, similarAddress);
      }
    }
  }

  await saveSimilarAddresses(similarAddresses);
};

const countEndMatches = (lastSix, activeLastSix) => {
  let matchedEnd = 0;
  activeLastSix.forEach((char, index) => {
    if (char === lastSix[index]) {
      matchedEnd++;
    }
  });
  return matchedEnd;
};

const checkForExistingSimilarities = async () => {
  for (let [activePublicKey, { balance, lastActivity }] of activeAddresses.entries()) {
    await findSimilarKeysForActiveAddresses(activePublicKey, balance, lastActivity);
  }
};

const checkAndAddAddress = async (address) => {
  if (!autoMode || EXCLUDED_ADDRESSES.includes(address)) return false;

  await rateLimiter.waitForToken();
  try {
    const balance = await connection.getBalance(new PublicKey(address));
    if (balance >= MINIMUM_BALANCE) {
      const balanceInSOL = balance / 1e9;
      const lastActivity = new Date().toISOString();
      activeAddresses.set(address, { balance: balanceInSOL, lastActivity });
      await appendToFile(`${DATA_DIR}active_addresses.json`, { publicKey: address, balance: balanceInSOL, lastActivity });
      await findSimilarKeysForActiveAddresses(address, balanceInSOL, lastActivity);
      return true;
    } else {
      log('INFO', `Address ${address} does not meet minimum balance requirement.`);
    }
  } catch (error) {
    log('CRITICAL', `Error checking balance for address ${address}: ${error.message}`);
  }
  return false;
};

const fetchRecentTransactions = async () => {
  if (!autoMode) return;
  try {
    await rateLimiter.waitForToken();
    const recentBlockhash = await connection.getLatestBlockhash();
    await rateLimiter.waitForToken();
    const confirmedBlock = await connection.getBlock(recentBlockhash.lastValidBlockHeight, { maxSupportedTransactionVersion: 0 });

    if (confirmedBlock && confirmedBlock.transactions) {
      for (const tx of confirmedBlock.transactions) {
        if (!autoMode) return;
        if (tx && tx.transaction && tx.transaction.message && Array.isArray(tx.transaction.message.accountKeys)) {
          const addresses = tx.transaction.message.accountKeys.map(key => key.toString());
          for (const address of addresses) {
            if (!activeAddresses.has(address) && !EXCLUDED_ADDRESSES.includes(address)) {
              const isActive = await checkAndAddAddress(address);
              if (isActive) {
                addressesToExplore.add(address);
              }
            }
          }
        } else {
          log('CRITICAL', `accountKeys is not iterable: ${tx.transaction?.message?.accountKeys}`);
        }
      }
    }
  } catch (error) {
    log('CRITICAL', `Error fetching recent blocks: ${error.message}`);
  }
};

const exploreAddresses = async () => {
  while (autoMode) {
    const addressesToExploreArray = Array.from(addressesToExplore);
    addressesToExplore.clear();

    for (const address of addressesToExploreArray) {
      if (!autoMode) return;
      await checkAndAddAddress(address);
    }

    if (addressesToExplore.size === 0) {
      if (!autoMode) return;
      await new Promise(resolve => setTimeout(resolve, 5000));
      await fetchRecentTransactions();
    }

    await saveActiveAddresses(activeAddresses);
  }
};

const setupWebSocket = () => {
  const ws = new WebSocket(HELIUS_WEBSOCKET);

  ws.on('open', () => {
    log('INFO', 'WebSocket connection opened');
    ws.send(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "logsSubscribe",
      params: [ "all", { "commitment": "finalized" } ]
    }));
  });

  ws.on('message', async (data) => {
    const response = JSON.parse(data);
    if (response.method === 'logsNotification' && response.params && response.params.result) {
      const log = response.params.result;
      const accountKeys = log.value?.accountKeys || [];

      if (Array.isArray(accountKeys)) {
        for (const key of accountKeys) {
          if (!activeAddresses.has(key) && !EXCLUDED_ADDRESSES.includes(key)) {
            const isActive = await checkAndAddAddress(key);
            if (isActive) {
              addressesToExplore.add(key);
            }
          }
        }
      } else {
        log('CRITICAL', `accountKeys is not iterable: ${accountKeys}`);
      }
    }
  });

  ws.on('close', () => {
    log('WARNING', 'WebSocket connection closed. Reconnecting...');
    setTimeout(setupWebSocket, 1000);
  });

  ws.on('error', (error) => {
    log('CRITICAL', `WebSocket error: ${error.message}`);
  });
};

const startAutoMode = async () => {
  autoMode = true;
  await loadExistingData();
  generateAndSaveKeypair();
  exploreAddresses();
  setupWebSocket();
};

const stopGeneration = () => {
  autoMode = false;
  log('INFO', 'Auto mode stopped.');
};

const startGeneration = async () => {
  await startAutoMode();
};

export { startGeneration, stopGeneration };
