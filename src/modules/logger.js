import chalk from 'chalk';

let logs = [];
const MAX_LOGS = 50;
let settings = {
    verboseLogging: false,
};

const logLevels = {
    INFO: chalk.blue,
    WARNING: chalk.yellow,
    CRITICAL: chalk.red,
};

const log = (level, message) => {
    if (!settings.verboseLogging && level === 'INFO') {
        return;
    }

    const time = new Date().toISOString();
    const logMessage = `${logLevels[level](`${level}|`)} ${message} ${chalk.gray(`| ${time}`)}`;
    logs.push(logMessage);
    if (logs.length > MAX_LOGS) {
        logs.shift();
    }
    console.log(logMessage);
    // Simulate fading logs by clearing them after a timeout
    setTimeout(() => {
        logs.shift();
    }, 30000); // Adjust the timeout as needed
};

const setSettings = (newSettings) => {
    settings = { ...settings, ...newSettings };
};

export { log, logLevels, logs, setSettings };
