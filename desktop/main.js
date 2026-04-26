const { app, BrowserWindow, screen, Tray, Menu, nativeImage, protocol, net, ipcMain } = require('electron');
const path = require('path');
const url = require('url');

const DEV_URL = process.env.VIBEMOJI_DEV_URL;
const OUT_DIR = path.join(__dirname, 'core-out');

let win = null;
let tray = null;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();

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
  // Click-through by default — clicks pass to apps behind. The renderer toggles
  // this off via IPC when the cursor is over an interactive element (avatar,
  // chat bubble, toast). `forward: true` keeps mouse-move events flowing so the
  // renderer can still detect hover even while ignoring clicks.
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
    }
  });

  ipcMain.on('set-focusable', (_event, focusable) => {
    if (!win) return;
    win.setFocusable(Boolean(focusable));
    if (focusable) win.focus();
  });

  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
