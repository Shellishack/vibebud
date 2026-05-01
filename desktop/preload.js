const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vibebud', {
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
  showNotification: (payload) => ipcRenderer.send('vibebud:notify', payload),
  showPairing: () => ipcRenderer.send('vibebud:show-pairing'),
  onOpenSettings: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('vibebud:open-settings', handler);
    return () => ipcRenderer.off('vibebud:open-settings', handler);
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
  codeAgents: {
    list: () => ipcRenderer.invoke('code-agents:list'),
    start: (agentId, buddyId, opts) => ipcRenderer.invoke('code-agent:start', { agentId, buddyId, opts }),
    send: (agentId, buddyId, text) => ipcRenderer.invoke('code-agent:send', { agentId, buddyId, text }),
    stop: (agentId, buddyId) => ipcRenderer.invoke('code-agent:stop', { agentId, buddyId }),
    onEvent: (cb) => {
      const handler = (_e, payload) => {
        if (payload && typeof payload.buddyId === 'string' && typeof payload.agentId === 'string') {
          cb(payload.agentId, payload.buddyId, payload.event);
        }
      };
      ipcRenderer.on('code-agent:event', handler);
      return () => ipcRenderer.off('code-agent:event', handler);
    },
  },
});
