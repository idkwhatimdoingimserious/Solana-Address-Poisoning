import inquirer from 'inquirer';
import fs from 'fs/promises';
import { log, setSettings } from './logger.js';

const SETTINGS_FILE = './src/data/settings.json';

let settings = {
    verboseLogging: false,
    minSolActive: 1,  // Minimum SOL for active wallets
    minSolTarget: 0.01,  // Minimum SOL for target wallets
    maxTargets: 10,  // Maximum number of targets to send to
    amountToSend: 0.01 // Amount of SOL to send
};

const loadSettings = async () => {
    try {
        const settingsData = await fs.readFile(SETTINGS_FILE, 'utf-8');
        settings = JSON.parse(settingsData);
        setSettings(settings);
        log('INFO', 'Loaded settings');
    } catch (error) {
        log('WARNING', 'No existing settings file, using default settings.');
    }
};

const saveSettings = async () => {
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings));
    setSettings(settings);
    log('INFO', 'Settings saved');
};

const settingsMenu = async () => {
    await loadSettings();

    const { verboseLogging, minSolActive, minSolTarget, maxTargets, amountToSend } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'verboseLogging',
            message: 'Enable verbose logging?',
            default: settings.verboseLogging
        },
        {
            type: 'input',
            name: 'minSolActive',
            message: 'Minimum SOL required for active wallets?',
            default: settings.minSolActive
        },
        {
            type: 'input',
            name: 'minSolTarget',
            message: 'Minimum SOL required for target wallets?',
            default: settings.minSolTarget
        },
        {
            type: 'input',
            name: 'maxTargets',
            message: 'Maximum number of targets to send to?',
            default: settings.maxTargets
        },
        {
            type: 'input',
            name: 'amountToSend',
            message: 'Amount of SOL to send?',
            default: settings.amountToSend
        }
    ]);

    settings.verboseLogging = verboseLogging;
    settings.minSolActive = parseFloat(minSolActive);
    settings.minSolTarget = parseFloat(minSolTarget);
    settings.maxTargets = parseInt(maxTargets, 10);
    settings.amountToSend = parseFloat(amountToSend);

    await saveSettings();
};

export { settingsMenu, loadSettings, saveSettings, settings };
