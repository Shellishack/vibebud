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
  showPairing: () => ipcRenderer.send('vibemoji:show-pairing'),
  onOpenSettings: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('vibemoji:open-settings', handler);
    return () => ipcRenderer.off('vibemoji:open-settings', handler);
  },
  // Per-buddy Claude Code session bridge. The main process spawns one
  // long-running `claude` subprocess per buddyId in stream-json mode and
  // pipes user turns in / event lines out. Renderer never touches child_process.
  claude: {
    start: (buddyId, opts) => ipcRenderer.invoke('claude:start', { buddyId, opts }),
    send: (buddyId, text) => ipcRenderer.invoke('claude:send', { buddyId, text }),
    stop: (buddyId) => ipcRenderer.invoke('claude:stop', { buddyId }),
    list: () => ipcRenderer.invoke('claude:list'),
    onEvent: (cb) => {
      const handler = (_e, payload) => {
        if (payload && typeof payload.buddyId === 'string') cb(payload.buddyId, payload.event);
      };
      ipcRenderer.on('claude:event', handler);
      return () => ipcRenderer.off('claude:event', handler);
    },
  },
  codex: {
    start: (buddyId, opts) => ipcRenderer.invoke('codex:start', { buddyId, opts }),
    send: (buddyId, text) => ipcRenderer.invoke('codex:send', { buddyId, text }),
    stop: (buddyId) => ipcRenderer.invoke('codex:stop', { buddyId }),
    list: () => ipcRenderer.invoke('codex:list'),
    onEvent: (cb) => {
      const handler = (_e, payload) => {
        if (payload && typeof payload.buddyId === 'string') cb(payload.buddyId, payload.event);
      };
      ipcRenderer.on('codex:event', handler);
      return () => ipcRenderer.off('codex:event', handler);
    },
  },
});
