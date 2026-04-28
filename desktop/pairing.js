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

function getOrCreateToken() {
  const p = tokenPath();
  try {
    const existing = fs.readFileSync(p, 'utf8').trim();
    if (existing) return existing;
  } catch { /* not yet written */ }
  const token = crypto.randomBytes(24).toString('base64url');
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); } catch { /* noop */ }
  fs.writeFileSync(p, token, { encoding: 'utf8', mode: 0o600 });
  return token;
}

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

async function showPairingWindow({ port = DEFAULT_PORT } = {}) {
  let QRCode;
  try { QRCode = require('qrcode'); }
  catch (err) {
    console.warn('[vibemoji-pairing] `qrcode` package not installed — cannot render QR.', err?.message);
    return;
  }

  if (pairingWindow && !pairingWindow.isDestroyed()) {
    pairingWindow.focus();
    return;
  }

  const payload = getPairingPayload({ port });
  const uri = buildPairingUri(payload);
  const svg = await QRCode.toString(uri, { type: 'svg', margin: 1, width: 320 });

  const html = `<!doctype html>
<meta charset="utf-8">
<title>Pair phone with vibemoji</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 24px; font: 14px system-ui, sans-serif;
    background: #fafafa; color: #111;
    display: flex; flex-direction: column; align-items: center; gap: 16px;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #1a1a1a; color: #eee; }
    .code { background: #2a2a2a; }
  }
  h1 { font-size: 16px; font-weight: 600; margin: 0; }
  .qr { background: #fff; padding: 16px; border-radius: 12px; }
  .hint { opacity: 0.7; max-width: 320px; text-align: center; line-height: 1.5; }
  .code {
    font: 11px ui-monospace, monospace; background: #efefef;
    padding: 8px 10px; border-radius: 6px; max-width: 320px;
    word-break: break-all; user-select: all;
  }
</style>
<h1>Scan with your phone's camera</h1>
<div class="qr">${svg}</div>
<div class="hint">Open the camera app on your phone and point it at this code. Tap the link to pair.</div>
<div class="code">${uri}</div>`;

  pairingWindow = new BrowserWindow({
    width: 420,
    height: 560,
    title: 'Pair phone with vibemoji',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  pairingWindow.on('closed', () => { pairingWindow = null; });
  pairingWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

module.exports = {
  DEFAULT_PORT,
  getOrCreateToken,
  getLanAddress,
  getPairingPayload,
  buildPairingUri,
  showPairingWindow,
};
