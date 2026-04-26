const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vibemoji', {
  platform: process.platform,
  isElectron: true,
  setInteractive: (interactive) => ipcRenderer.send('set-interactive', Boolean(interactive)),
  setFocusable: (focusable) => ipcRenderer.send('set-focusable', Boolean(focusable)),
});
