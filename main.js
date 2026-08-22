const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron');

// Chromium's GPU compositor can produce visible ordered-dither bands across
// large dark surfaces on some Windows display/driver combinations. Render the
// Windows app in software so flat panels remain visually flat and consistent.
if (process.platform === 'win32') {
    app.disableHardwareAcceleration();
}
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
const LOG_FILE = path.join(app.getPath('userData'), 'flask_logs.json');
const INSTANCE_FILE = path.join(app.getPath('userData'), 'electron_instances.json');
const BACKEND_PID_FILE = path.join(app.getPath('userData'), 'flask_backend_pid.json');
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.ogg']);

let mainWindow;
let flaskProcess;
let isShuttingDown = false;

function isProcessRunning(pid) {
    if (!pid || pid === process.pid) return false;

    try {
        process.kill(pid, 0);
        return true;
    } catch (_error) {
        return false;
    }
}

function readActiveInstancePids() {
    try {
        if (!fs.existsSync(INSTANCE_FILE)) return [];

        const pids = JSON.parse(fs.readFileSync(INSTANCE_FILE, 'utf-8') || '[]');
        return Array.isArray(pids)
            ? pids.filter((pid) => Number.isInteger(pid) && isProcessRunning(pid))
            : [];
    } catch (error) {
        console.warn("Error reading Electron instance registry:", error.message);
        return [];
    }
}

function writeInstancePids(pids) {
    try {
        fs.writeFileSync(INSTANCE_FILE, JSON.stringify([...new Set(pids)], null, 4));
    } catch (error) {
        console.warn("Error writing Electron instance registry:", error.message);
    }
}

function registerElectronInstance() {
    writeInstancePids([...readActiveInstancePids(), process.pid]);
}

function unregisterElectronInstance() {
    const remainingPids = readActiveInstancePids().filter((pid) => pid !== process.pid);
    writeInstancePids(remainingPids);
    return remainingPids;
}

function hasOtherElectronInstances() {
    return readActiveInstancePids().some((pid) => pid !== process.pid);
}

function saveBackendPid(pid) {
    if (!pid) return;

    try {
        fs.writeFileSync(BACKEND_PID_FILE, JSON.stringify({ pid }, null, 4));
    } catch (error) {
        console.warn("Error writing Flask backend PID:", error.message);
    }
}

function getSavedBackendPid() {
    try {
        if (!fs.existsSync(BACKEND_PID_FILE)) return null;

        const backend = JSON.parse(fs.readFileSync(BACKEND_PID_FILE, 'utf-8') || '{}');
        return Number.isInteger(backend.pid) && isProcessRunning(backend.pid) ? backend.pid : null;
    } catch (error) {
        console.warn("Error reading Flask backend PID:", error.message);
        return null;
    }
}

function clearBackendPid(pid) {
    try {
        const savedPid = getSavedBackendPid();
        if (!fs.existsSync(BACKEND_PID_FILE) || (pid && savedPid && savedPid !== pid)) return;
        fs.unlinkSync(BACKEND_PID_FILE);
    } catch (error) {
        console.warn("Error clearing Flask backend PID:", error.message);
    }
}

function getLaunchFilePath() {
    const candidates = (process.argv || []).slice(1).filter(Boolean);

    for (const candidate of candidates) {
        if (!candidate || candidate === app.getPath('exe') || candidate === process.execPath) continue;

        const normalized = path.normalize(candidate);
        const extension = path.extname(normalized).toLowerCase();

        if (fs.existsSync(normalized) && fs.statSync(normalized).isFile()) {
            return extension && VIDEO_EXTENSIONS.has(extension) ? normalized : null;
        }

        if (extension && VIDEO_EXTENSIONS.has(extension)) {
            return normalized;
        }
    }

    return null;
}

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

function isServerReady(url, timeout = 1000) {
    return waitForServer(url, timeout)
        .then(() => true)
        .catch(() => false);
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



ipcMain.handle('open-in-explorer', async (_event, targetPath) => {
    try {
        if (!targetPath || typeof targetPath !== 'string') {
            return { success: false, message: 'No file path was provided.' };
        }

        const normalizedPath = path.normalize(targetPath);

        if (fs.existsSync(normalizedPath)) {
            const stats = fs.statSync(normalizedPath);
            if (stats.isDirectory()) {
                const errorMessage = await shell.openPath(normalizedPath);
                return errorMessage
                    ? { success: false, message: errorMessage }
                    : { success: true };
            }

            shell.showItemInFolder(normalizedPath);
            return { success: true };
        }

        const parentPath = path.dirname(normalizedPath);
        if (parentPath && parentPath !== normalizedPath && fs.existsSync(parentPath)) {
            const errorMessage = await shell.openPath(parentPath);
            return errorMessage
                ? { success: false, message: errorMessage }
                : { success: true, message: 'Original path was missing, opened the parent folder instead.' };
        }

        return { success: false, message: `Path does not exist: ${normalizedPath}` };
    } catch (error) {
        return { success: false, message: error.message || 'Failed to open path in Explorer.' };
    }
});


function getEpisodeNumberFromFilename(filename) {
    const parsed = path.parse(path.basename(String(filename || '')));
    const ext = parsed.ext.toLowerCase();

    if (!VIDEO_EXTENSIONS.has(ext))
        return null;

    const stem = parsed.name;

    // Pure numeric filenames: 1.mkv, 001.mp4
    if (/^\d+$/.test(stem))
        return Number.parseInt(stem, 10);

    // Episode keywords
    const match = stem.match(
        /(?:^|[\s._-])(?:s\d{1,2}e|episode|episodes|ep|eps|e)?[\s._-]*(\d{1,4})(?:v\d+)?(?:[\s._-]*(?:end|final))?(?=[\s._-]|$)/i
    );

    if (match)
        return Number.parseInt(match[1].replace(/^0+/, '') || '0', 10);

    return null;
}
function listVideoFiles(directory) {
    const files = [];
    for (const filename of fs.readdirSync(directory)) {
        const filepath = path.join(directory, filename);
        let fileStat;
        try {
            fileStat = fs.statSync(filepath);
        } catch (_error) {
            continue;
        }
        const ext = path.extname(filename).toLowerCase();
        if (fileStat.isFile() && VIDEO_EXTENSIONS.has(ext)) {
            files.push(filepath);
        }
    }
    return files;
}

function findEpisodeVideoFile(directory, episodeNumber) {
    if (!directory || !fs.existsSync(directory)) return null;

    let stat;
    try {
        stat = fs.statSync(directory);
    } catch (_error) {
        return null;
    }
    if (!stat.isDirectory()) return null;

    const targetNumber = Number(episodeNumber);
    const videoFiles = listVideoFiles(directory);

    // Detect each file's embedded episode number, keep only files where one
    // was found, then sort ascending by that number. Once sorted, the files
    // are handed out under sequential numbers (1, 2, 3, ...) regardless of
    // what number is actually embedded in the filename -- this way a season
    // folder that keeps the show's absolute numbering (e.g. starts at
    // "14.mkv") still lines up with the app's per-season episode numbers.
    const numberedFiles = videoFiles
        .map((filepath) => ({ number: getEpisodeNumberFromFilename(path.basename(filepath)), filepath }))
        .filter((item) => item.number !== null)
        .sort((a, b) => a.number - b.number || path.basename(a.filepath).toLowerCase().localeCompare(path.basename(b.filepath).toLowerCase()));

    if (targetNumber >= 1 && targetNumber <= numberedFiles.length) {
        return numberedFiles[targetNumber - 1].filepath;
    }

    return null;
}

function checkEpisodeAvailability(episode, animeDirectory) {
    const directPath = episode.file_path ? path.normalize(episode.file_path) : '';
    if (directPath && fs.existsSync(directPath)) {
        const stat = fs.statSync(directPath);
        if (stat.isFile()) {
            return { ...episode, exists: true, resolved_path: directPath, match_type: 'direct' };
        }
    }

    const searchDirectory = episode.directory || animeDirectory || (directPath ? path.dirname(directPath) : '');
    const matchedPath = findEpisodeVideoFile(path.normalize(searchDirectory || ''), episode.number);
    if (matchedPath) {
        return { ...episode, exists: true, resolved_path: matchedPath, match_type: 'episode-number' };
    }

    return { ...episode, exists: false, resolved_path: null, match_type: 'missing' };
}

ipcMain.handle('check-anime-episode-files', async (_event, payload) => {
    try {
        const animeDirectory = payload && payload.directory ? path.normalize(payload.directory) : '';
        const episodes = Array.isArray(payload?.episodes) ? payload.episodes : [];
        const checkedEpisodes = episodes.map((episode) => checkEpisodeAvailability(episode, animeDirectory));
        const foundCount = checkedEpisodes.filter((episode) => episode.exists).length;

        return {
            success: true,
            anime: {
                exists: foundCount > 0,
                complete: episodes.length > 0 && foundCount === episodes.length,
                found_count: foundCount,
                total_count: episodes.length,
                directory_exists: Boolean(animeDirectory && fs.existsSync(animeDirectory))
            },
            episodes: checkedEpisodes
        };
    } catch (error) {
        return { success: false, message: error.message || 'Failed to check episode files.' };
    }
});

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

async function selectFile(title, filters = []) {
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
        title,
        properties: ['openFile'],
        filters
    });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
}

function getElectronStatus() {
    const config = loadConfig();
    return {
        success: true,
        isPackaged: app.isPackaged,
        appVersion: app.getVersion(),
        userDataPath: app.getPath('userData'),
        configFile: CONFIG_FILE,
        logFile: LOG_FILE,
        flaskExePath: config.flaskExePath || '',
        flaskDataPath: config.flaskDataPath || '',
        serverURL: config.serverURL || 'http://127.0.0.1:7777'
    };
}

function createAppMenu() {
    const template = [
        {
            label: 'App',
            submenu: [
                { label: 'Reload Window', accelerator: 'CmdOrCtrl+R', click: () => mainWindow && mainWindow.reload() },
                { label: 'Toggle Full Screen', accelerator: 'F11', click: () => mainWindow && mainWindow.setFullScreen(!mainWindow.isFullScreen()) },
                { label: 'Toggle DevTools', accelerator: 'CmdOrCtrl+Shift+I', click: () => mainWindow && mainWindow.webContents.toggleDevTools() },
                { type: 'separator' },
                { label: 'Restart App', click: () => { app.relaunch(); app.exit(0); } },
                { label: 'Quit', accelerator: 'Alt+F4', click: () => app.quit() }
            ]
        },
        {
            label: 'Paths',
            submenu: [
                { label: 'Change Flask app.exe Path', click: async () => { const selected = await selectFile('Select compiled Flask app.exe', [{ name: 'Executable', extensions: ['exe'] }]); if (selected) { const config = loadConfig(); config.flaskExePath = selected; saveConfig(config); } } },
                { label: 'Change Flask Data Folder', click: async () => { const selected = await selectFolder('Select Flask project/data folder'); if (selected) { const config = loadConfig(); config.flaskDataPath = selected; saveConfig(config); } } },
                { type: 'separator' },
                { label: 'Open Flask Data Folder', click: () => { const config = loadConfig(); if (config.flaskDataPath) shell.openPath(config.flaskDataPath); } },
                { label: 'Open Config Folder', click: () => shell.openPath(app.getPath('userData')) },
                { label: 'Open Flask Logs', click: () => fs.existsSync(LOG_FILE) ? shell.openPath(LOG_FILE) : shell.openPath(app.getPath('userData')) }
            ]
        },
        {
            label: 'Window',
            submenu: [
                { label: 'Minimize', accelerator: 'CmdOrCtrl+M', click: () => mainWindow && mainWindow.minimize() },
                { label: 'Maximize / Restore', click: () => mainWindow && (mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()) },
                { label: 'Always on Top', type: 'checkbox', click: (item) => mainWindow && mainWindow.setAlwaysOnTop(item.checked) }
            ]
        }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('electron-window-control', async (_event, action) => {
    if (!mainWindow) return { success: false, message: 'Window is not ready.' };
    switch (action) {
        case 'minimize': mainWindow.minimize(); return { success: true };
        case 'maximize':
            mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
            return { success: true, maximized: mainWindow.isMaximized() };
        case 'close': mainWindow.close(); return { success: true };
        case 'reload': mainWindow.reload(); return { success: true };
        case 'fullscreen': mainWindow.setFullScreen(!mainWindow.isFullScreen()); return { success: true, fullscreen: mainWindow.isFullScreen() };
        case 'devtools': mainWindow.webContents.toggleDevTools(); return { success: true };
        case 'always-on-top': mainWindow.setAlwaysOnTop(!mainWindow.isAlwaysOnTop()); return { success: true, alwaysOnTop: mainWindow.isAlwaysOnTop() };
        case 'restart': app.relaunch(); app.exit(0); return { success: true };
        default: return { success: false, message: `Unknown window action: ${action}` };
    }
});

ipcMain.handle('electron-get-status', async () => getElectronStatus());

ipcMain.handle('electron-select-flask-exe', async () => {
    const selected = await selectFile('Select compiled Flask app.exe', [{ name: 'Executable', extensions: ['exe'] }]);
    if (!selected) return { success: false, cancelled: true };
    const config = loadConfig();
    config.flaskExePath = selected;
    saveConfig(config);
    return getElectronStatus();
});

ipcMain.handle('electron-select-flask-data-folder', async () => {
    const selected = await selectFolder('Select Flask project/data folder containing static, templates, and data');
    if (!selected) return { success: false, cancelled: true };
    const config = loadConfig();
    config.flaskDataPath = selected;
    saveConfig(config);
    return getElectronStatus();
});

ipcMain.handle('electron-open-config-folder', async () => {
    const message = await shell.openPath(app.getPath('userData'));
    return message ? { success: false, message } : { success: true };
});

ipcMain.handle('electron-open-flask-data-folder', async () => {
    const config = loadConfig();
    if (!config.flaskDataPath) return { success: false, message: 'Flask data folder has not been set yet.' };
    const message = await shell.openPath(config.flaskDataPath);
    return message ? { success: false, message } : { success: true };
});

ipcMain.handle('electron-open-flask-logs', async () => {
    const target = fs.existsSync(LOG_FILE) ? LOG_FILE : app.getPath('userData');
    const message = await shell.openPath(target);
    return message ? { success: false, message } : { success: true };
});

ipcMain.handle('electron-reset-paths', async () => {
    const { response } = await dialog.showMessageBox(mainWindow || undefined, {
        type: 'warning',
        buttons: ['Reset Saved Paths', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Reset Saved Paths',
        message: 'Reset the saved Flask executable and data folder paths?',
        detail: 'You will be asked to select them again the next time the compiled backend mode is used.'
    });
    if (response !== 0) return { success: false, cancelled: true };
    const config = loadConfig();
    delete config.flaskExePath;
    delete config.flaskDataPath;
    saveConfig(config);
    return getElectronStatus();
});

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
    registerElectronInstance();

    const launchFilePath = getLaunchFilePath();
    let useLocalServer = !launchFilePath;

    if (useLocalServer) {
        const { response } = await dialog.showMessageBox({
            type: 'question',
            buttons: ['Compiled Flask App (.exe)', 'Local Flask Server'],
            defaultId: 0,
            cancelId: 1,
            title: 'Select Flask Run Mode',
            message: 'How do you want to run the Flask backend?',
            detail: 'Choose whether to use the compiled Flask app.exe or connect to a locally running Flask development server.'
        });

        useLocalServer = (response === 1);
    }

    let serverURL = 'http://127.0.0.1:7777';
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

        const savedBackendPid = getSavedBackendPid();
        const existingServerReady = await isServerReady(serverURL);

        if (existingServerReady || savedBackendPid) {
            console.log("Flask server is already running; reusing existing backend.");
            if (!existingServerReady) {
                try {
                    await waitForServer(serverURL);
                } catch (err) {
                    console.error("Flask server did not start in time:", err.message);
                }
            }
        } else {
            flaskProcess = spawn(flaskExePath, [config.flaskDataPath], {
                cwd: flaskCwd,
                detached: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: false
            });

            saveBackendPid(flaskProcess.pid);

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

            console.log("Waiting for Flask server to start...");
            try {
                await waitForServer(serverURL);
                console.log("Flask server is ready!");
            } catch (err) {
                console.error("Flask server did not start in time:", err.message);
            }
        }
    } else {
        console.log("Using local Flask development server...");
    }

    createAppMenu();

    // ✅ Create main window
    mainWindow = new BrowserWindow({
        width: 1320,
        height: 860,
        minWidth: 980,
        minHeight: 680,
        backgroundColor: '#050506',
        title: 'Anime Manager',
        frame: false,
        titleBarStyle: 'hidden',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    const launchTarget = launchFilePath
        ? `/custom_player?launch_path=${encodeURIComponent(launchFilePath)}`
        : '/';

    const finalURL = `${serverURL}${launchTarget}`;
    console.log("🌐 Loading URL:", finalURL);
    mainWindow.loadURL(finalURL);


    mainWindow.setMenuBarVisibility(false);

    mainWindow.on('closed', () => {
        shutdownApp(useLocalServer);
    });
});

app.on('window-all-closed', () => {
    shutdownApp(!flaskProcess);
});

app.on('will-quit', () => {
    unregisterElectronInstance();
});

function shutdownApp(useLocalServer) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    unregisterElectronInstance();

    if (!useLocalServer) {
        if (hasOtherElectronInstances()) {
            console.log("Other Electron instance is still running; keeping Flask process alive.");
        } else {
            closeFlaskProcess();
        }
    }

    app.quit();
}

function closeFlaskProcess() {
    const backendPid = flaskProcess?.pid || getSavedBackendPid();

    if (backendPid) {
        console.log(`Attempting to kill Flask process with PID ${backendPid}...`);
        try {
            process.kill(backendPid);
            console.log(`Killed Flask process by PID: ${backendPid}`);
        } catch (error) {
            console.warn(`Could not kill by PID: ${error.message}`);
        }

        if (process.platform === 'win32') {
            exec(`taskkill /PID ${backendPid} /T /F`, (err, stdout, stderr) => {
                if (err) console.error(`[taskkill ERROR]: ${err.message}`);
                else {
                    console.log(`[taskkill OUTPUT]: ${stdout}`);
                    if (stderr) console.error(`[taskkill STDERR]: ${stderr}`);
                }
            });
        }
        clearBackendPid(backendPid);
        flaskProcess = null;
    }
}
