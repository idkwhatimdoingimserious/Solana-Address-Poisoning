import inquirer from 'inquirer';
import fs from 'fs/promises';
import { log, logLevels, setSettings } from './modules/logger.js';
import clear from 'clear';

let autoMode = false;

const loadModule = async (module) => {
    return import(`./modules/${module}`);
};

const mainMenu = async () => {
    clear();  // Clear the terminal for a distraction-free UI
    const choices = [
        autoMode ? 'Stop Generation' : 'Start Generation',
        'Send Transaction',
        'Monitoring',
        'Settings',
        'Exit'
    ];
    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Select an option:',
            choices
        }
    ]);

    switch (action) {
        case 'Start Generation':
            autoMode = true;
            const generationModuleStart = await loadModule('generation.js');
            log('INFO', 'Generating Started');
            generationModuleStart.startGeneration();
            break;
        case 'Stop Generation':
            autoMode = false;
            const generationModuleStop = await loadModule('generation.js');
            log('INFO', 'Generating Stopped');
            generationModuleStop.stopGeneration();
            break;
        case 'Send Transaction':
            const transactionModule = await loadModule('transaction.js');
            await transactionModule.sendTransactionMenu();
            break;
        case 'Monitoring':
            const monitoringModule = await loadModule('monitoring.js');
            await monitoringModule.monitoringMenu();
            break;
        case 'Settings':
            const settingsModule = await loadModule('settings.js');
            await settingsModule.settingsMenu();
            break;
        case 'Exit':
            log('INFO', 'Exiting...');
            process.exit();
    }

    mainMenu(); // Show the menu again after an action
};

const init = async () => {
    const settingsModule = await loadModule('settings.js');
    await settingsModule.loadSettings();
    const dataModule = await loadModule('data.js');
    await dataModule.loadExistingData();
    mainMenu();
};

init().catch((error) => {
    log('CRITICAL', `Unhandled Error: ${error.message}`);
});

process.on('uncaughtException', (error) => {
    log('CRITICAL', `Uncaught Exception: ${error.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
    log('CRITICAL', `Unhandled Rejection at: ${promise} reason: ${reason}`);
});
