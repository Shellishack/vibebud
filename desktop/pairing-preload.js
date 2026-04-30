// Tiny preload for the pairing window so its in-page buttons can reach the
// main process without nodeIntegration. Exposed under window.vibebudPair.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vibebudPair', {
  refresh: () => ipcRenderer.send('vibebud:refresh-pair-token'),
});
