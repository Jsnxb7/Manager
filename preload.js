const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    isElectron: true,
    openInExplorer: (targetPath) => ipcRenderer.invoke('open-in-explorer', targetPath),
    checkAnimeEpisodeFiles: (payload) => ipcRenderer.invoke('check-anime-episode-files', payload),

    // Electron shell/window options used by the themed title bar.
    getStatus: () => ipcRenderer.invoke('electron-get-status'),
    windowControl: (action) => ipcRenderer.invoke('electron-window-control', action),
    selectFlaskExe: () => ipcRenderer.invoke('electron-select-flask-exe'),
    selectFlaskDataFolder: () => ipcRenderer.invoke('electron-select-flask-data-folder'),
    openConfigFolder: () => ipcRenderer.invoke('electron-open-config-folder'),
    openFlaskDataFolder: () => ipcRenderer.invoke('electron-open-flask-data-folder'),
    openFlaskLogs: () => ipcRenderer.invoke('electron-open-flask-logs'),
    resetPaths: () => ipcRenderer.invoke('electron-reset-paths')
});
