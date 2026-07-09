const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
const LOG_FILE = path.join(app.getPath('userData'), 'flask_logs.json');
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.ogg']);

let mainWindow;
let flaskProcess;

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