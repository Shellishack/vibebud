const { app, BrowserWindow, Notification, screen, Tray, Menu, nativeImage, protocol, net, ipcMain } = require('electron');
const path = require('path');
const url = require('url');
const { spawn } = require('child_process');
const os = require('os');

// --- Claude Code session host -------------------------------------------------
// Each buddy can hold one long-running `claude` subprocess. We spawn with
// stream-json I/O so the renderer can pipe user turns in and receive assistant
// chunks/tool calls as JSONL events. Modeled after the slopus/happy-cli wrap
// (which also relies on the `claude` CLI being on PATH) and OpenCode's
// stream-json ACP transport. Sessions are keyed by buddy id and torn down on
// claude:stop or window close.
const claudeSessions = new Map(); // buddyId -> { proc, stdoutBuf, stderrBuf, cwd }

function claudeBinary() {
  // On Windows we rely on shell:true + PATHEXT to resolve .exe/.cmd/.bat.
  // Hardcoding .cmd misses the native winget install (claude.exe).
  return process.env.VIBEMOJI_CLAUDE_BIN || 'claude';
}

function claudeStart(buddyId, opts = {}) {
  if (claudeSessions.has(buddyId)) return { ok: true, alreadyRunning: true };
  const cwd = opts.cwd || process.env.VIBEMOJI_CLAUDE_CWD || os.homedir();
  const args = [
    '--print',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--permission-mode', 'bypassPermissions',
  ];
  if (opts.model) args.push('--model', String(opts.model));
  if (Array.isArray(opts.allowedTools)) args.push('--allowedTools', opts.allowedTools.join(','));
  let proc;
  try {
    proc = spawn(claudeBinary(), args, {
      cwd,
      shell: os.platform() === 'win32',
      env: { ...process.env },
    });
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
  const session = { proc, stdoutBuf: '', stderrBuf: '', cwd };
  claudeSessions.set(buddyId, session);
  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    session.stdoutBuf += chunk;
    let nl;
    while ((nl = session.stdoutBuf.indexOf('\n')) >= 0) {
      const line = session.stdoutBuf.slice(0, nl).trim();
      session.stdoutBuf = session.stdoutBuf.slice(nl + 1);
      if (!line) continue;
      let evt;
      try { evt = JSON.parse(line); } catch { evt = { type: 'raw', text: line }; }
      win?.webContents.send('claude:event', { buddyId, event: evt });
    }
  });
  proc.stderr.on('data', (chunk) => {
    session.stderrBuf += chunk;
    win?.webContents.send('claude:event', { buddyId, event: { type: 'stderr', text: String(chunk) } });
  });
  proc.on('error', (err) => {
    win?.webContents.send('claude:event', { buddyId, event: { type: 'error', text: String(err && err.message || err) } });
    claudeSessions.delete(buddyId);
  });
  proc.on('close', (code) => {
    const stderr = (session.stderrBuf || '').trim();
    win?.webContents.send('claude:event', { buddyId, event: { type: 'closed', code, stderr, bin: claudeBinary(), cwd } });
    claudeSessions.delete(buddyId);
  });
  return { ok: true, cwd };
}

function claudeSend(buddyId, text) {
  const session = claudeSessions.get(buddyId);
  if (!session) return { ok: false, error: 'no-session' };
  const msg = {
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: String(text) }] },
  };
  try {
    session.proc.stdin.write(JSON.stringify(msg) + '\n');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

function claudeStop(buddyId) {
  const session = claudeSessions.get(buddyId);
  if (!session) return { ok: true };
  try { session.proc.stdin.end(); } catch { /* noop */ }
  try { session.proc.kill(); } catch { /* noop */ }
  claudeSessions.delete(buddyId);
  return { ok: true };
}

function claudeStopAll() {
  for (const id of Array.from(claudeSessions.keys())) claudeStop(id);
}

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

  ipcMain.on('vibemoji:notify', (_event, payload) => {
    if (!payload || typeof payload !== 'object') return;
    const title = String(payload.title || 'vibemoji');
    const body = String(payload.body || '');
    if (!Notification.isSupported()) return;
    try {
      const iconPath = path.join(__dirname, 'build', 'tray.png');
      const icon = nativeImage.createFromPath(iconPath);
      const n = new Notification({ title, body, icon: icon.isEmpty() ? undefined : icon, silent: false });
      n.show();
    } catch { /* noop */ }
  });

  ipcMain.on('set-focusable', (_event, focusable) => {
    if (!win) return;
    win.setFocusable(Boolean(focusable));
    if (focusable) win.focus();
  });

  ipcMain.handle('claude:start', (_event, payload) => {
    if (!payload || typeof payload.buddyId !== 'string') return { ok: false, error: 'bad-payload' };
    return claudeStart(payload.buddyId, payload.opts || {});
  });
  ipcMain.handle('claude:send', (_event, payload) => {
    if (!payload || typeof payload.buddyId !== 'string') return { ok: false, error: 'bad-payload' };
    return claudeSend(payload.buddyId, payload.text || '');
  });
  ipcMain.handle('claude:stop', (_event, payload) => {
    if (!payload || typeof payload.buddyId !== 'string') return { ok: false, error: 'bad-payload' };
    return claudeStop(payload.buddyId);
  });
  ipcMain.handle('claude:list', () => Array.from(claudeSessions.keys()));

  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  claudeStopAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { claudeStopAll(); });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
