const { app, BrowserWindow, Notification, screen, Tray, Menu, nativeImage, protocol, net, ipcMain } = require('electron');
const path = require('path');
const url = require('url');
const { createClaudeHost } = require('./claudeSessions');
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

const DEV_URL = process.env.VIBEMOJI_DEV_URL;
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
  } else {
    win.loadURL('app://local/buddy/');
  }
}

function createTray() {
  const trayIcon = nativeImage.createFromPath(path.join(__dirname, 'build', 'tray.png'));
  tray = new Tray(trayIcon.isEmpty() ? nativeImage.createEmpty() : trayIcon);
  tray.setToolTip('vibemoji');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show / hide', click: () => (win?.isVisible() ? win.hide() : win?.show()) },
    { label: 'Reload', click: () => win?.reload() },
    { label: 'Toggle DevTools', click: () => win?.webContents.toggleDevTools({ mode: 'detach' }) },
    { type: 'separator' },
    { label: 'Add buddy', click: () => win?.webContents.send('spawn-buddy') },
    { label: 'Pair phone…', click: () => { void showPairingWindow({ port: Number(process.env.VIBEMOJI_BRIDGE_PORT || DEFAULT_PORT) }); } },
    { label: 'Settings…', click: () => win?.webContents.send('vibemoji:open-settings') },
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
      // — otherwise focus gets stuck on vibemoji after any click. The user
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
        title: String(title || 'vibemoji'),
        body: String(body || ''),
        icon: icon.isEmpty() ? undefined : icon,
        silent,
      });
      n.show();
    } catch { /* noop */ }
  }

  ipcMain.on('vibemoji:notify', (_event, payload) => {
    if (!payload || typeof payload !== 'object') return;
    notifyDesktop(payload.title, payload.body);
  });

  ipcMain.on('vibemoji:refresh-pair-token', () => { void refreshPairingWindow(); });

  ipcMain.on('vibemoji:show-pairing', () => {
    void showPairingWindow({ port: Number(process.env.VIBEMOJI_BRIDGE_PORT || DEFAULT_PORT) });
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

  // WS bridge: lets paired vibemoji clients (Android, web) drive a `claude`
  // subprocess running on this PC. Token is auto-generated and persisted in
  // userData; phone pairs by scanning the QR from the tray menu (deep link
  // encoding url + token). VIBEMOJI_BRIDGE_TOKEN env var overrides the
  // persisted token; setting VIBEMOJI_BRIDGE_DISABLED=1 skips the bridge
  // entirely.
  if (!process.env.VIBEMOJI_BRIDGE_DISABLED) {
    const port = Number(process.env.VIBEMOJI_BRIDGE_PORT || DEFAULT_PORT);
    const host = process.env.VIBEMOJI_BRIDGE_HOST || '0.0.0.0';
    const token = process.env.VIBEMOJI_BRIDGE_TOKEN || getOrCreateToken();
    startBridgeServer({
      host, port, token,
      // Surface bridge-level lifecycle events as desktop notifications so the
      // user sees when their phone connects and when sessions get spun up.
      onEvent: (kind, info) => {
        if (kind === 'paired') {
          notifyDesktop('Phone connected', `vibemoji bridge accepted a client from ${info.peer}`);
        } else if (kind === 'session-start') {
          const buddy = info.buddyId ? ` for ${String(info.buddyId).slice(0, 8)}` : '';
          notifyDesktop('Claude session started', `Bridge launched a Claude Code subprocess${buddy}.`);
        }
      },
    });
  }

  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  localClaude.stopAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { localClaude.stopAll(); });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
