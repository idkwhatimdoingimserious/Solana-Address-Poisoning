// data.js
import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = './src/data/';

const ACTIVE_ADDRESSES_FILE = `${DATA_DIR}active_addresses.json`;
const GENERATED_KEYPAIRS_FILE = `${DATA_DIR}generated_keypairs.json`;
const SIMILAR_ADDRESSES_FILE = `${DATA_DIR}similar_addresses.json`;
const TARGET_ADDRESSES_FILE = `${DATA_DIR}target_addresses.json`;
const MONITORED_WALLETS_FILE = `${DATA_DIR}monitored_wallets.json`;

let activeAddresses = new Map();
let generatedKeypairs = new Map();
let similarAddresses = new Set();
let targetAddresses = new Map();

const ensureDirExists = async (dirPath) => {
    try {
        await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
        console.error(`Error ensuring directory exists: ${error}`);
        throw error;
    }
};

const ensureFileExists = async (filePath) => {
    try {
        await fs.access(filePath);
    } catch (error) {
        await fs.writeFile(filePath, '[]');
    }
};

const readJsonFile = async (filePath) => {
    try {
        await ensureFileExists(filePath);
        const fileContent = await fs.readFile(filePath, 'utf8');
        return JSON.parse(fileContent);
    } catch (error) {
        console.error(`Error reading or parsing JSON from file ${filePath}:`, error);
        throw error;
    }
};

const writeJsonFile = async (filePath, data) => {
    const tempFilePath = `${filePath}.tmp`;
    try {
        await fs.writeFile(tempFilePath, JSON.stringify(data, null, 2));
        await fs.rename(tempFilePath, filePath);
    } catch (error) {
        console.error(`Error writing to file ${filePath}:`, error);
        throw error;
    }
};

const appendToFile = async (filePath, data) => {
    try {
        const existingData = await readJsonFile(filePath);
        existingData.push(data);
        await writeJsonFile(filePath, existingData);
    } catch (error) {
        console.error('Error appending to file:', error);
    }
};

const loadExistingData = async () => {
    try {
        const generatedKeypairsData = await readJsonFile(GENERATED_KEYPAIRS_FILE);
        generatedKeypairs = new Map(generatedKeypairsData.map(obj => [obj.publicKey, obj]));

        const activeAddressesData = await readJsonFile(ACTIVE_ADDRESSES_FILE);
        activeAddresses = new Map(activeAddressesData.map(obj => [obj.publicKey, { balance: obj.balance, lastActivity: obj.lastActivity }]));

        const similarAddressesData = await readJsonFile(SIMILAR_ADDRESSES_FILE);
        similarAddresses = new Set(similarAddressesData);

        const targetAddressesData = await readJsonFile(TARGET_ADDRESSES_FILE);
        targetAddresses = new Map(targetAddressesData.map(obj => [obj.publicKey, { balance: obj.balance, lastActivity: obj.lastActivity }]));
    } catch (error) {
        console.error('Error loading existing data:', error);
    }
};

const saveGeneratedKeypairs = async () => {
    try {
        await writeJsonFile(GENERATED_KEYPAIRS_FILE, Array.from(generatedKeypairs.values()));
    } catch (error) {
        console.error('Error saving generated keypairs:', error);
    }
};

const saveActiveAddresses = async () => {
    try {
        await writeJsonFile(ACTIVE_ADDRESSES_FILE, Array.from(activeAddresses.entries()).map(([publicKey, value]) => ({ publicKey, ...value })));
    } catch (error) {
        console.error('Error saving active addresses:', error);
    }
};

const saveSimilarAddresses = async () => {
    try {
        await writeJsonFile(SIMILAR_ADDRESSES_FILE, Array.from(similarAddresses));
    } catch (error) {
        console.error('Error saving similar addresses:', error);
    }
};

const saveTargetAddresses = async () => {
    try {
        await writeJsonFile(TARGET_ADDRESSES_FILE, Array.from(targetAddresses.entries()).map(([publicKey, value]) => ({ publicKey, ...value })));
    } catch (error) {
        console.error('Error saving target addresses:', error);
    }
};

const addTargetAddress = (activePublicKey, publicKey, balance) => {
    targetAddresses.set(publicKey, { balance, lastActivity: new Date().toISOString() });
    saveTargetAddresses();
};

const clearTargetAddresses = async () => {
    targetAddresses.clear();
    await saveTargetAddresses();
};

const appendToMonitoredFile = async (data) => {
    try {
        await appendToFile(MONITORED_WALLETS_FILE, data);
    } catch (error) {
        console.error('Error appending to monitored file:', error);
    }
};

const initializeFiles = async () => {
    await ensureDirExists(DATA_DIR);
    await ensureFileExists(ACTIVE_ADDRESSES_FILE);
    await ensureFileExists(GENERATED_KEYPAIRS_FILE);
    await ensureFileExists(SIMILAR_ADDRESSES_FILE);
    await ensureFileExists(TARGET_ADDRESSES_FILE);
    await ensureFileExists(MONITORED_WALLETS_FILE);
};

export {
    loadExistingData,
    activeAddresses,
    generatedKeypairs,
    similarAddresses,
    targetAddresses,
    saveGeneratedKeypairs,
    saveActiveAddresses,
    saveSimilarAddresses,
    saveTargetAddresses,
    addTargetAddress,
    clearTargetAddresses,
    appendToFile,
    appendToMonitoredFile,
    initializeFiles
};
