// Tiny preload for the pairing window so its in-page buttons can reach the
// main process without nodeIntegration. Exposed under window.vibemojiPair.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vibemojiPair', {
  refresh: () => ipcRenderer.send('vibemoji:refresh-pair-token'),
});
