const { app, BrowserWindow, dialog } = require('electron');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
const LOG_FILE = path.join(app.getPath('userData'), 'flask_logs.json');

let mainWindow;
let flaskProcess;

// 🧹 Clear previous logs
fs.writeFileSync(LOG_FILE, '[]');

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

// ✅ Wait until Flask actually starts serving
function waitForServer(url, timeout = 20000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();

        const check = () => {
            http.get(url, (res) => {
                if (res.statusCode === 200) resolve(true);
                else retry();
            }).on('error', () => {
                if (Date.now() - start > timeout) reject(new Error("Server startup timeout"));
                else setTimeout(check, 1000);
            });
        };

        const retry = () => setTimeout(check, 1000);
        check();
    });
}

// Load / save config
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

function saveConfig(config) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 4));
    } catch (error) {
        console.error("Error saving config:", error);
    }
}

// Folder selector
async function selectFolder(title) {
    const result = await dialog.showOpenDialog({
        title: title,
        properties: ['openDirectory']
    });
    return result.filePaths.length > 0 ? result.filePaths[0] : null;
}

// Get paths
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
    const { response } = await dialog.showMessageBox({
        type: 'question',
        buttons: ['Compiled Flask App (.exe)', 'Local Flask Server'],
        defaultId: 0,
        cancelId: 1,
        title: 'Select Flask Run Mode',
        message: 'How do you want to run the Flask backend?',
        detail: 'Choose whether to use the compiled Flask app.exe or connect to a locally running Flask development server.'
    });

    let useLocalServer = (response === 1);
    let serverURL = 'http://127.0.0.1:5000';
    let config = {};

    if (!useLocalServer) {
        config = await getPaths();
        if (!config) return;

        const isDev = !app.isPackaged;
        let flaskExePath = config.flaskExePath;
        let flaskCwd = path.dirname(flaskExePath);

        if (!isDev) {
            const builtExe = path.join(process.resourcesPath, 'backend', 'app.exe');
            if (fs.existsSync(builtExe)) {
                flaskExePath = builtExe;
                flaskCwd = path.dirname(flaskExePath);
                console.log("📦 Using packaged Flask exe:", flaskExePath);
            } else {
                console.warn("⚠️ Packaged Flask EXE not found, using configured path:", flaskExePath);
            }
        } else {
            console.log("🧩 Using local dev Flask exe:", flaskExePath);
        }

        // 🧠 Start Flask process
        flaskProcess = spawn(flaskExePath, [config.flaskDataPath], {
            cwd: flaskCwd,
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false
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

        flaskProcess.unref();

        // 🕐 Wait for Flask server to become ready
        console.log("⏳ Waiting for Flask server to start...");
        try {
            await waitForServer(serverURL);
            console.log("✅ Flask server is ready!");
        } catch (err) {
            console.error("❌ Flask server did not start in time:", err.message);
        }
    } else {
        console.log("🔗 Using local Flask development server...");
    }

    // ✅ Create main window
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: { nodeIntegration: true }
    });

    console.log("🌐 Loading URL:", serverURL);
    mainWindow.loadURL(serverURL);

    mainWindow.on('closed', () => {
        if (!useLocalServer) closeFlaskProcess();
        app.quit();
    });
});

app.on('window-all-closed', () => {
    if (!flaskProcess) app.quit();
    else {
        closeFlaskProcess();
        app.quit();
    }
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
                if (err) console.error(`[taskkill ERROR]: ${err.message}`);
                else {
                    console.log(`[taskkill OUTPUT]: ${stdout}`);
                    if (stderr) console.error(`[taskkill STDERR]: ${stderr}`);
                }
            });
        }
        flaskProcess = null;
    }
}
