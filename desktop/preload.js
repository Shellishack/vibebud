const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vibemoji', {
  platform: process.platform,
  isElectron: true,
  setInteractive: (interactive) => ipcRenderer.send('set-interactive', Boolean(interactive)),
  setFocusable: (focusable) => ipcRenderer.send('set-focusable', Boolean(focusable)),
  setBounds: (payload) => ipcRenderer.send('set-bounds', payload),
  getCursorPoint: () => ipcRenderer.invoke('get-cursor-point'),
  onSpawnBuddy: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('spawn-buddy', handler);
    return () => ipcRenderer.off('spawn-buddy', handler);
  },
  showNotification: (payload) => ipcRenderer.send('vibemoji:notify', payload),
  onOpenSettings: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('vibemoji:open-settings', handler);
    return () => ipcRenderer.off('vibemoji:open-settings', handler);
  },
});
