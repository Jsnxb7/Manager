const { app, BrowserWindow, dialog } = require('electron');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');

let mainWindow;
let flaskProcess;

// Load saved config or initialize empty object
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
        }
    } catch (error) {
        console.error("Error loading config:", error);
    }
    return {};
}

// Save config to file
function saveConfig(config) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 4));
    } catch (error) {
        console.error("Error saving config:", error);
    }
}

// Show folder selection dialog
async function selectFolder(title) {
    const result = await dialog.showOpenDialog({
        title: title,
        properties: ['openDirectory']
    });
    return result.filePaths.length > 0 ? result.filePaths[0] : null;
}

// Get or ask for paths
async function getPaths() {
    let config = loadConfig();

    // Check if app.exe path is stored and exists
    if (!config.flaskExePath || !fs.existsSync(config.flaskExePath)) {
        config.flaskExePath = await selectFolder("Select the folder containing app.exe");
        if (config.flaskExePath) {
            config.flaskExePath = path.join(config.flaskExePath, "app.exe");
            saveConfig(config);
        } else {
            console.error("No Flask executable selected.");
            return null;
        }
    }

    // Check if Flask data path is stored and exists
    if (!config.flaskDataPath || !fs.existsSync(config.flaskDataPath)) {
        config.flaskDataPath = await selectFolder("Select the folder containing Flask data (static, templates, data)");
        if (config.flaskDataPath) {
            saveConfig(config);
        } else {
            console.error("No Flask data folder selected.");
            return null;
        }
    }

    return config;
}

app.whenReady().then(async () => {
    const config = await getPaths();
    if (!config) return;

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true
        }
    });

    // Start Flask server with data path as argument
    flaskProcess = exec(`"${config.flaskExePath}" "${config.flaskDataPath}"`, (error, stdout, stderr) => {
        if (error) console.error(`Flask error: ${error.message}`);
        if (stderr) console.error(`Flask stderr: ${stderr}`);
    });

    setTimeout(() => {
        mainWindow.loadURL('http://127.0.0.1:5000');
    }, 3000);

    mainWindow.on('closed', () => {
        closeFlaskProcess();
        app.quit();
    });
});

app.on('window-all-closed', () => {
    closeFlaskProcess();
    app.quit();
});

// Function to properly terminate Flask
function closeFlaskProcess() {
    if (flaskProcess) {
        exec(`taskkill /F /IM app.exe`, (error, stdout, stderr) => {
            if (error) console.error(`Error closing Flask: ${error.message}`);
        });
        flaskProcess = null;
    }
}
