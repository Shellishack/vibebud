// Pairing helpers: a persistent bridge token, the LAN address peers should
// connect to, and a small QR-code window the user can scan with their phone's
// regular camera app. The QR encodes a `vibemoji://pair?...` deep link; the
// Android app registers that scheme and writes the payload to its WebView's
// localStorage on receipt, so no in-app camera/scanner is needed.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_PORT = 3061;

function tokenPath() {
  return path.join(app.getPath('userData'), 'bridge-token');
}

// Short, human-typeable pairing token. 6 decimal digits = ~20 bits — fine for
// trusted-LAN use where the bridge is only reachable from devices on the same
// Wi-Fi. Existing tokens that don't match the 6-digit format (e.g. older
// base64url ones) are auto-rotated on next launch.
const TOKEN_PATTERN = /^\d{6}$/;

function writeToken() {
  const p = tokenPath();
  const token = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); } catch { /* noop */ }
  fs.writeFileSync(p, token, { encoding: 'utf8', mode: 0o600 });
  return token;
}

function getOrCreateToken() {
  const p = tokenPath();
  try {
    const existing = fs.readFileSync(p, 'utf8').trim();
    if (TOKEN_PATTERN.test(existing)) return existing;
  } catch { /* not yet written */ }
  return writeToken();
}

// Force a new pairing code. Existing peers will fail auth (close 4401) on
// their next reconnect — by design; the user is rotating because they want
// to invalidate prior pairings.
function regenerateToken() { return writeToken(); }

function getLanAddress() {
  // Prefer the first non-internal IPv4 — virtual adapters (Hyper-V, WSL,
  // VPN tun interfaces) often come before the real Wi-Fi NIC, so de-prioritize
  // anything that looks virtual.
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const iface of list || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      const score = /vEthernet|VirtualBox|VMware|WSL|Loopback/i.test(name) ? 1 : 0;
      candidates.push({ score, name, address: iface.address });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.address || '127.0.0.1';
}

function getPairingPayload({ port = DEFAULT_PORT } = {}) {
  return {
    url: `ws://${getLanAddress()}:${port}`,
    token: getOrCreateToken(),
  };
}

function buildPairingUri(payload) {
  const u = new URL('vibemoji://pair');
  u.searchParams.set('url', payload.url);
  u.searchParams.set('token', payload.token);
  return u.toString();
}

let pairingWindow = null;
let pairingPort = DEFAULT_PORT;

async function renderPairingHtml(port) {
  const QRCode = require('qrcode');
  const payload = getPairingPayload({ port });
  const uri = buildPairingUri(payload);
  const svg = await QRCode.toString(uri, { type: 'svg', margin: 1, width: 240 });
  return { payload, uri, svg };
}

async function loadPairingContent(win, port) {
  const { payload, uri, svg } = await renderPairingHtml(port);
  const html = buildPairingHtml({ payload, uri, svg });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

function buildPairingHtml({ payload, uri, svg }) {
  return `<!doctype html>
<meta charset="utf-8">
<title>Pair phone with vibemoji</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 24px; font: 14px system-ui, sans-serif;
    background: #fafafa; color: #111;
    display: flex; flex-direction: column; align-items: center; gap: 16px;
  }
  h1 { font-size: 16px; font-weight: 600; margin: 0; }
  .qr { background: #fff; padding: 16px; border-radius: 12px; }
  .hint { opacity: 0.7; max-width: 320px; text-align: center; line-height: 1.5; }
  .code {
    font: 11px ui-monospace, monospace; background: #efefef;
    padding: 8px 10px; border-radius: 6px; max-width: 320px;
    word-break: break-all; user-select: all;
  }
  .pair-code {
    display: inline-block;
    font: 600 32px/1 ui-monospace, "SF Mono", Menlo, monospace;
    letter-spacing: 0.4em;
    padding: 14px 22px 14px 28px;
    border-radius: 12px;
    background: #efe9ff;
    color: #4c1d95;
    user-select: all;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #1a1a1a; color: #eee; }
    .code { background: #2a2a2a; }
    .pair-code { background: #2a1f55; color: #ddd6fe; }
  }
  .meta { font: 12px ui-monospace, monospace; opacity: 0.7; }
</style>
<h1>Scan with your phone's camera</h1>
<div class="qr">${svg}</div>
<div class="hint">Open the camera app on your phone and point it at this code. Or enter the code manually in <em>App settings → Pair with desktop</em>.</div>
<div class="pair-code" title="6-digit pairing token">${payload.token}</div>
<div class="meta">${payload.url}</div>
<div class="code">${uri}</div>
<button onclick="window.vibemojiPair && window.vibemojiPair.refresh()" style="margin-top:4px;padding:8px 14px;border:0;border-radius:8px;background:#4c1d95;color:#fff;font:600 13px system-ui;cursor:pointer">New code</button>`;
}

async function showPairingWindow({ port = DEFAULT_PORT } = {}) {
  try { require('qrcode'); }
  catch (err) {
    console.warn('[vibemoji-pairing] `qrcode` package not installed — cannot render QR.', err?.message);
    return;
  }
  pairingPort = port;
  if (pairingWindow && !pairingWindow.isDestroyed()) {
    pairingWindow.focus();
    return;
  }
  pairingWindow = new BrowserWindow({
    width: 420,
    height: 700,
    title: 'Pair phone with vibemoji',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'pairing-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  pairingWindow.on('closed', () => { pairingWindow = null; });
  await loadPairingContent(pairingWindow, port);
}

async function refreshPairingWindow() {
  regenerateToken();
  if (pairingWindow && !pairingWindow.isDestroyed()) {
    await loadPairingContent(pairingWindow, pairingPort);
  }
}

module.exports = {
  DEFAULT_PORT,
  getOrCreateToken,
  getLanAddress,
  getPairingPayload,
  buildPairingUri,
  showPairingWindow,
  refreshPairingWindow,
  regenerateToken,
};
