const { contextBridge, ipcRenderer, shell } = require('electron');
const path = require('path');

contextBridge.exposeInMainWorld('ipcRenderer', {
    send: (channel, ...arg) => ipcRenderer.send(channel, ...arg),
    on: (event, ...data) => ipcRenderer.on(event, ...data),
    removeAllListeners: () => ipcRenderer.removeAllListeners()
});

contextBridge.exposeInMainWorld('shell', {
    openProxyModsPath: () => shell.openPath(path.join(process.cwd(), 'proxy', 'mods')),
    openExternal: (url) => shell.openExternal(url)
});