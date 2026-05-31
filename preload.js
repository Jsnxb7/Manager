const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    openInExplorer: (targetPath) => ipcRenderer.invoke('open-in-explorer', targetPath),
    checkAnimeEpisodeFiles: (payload) => ipcRenderer.invoke('check-anime-episode-files', payload)
});
