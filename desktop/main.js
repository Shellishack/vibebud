const { app, BrowserWindow, Notification, screen, Tray, Menu, nativeImage, protocol, net, ipcMain, shell } = require('electron');
const path = require('path');
const url = require('url');
const { createClaudeHost } = require('./claude-sessions');
const { createCodexHost } = require('./codex-sessions');
const { createGenericAgentHost, agentDescriptors } = require('./generic-agent-sessions');
const { startBridgeServer } = require('./claude-bridge-server');
const { getOrCreateToken, showPairingWindow, refreshPairingWindow, DEFAULT_PORT } = require('./pairing');

// Local Claude Code host for the renderer. Per-buddy long-running `claude`
// subprocesses with stream-json I/O; events flow back to the renderer via the
// `claude:event` IPC channel. Session lifecycle is shared with the optional
// remote WS bridge below — both sides use createClaudeHost.
const localClaude = createClaudeHost({
  emit: (buddyId, event) => {
    win?.webContents.send('claude:event', { buddyId, event });
  },
});
const localCodex = createCodexHost({
  emit: (buddyId, event) => {
    win?.webContents.send('codex:event', { buddyId, event });
  },
});
const localCodeAgents = createGenericAgentHost({
  emit: (buddyId, event) => {
    const agentId = typeof event?.agent === 'string' ? event.agent : undefined;
    win?.webContents.send('code-agent:event', { agentId, buddyId, event });
  },
});

const DEV_URL = process.env.VIBEBUD_DEV_URL;
const OUT_DIR = path.join(__dirname, 'core-out');

let win = null;
let tray = null;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  // Cover the full work area. Click-through is enabled by default via
  // setIgnoreMouseEvents(true, {forward: true}) below; the renderer toggles
  // it off via the `set-interactive` IPC when the cursor enters an
  // interactive element (avatars, chat bubbles, toasts).
  win = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    // Non-focusable so clicks on the avatar don't steal keyboard focus from
    // text-input apps (notepad, VS Code, etc.). Renderer flips this to true
    // while a chat bubble is open so its input can accept typing.
    focusable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });

  if (DEV_URL) {
    win.loadURL(`${DEV_URL.replace(/\/$/, '')}/buddy`);
    win.webContents.once('did-finish-load', () => {
      win?.webContents.openDevTools({ mode: 'detach' });
    });
  } else {
    win.loadURL('app://local/buddy/');
  }
}

function createTray() {
  const trayIcon = nativeImage.createFromPath(path.join(__dirname, 'build', 'tray.png'));
  tray = new Tray(trayIcon.isEmpty() ? nativeImage.createEmpty() : trayIcon);
  tray.setToolTip('vibebud');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show / hide', click: () => (win?.isVisible() ? win.hide() : win?.show()) },
    { label: 'Reload', click: () => win?.reload() },
    { label: 'Toggle DevTools', click: () => win?.webContents.toggleDevTools({ mode: 'detach' }) },
    { type: 'separator' },
    { label: 'Add buddy', click: () => win?.webContents.send('spawn-buddy') },
    { label: 'Pair phone…', click: () => { void showPairingWindow({ port: Number(process.env.VIBEBUD_BRIDGE_PORT || DEFAULT_PORT) }); } },
    { label: 'Settings…', click: () => win?.webContents.send('vibebud:open-settings') },
    {
      label: 'Clear local settings',
      click: async () => {
        if (!win) return;
        await win.webContents.session.clearStorageData();
        win.reload();
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

app.whenReady().then(() => {
  protocol.handle('app', async (request) => {
    const reqUrl = new URL(request.url);
    let pathname = decodeURIComponent(reqUrl.pathname);
    if (!pathname || pathname === '/') pathname = '/index.html';
    if (pathname.endsWith('/')) pathname += 'index.html';
    const filePath = path.join(OUT_DIR, pathname);
    return net.fetch(url.pathToFileURL(filePath).toString());
  });

  ipcMain.on('set-interactive', (_event, interactive) => {
    if (!win) return;
    if (interactive) {
      win.setIgnoreMouseEvents(false);
    } else {
      win.setIgnoreMouseEvents(true, { forward: true });
      // Always hand focus back to the previously focused OS window when the
      // cursor leaves all interactive elements, even if a chat panel is open
      // — otherwise focus gets stuck on vibebud after any click. The user
      // can re-focus the chat input by moving the cursor back and clicking.
      win.blur();
    }
  });

  ipcMain.on('set-bounds', (_event, payload) => {
    if (!win) return;
    const { workArea } = screen.getPrimaryDisplay();
    const width = Math.max(1, Math.ceil(payload?.width ?? 1));
    const height = Math.max(1, Math.ceil(payload?.height ?? 1));
    const x = workArea.x + workArea.width - width;
    const y = workArea.y + workArea.height - height;
    win.setBounds({ x, y, width, height });
  });

  ipcMain.handle('get-cursor-point', () => screen.getCursorScreenPoint());

  function notifyDesktop(title, body, { silent = false } = {}) {
    if (!Notification.isSupported()) return;
    try {
      const iconPath = path.join(__dirname, 'build', 'tray.png');
      const icon = nativeImage.createFromPath(iconPath);
      const n = new Notification({
        title: String(title || 'vibebud'),
        body: String(body || ''),
        icon: icon.isEmpty() ? undefined : icon,
        silent,
      });
      n.show();
    } catch { /* noop */ }
  }

  ipcMain.on('vibebud:notify', (_event, payload) => {
    if (!payload || typeof payload !== 'object') return;
    notifyDesktop(payload.title, payload.body);
  });

  ipcMain.on('vibebud:refresh-pair-token', () => { void refreshPairingWindow(); });

  ipcMain.on('vibebud:show-pairing', () => {
    void showPairingWindow({ port: Number(process.env.VIBEBUD_BRIDGE_PORT || DEFAULT_PORT) });
  });

  ipcMain.on('vibebud:open-external', (_event, rawUrl) => {
    if (typeof rawUrl !== 'string') return;
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return;
      void shell.openExternal(parsed.toString());
    } catch { /* noop */ }
  });

  ipcMain.on('set-focusable', (_event, focusable) => {
    if (!win) return;
    win.setFocusable(Boolean(focusable));
    if (focusable) win.focus();
  });

  ipcMain.handle('claude:start', (_event, payload) => {
    if (!payload || typeof payload.buddyId !== 'string') return { ok: false, error: 'bad-payload' };
    return localClaude.start(payload.buddyId, payload.opts || {});
  });
  ipcMain.handle('claude:send', (_event, payload) => {
    if (!payload || typeof payload.buddyId !== 'string') return { ok: false, error: 'bad-payload' };
    return localClaude.send(payload.buddyId, payload.text || '');
  });
  ipcMain.handle('claude:stop', (_event, payload) => {
    if (!payload || typeof payload.buddyId !== 'string') return { ok: false, error: 'bad-payload' };
    return localClaude.stop(payload.buddyId);
  });
  ipcMain.handle('claude:list', () => localClaude.list());

  ipcMain.handle('codex:start', (_event, payload) => {
    if (!payload || typeof payload.buddyId !== 'string') return { ok: false, error: 'bad-payload' };
    return localCodex.start(payload.buddyId, payload.opts || {});
  });
  ipcMain.handle('codex:send', (_event, payload) => {
    if (!payload || typeof payload.buddyId !== 'string') return { ok: false, error: 'bad-payload' };
    return localCodex.send(payload.buddyId, payload.text || '');
  });
  ipcMain.handle('codex:stop', (_event, payload) => {
    if (!payload || typeof payload.buddyId !== 'string') return { ok: false, error: 'bad-payload' };
    return localCodex.stop(payload.buddyId);
  });
  ipcMain.handle('codex:list', () => localCodex.list());

  ipcMain.handle('code-agents:list', () => agentDescriptors());
  ipcMain.handle('code-agent:start', (_event, payload) => {
    if (!payload || typeof payload.buddyId !== 'string' || typeof payload.agentId !== 'string') return { ok: false, error: 'bad-payload' };
    return localCodeAgents.start(payload.buddyId, { ...(payload.opts || {}), agent: payload.agentId });
  });
  ipcMain.handle('code-agent:send', (_event, payload) => {
    if (!payload || typeof payload.buddyId !== 'string' || typeof payload.agentId !== 'string') return { ok: false, error: 'bad-payload' };
    return localCodeAgents.send(payload.buddyId, payload.text || '');
  });
  ipcMain.handle('code-agent:stop', (_event, payload) => {
    if (!payload || typeof payload.buddyId !== 'string' || typeof payload.agentId !== 'string') return { ok: false, error: 'bad-payload' };
    return localCodeAgents.stop(payload.buddyId);
  });

  // WS bridge: lets paired vibebud clients (Android, web) drive a `claude`
  // subprocess running on this PC. Token is auto-generated and persisted in
  // userData; phone pairs by scanning the QR from the tray menu (deep link
  // encoding url + token). VIBEBUD_BRIDGE_TOKEN env var overrides the
  // persisted token; setting VIBEBUD_BRIDGE_DISABLED=1 skips the bridge
  // entirely.
  if (!process.env.VIBEBUD_BRIDGE_DISABLED) {
    const port = Number(process.env.VIBEBUD_BRIDGE_PORT || DEFAULT_PORT);
    const host = process.env.VIBEBUD_BRIDGE_HOST || '0.0.0.0';
    const token = process.env.VIBEBUD_BRIDGE_TOKEN || getOrCreateToken();
    startBridgeServer({
      host, port, token,
      // Surface bridge-level lifecycle events as desktop notifications so the
      // user sees when their phone connects and when sessions get spun up.
      onEvent: (kind, info) => {
        if (kind === 'paired') {
          notifyDesktop('Phone connected', `vibebud bridge accepted a client from ${info.peer}`);
        } else if (kind === 'session-start') {
          const buddy = info.buddyId ? ` for ${String(info.buddyId).slice(0, 8)}` : '';
          const agent = info.agent === 'codex' ? 'Codex' : 'Claude Code';
          notifyDesktop(`${agent} session started`, `Bridge launched ${agent}${buddy}.`);
        }
      },
    });
  }

  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  localClaude.stopAll();
  localCodex.stopAll();
  localCodeAgents.stopAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { localClaude.stopAll(); localCodex.stopAll(); localCodeAgents.stopAll(); });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
