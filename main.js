const { app, BrowserWindow, dialog } = require('electron');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
const LOG_FILE = path.join(app.getPath('userData'), 'flask_logs.json');

let mainWindow;
let flaskProcess;

// 🧹 Clear previous logs
fs.writeFileSync(LOG_FILE, '[]'); // Start fresh with empty JSON array

// 🧾 Log helper
function logToFile(type, data) {
    try {
        const logEntry = {
            timestamp: new Date().toISOString(),
            type,
            message: data.toString().trim()
        };

        let existingLogs = [];
        if (fs.existsSync(LOG_FILE)) {
            const content = fs.readFileSync(LOG_FILE, 'utf-8');
            existingLogs = JSON.parse(content || '[]');
        }

        existingLogs.push(logEntry);

        fs.writeFileSync(LOG_FILE, JSON.stringify(existingLogs, null, 4));
    } catch (err) {
        console.error("Log error:", err);
    }
}


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

    if (!config.flaskExePath || !fs.existsSync(config.flaskExePath)) {
        const folder = await selectFolder("Select the folder containing app.exe");
        if (folder) {
            config.flaskExePath = path.join(folder, "app.exe");
            saveConfig(config);
        } else {
            console.error("No Flask executable selected.");
            return null;
        }
    }

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

    // ✅ Spawn Flask with full process control
    flaskProcess = spawn(config.flaskExePath, [config.flaskDataPath], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
    });

    flaskProcess.stdout.on('data', (data) => {
        const msg = `[FLASK]: ${data.toString().trim()}`;
        console.log(msg);
        logToFile('stdout', data);
    });

    flaskProcess.stderr.on('data', (data) => {
        const msg = `[FLASK ERROR]: ${data.toString().trim()}`;
        console.error(msg);
        logToFile('stderr', data);
    });

    flaskProcess.on('close', (code) => {
        const msg = `[FLASK CLOSED]: Process exited with code ${code}`;
        console.log(msg);
        logToFile('exit', msg);
    });

    flaskProcess.unref(); // allow Electron to quit without waiting

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

function closeFlaskProcess() {
    if (flaskProcess && flaskProcess.pid) {
        console.log(`Attempting to kill Flask process with PID ${flaskProcess.pid}...`);

        try {
            process.kill(flaskProcess.pid);
            console.log(`Killed Flask process by PID: ${flaskProcess.pid}`);
        } catch (error) {
            console.warn(`Could not kill by PID: ${error.message}`);
        }

        if (process.platform === 'win32') {
            exec('taskkill /IM app.exe /F', (err, stdout, stderr) => {
                if (err) {
                    console.error(`[taskkill ERROR]: ${err.message}`);
                } else {
                    console.log(`[taskkill OUTPUT]: ${stdout}`);
                    if (stderr) console.error(`[taskkill STDERR]: ${stderr}`);
                }
            });
        }

        flaskProcess = null;
    }
}
