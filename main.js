const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron');

// Keep Chromium's GPU compositor enabled by default. This UI uses a full-screen
// video and translucent surfaces, which are prohibitively expensive to render
// in software. The environment override remains available for machines with a
// broken display driver.
if (process.platform === 'win32' && process.env.ANIME_MANAGER_SOFTWARE_RENDERING === '1') {
    app.disableHardwareAcceleration();
}
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { createBufferedLogger } = require('./buffered_logger');

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
const LOG_FILE = path.join(app.getPath('userData'), 'flask_logs.json');
const INSTANCE_FILE = path.join(app.getPath('userData'), 'electron_instances.json');
const BACKEND_PID_FILE = path.join(app.getPath('userData'), 'flask_backend_pid.json');
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.ogg']);

let mainWindow;
let flaskProcess;
let isShuttingDown = false;
let activeFlaskDataPath;
let activeServerURL;
let usingCompiledBackend = false;

// One Electron process owns the UI and its shared local Flask lifecycle. A
// second launch focuses the existing window instead of creating another app
// process that can accidentally tear down the shared backend when it closes.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
    app.quit();
}

app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
});

function cleanupCustomMedia(flaskDataPath, reason) {
    if (!flaskDataPath) return { removed: 0, failures: [] };

    const staticRoot = path.resolve(flaskDataPath, 'static');
    const customMediaRoot = path.resolve(staticRoot, 'custom_media');

    // Keep deletion constrained to <selected Flask data>/static/custom_media.
    if (path.dirname(customMediaRoot) !== staticRoot || path.basename(customMediaRoot) !== 'custom_media') {
        console.error(`Refusing unsafe custom media cleanup path: ${customMediaRoot}`);
        return { removed: 0, failures: [customMediaRoot] };
    }

    let removed = 0;
    const failures = [];

    try {
        fs.mkdirSync(customMediaRoot, { recursive: true });
        for (const entry of fs.readdirSync(customMediaRoot)) {
            const target = path.join(customMediaRoot, entry);
            try {
                fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
                removed += 1;
            } catch (error) {
                failures.push(entry);
                console.warn(`Could not remove custom media ${target}: ${error.message}`);
            }
        }

        const playlistPath = path.join(
            path.resolve(flaskDataPath, 'instance'),
            'custom_player_data',
            'custom_playlist.json'
        );
        if (fs.existsSync(playlistPath)) {
            fs.writeFileSync(playlistPath, '[]', 'utf-8');
        }
    } catch (error) {
        failures.push(customMediaRoot);
        console.warn(`Custom media cleanup failed during ${reason}: ${error.message}`);
    }

    console.log(`Custom media cleanup (${reason}): removed=${removed}, failures=${failures.length}`);
    return { removed, failures };
}

function restartApp() {
    if (isShuttingDown) return;
    app.relaunch();
    shutdownApp();
}

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

// Keep recent diagnostics without synchronous disk I/O on every server message.
const logToFile = createBufferedLogger(LOG_FILE);

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

function configureAnimeLibrary(serverURL, root) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ root });
        const request = http.request(new URL('/api/anime-library', serverURL), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, (response) => {
            let content = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => { content += chunk; });
            response.on('error', reject);
            response.on('end', () => {
                try {
                    const result = JSON.parse(content);
                    if (response.statusCode !== 200 || result.status !== 'success') {
                        throw new Error(result.message || 'The backend could not set the anime folder.');
                    }
                    resolve(result);
                } catch (error) {
                    reject(new Error(`Anime folder setup failed: ${error.message}`));
                }
            });
        });
        request.setTimeout(15000, () => request.destroy(new Error('Anime folder setup timed out.')));
        request.on('error', reject);
        request.end(body);
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
async function listVideoFiles(directory) {
    const files = [];
    for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
        const filepath = path.join(directory, entry.name);
        const ext = path.extname(entry.name).toLowerCase();
        if (VIDEO_EXTENSIONS.has(ext) && (entry.isFile() ||
            (entry.isSymbolicLink() && (await safeFileStat(filepath))?.isFile()))) {
            files.push(filepath);
        }
    }
    return files;
}

async function safeFileStat(target) {
    if (!target) return null;
    try {
        return await fs.promises.stat(target);
    } catch (_error) {
        return null;
    }
}

async function findEpisodeVideoFile(directory, episodeNumber, directoryCache) {
    if (!directory) return null;

    const targetNumber = Number(episodeNumber);
    if (!directoryCache.has(directory)) {
        directoryCache.set(directory, listVideoFiles(directory).then(videoFiles => videoFiles
            .map((filepath) => ({ number: getEpisodeNumberFromFilename(path.basename(filepath)), filepath }))
            .filter((item) => item.number !== null)
            .sort((a, b) => a.number - b.number || path.basename(a.filepath).toLowerCase().localeCompare(path.basename(b.filepath).toLowerCase()))
        ).catch(() => []));
    }

    // Detect each file's embedded episode number, keep only files where one
    // was found, then sort ascending by that number. Once sorted, the files
    // are handed out under sequential numbers (1, 2, 3, ...) regardless of
    // what number is actually embedded in the filename -- this way a season
    // folder that keeps the show's absolute numbering (e.g. starts at
    // "14.mkv") still lines up with the app's per-season episode numbers.
    const numberedFiles = await directoryCache.get(directory);

    if (targetNumber >= 1 && targetNumber <= numberedFiles.length) {
        return numberedFiles[targetNumber - 1].filepath;
    }

    return null;
}

async function checkEpisodeAvailability(episode, animeDirectory, directoryCache) {
    const directPath = episode.file_path ? path.normalize(episode.file_path) : '';
    const stat = await safeFileStat(directPath);
    if (stat?.isFile()) {
            return { ...episode, exists: true, resolved_path: directPath, match_type: 'direct' };
    }

    const searchDirectory = episode.directory || animeDirectory || (directPath ? path.dirname(directPath) : '');
    const matchedPath = await findEpisodeVideoFile(searchDirectory ? path.normalize(searchDirectory) : '', episode.number, directoryCache);
    if (matchedPath) {
        return { ...episode, exists: true, resolved_path: matchedPath, match_type: 'episode-number' };
    }

    return { ...episode, exists: false, resolved_path: null, match_type: 'missing' };
}

ipcMain.handle('check-anime-episode-files', async (_event, payload) => {
    try {
        const animeDirectory = payload && payload.directory ? path.normalize(payload.directory) : '';
        const episodes = Array.isArray(payload?.episodes) ? payload.episodes : [];
        const directoryCache = new Map();
        const checkedEpisodes = [];
        // Limit filesystem concurrency and reuse each folder listing for this check.
        for (let offset = 0; offset < episodes.length; offset += 16) {
            checkedEpisodes.push(...await Promise.all(episodes.slice(offset, offset + 16)
                .map(episode => checkEpisodeAvailability(episode, animeDirectory, directoryCache))));
        }
        const foundCount = checkedEpisodes.filter((episode) => episode.exists).length;

        return {
            success: true,
            anime: {
                exists: foundCount > 0,
                complete: episodes.length > 0 && foundCount === episodes.length,
                found_count: foundCount,
                total_count: episodes.length,
                directory_exists: Boolean((await safeFileStat(animeDirectory))?.isDirectory())
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
async function selectFolder(title, defaultPath) {
    const result = await dialog.showOpenDialog({
        title: title,
        ...(defaultPath ? { defaultPath } : {}),
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
        animeLibraryRoot: config.animeLibraryRoot || '',
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
                { label: 'Restart App', click: restartApp },
                { label: 'Quit', accelerator: 'Alt+F4', click: () => app.quit() }
            ]
        },
        {
            label: 'Paths',
            submenu: [
                { label: 'Change Flask app.exe Path', click: async () => { const selected = await selectFile('Select compiled Flask app.exe', [{ name: 'Executable', extensions: ['exe'] }]); if (selected) { const config = loadConfig(); config.flaskExePath = selected; saveConfig(config); } } },
                { label: 'Change Flask Data Folder', click: async () => { const selected = await selectFolder('Select Flask project/data folder'); if (selected) { const config = loadConfig(); config.flaskDataPath = selected; saveConfig(config); } } },
                { label: 'Change Anime Series Folder', click: async () => {
                    const result = await changeAnimeLibrary();
                    if (!result.success && !result.cancelled) dialog.showErrorBox('Could not change anime folder', result.message);
                } },
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
        case 'restart': restartApp(); return { success: true };
        default: return { success: false, message: `Unknown window action: ${action}` };
    }
});

ipcMain.handle('electron-get-status', async () => getElectronStatus());

async function changeAnimeLibrary() {
    const selected = await selectFolder('Select your Anime library folder (contains the series folders)', loadConfig().animeLibraryRoot);
    if (!selected) return { success: false, cancelled: true };
    try {
        if (!activeServerURL) throw new Error('The backend is not ready yet.');
        const result = await configureAnimeLibrary(activeServerURL, selected);
        saveConfig({ ...loadConfig(), animeLibraryRoot: selected });
        if (mainWindow) mainWindow.reload();
        return { ...getElectronStatus(), message: `Anime folder updated. Rewrote paths for ${result.updated} entries.` };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

ipcMain.handle('electron-select-anime-library', changeAnimeLibrary);

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
        message: 'Reset the saved Flask executable, data folder, and anime series folder paths?',
        detail: 'You will be asked for the anime folder on next launch, and the Flask paths when compiled backend mode is used.'
    });
    if (response !== 0) return { success: false, cancelled: true };
    const config = loadConfig();
    delete config.flaskExePath;
    delete config.flaskDataPath;
    delete config.animeLibraryRoot;
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
    if (!hasSingleInstanceLock) return;
    registerElectronInstance();

    const startupConfig = loadConfig();
    let animeLibraryRoot = startupConfig.animeLibraryRoot;
    let hasSavedLibrary = false;
    try {
        hasSavedLibrary = Boolean(animeLibraryRoot && fs.statSync(animeLibraryRoot).isDirectory());
    } catch (_) { /* Ask again when the saved folder is no longer available. */ }
    if (!hasSavedLibrary) {
        animeLibraryRoot = await selectFolder(
            'Select your Anime library folder (contains the series folders)',
            startupConfig.animeLibraryRoot
        );
    }
    if (!animeLibraryRoot) {
        app.quit();
        return;
    }

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
        usingCompiledBackend = true;
        config = await getPaths();
        if (!config) return;
        activeFlaskDataPath = config.flaskDataPath;

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
            cleanupCustomMedia(activeFlaskDataPath, 'backend startup');
            flaskProcess = spawn(flaskExePath, [config.flaskDataPath], {
                cwd: flaskCwd,
                detached: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: false,
                env: { ...process.env, ANIME_MANAGER_ELECTRON_INSTANCE_FILE: INSTANCE_FILE }
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

    try {
        await waitForServer(serverURL);
        await configureAnimeLibrary(serverURL, animeLibraryRoot);
        activeServerURL = serverURL;
        saveConfig({ ...loadConfig(), animeLibraryRoot });
    } catch (error) {
        dialog.showErrorBox('Could not configure anime library',
            `${error.message}\nRebuild/restart the Flask backend if it does not support library selection.`);
        shutdownApp();
        return;
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
    // The Flask app serves locally mutable templates/assets. Start every
    // Electron session with an empty HTTP cache so a changed stylesheet,
    // script, or generated cover cannot be held over from a prior launch.
    await mainWindow.webContents.session.clearCache();
    mainWindow.loadURL(finalURL);


    mainWindow.setMenuBarVisibility(false);

    mainWindow.once('closed', () => {
        mainWindow = null;
    });
});

app.on('window-all-closed', () => {
    if (hasSingleInstanceLock) shutdownApp();
});

app.on('will-quit', () => {
    unregisterElectronInstance();
});

function askBackendToShutdownIfIdle(serverURL) {
    return new Promise((resolve, reject) => {
        const request = http.request(new URL('/api/backend-lifecycle/idle', serverURL), {
            method: 'POST',
            headers: { 'Content-Length': 0 }
        }, (response) => {
            let content = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { content += chunk; });
            response.on('end', () => {
                try {
                    const result = JSON.parse(content);
                    if (response.statusCode !== 200 || result.status !== 'success') {
                        throw new Error(result.message || 'Backend lifecycle request failed.');
                    }
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            });
        });
        request.setTimeout(5000, () => request.destroy(new Error('Backend lifecycle request timed out.')));
        request.on('error', reject);
        request.end();
    });
}

async function shutdownApp() {
    if (isShuttingDown) return;
    isShuttingDown = true;

    unregisterElectronInstance();

    if (usingCompiledBackend) {
        try {
            await askBackendToShutdownIfIdle(activeServerURL || 'http://127.0.0.1:7777');
            console.log('Flask will check the Electron registry for 10 seconds before deciding whether to exit.');
        } catch (error) {
            console.warn(`Could not request Flask idle shutdown: ${error.message}`);
        }
    }

    app.quit();
}
