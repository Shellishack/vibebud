'use client';

// Scanner-only route. Loaded by MainActivity (the Capacitor BridgeActivity)
// either via the overlay-bounce (?return=close) or via direct in-app
// navigation from the AppSettings button on /  (?return=back).
//
// Includes a verbose on-page log so failures are debuggable without adb.
// The previous "silent failure" mode (plugin rejects → status flashes →
// user navigates away before reading) was the worst possible UX.

import { useEffect, useRef, useState } from 'react';
import { setRemoteClaudeConfig } from '../../lib/platform/remoteClaude';

// Hard-coded marker bumped on each iteration. If you don't see this string
// at the top of /scan/, the device is loading a stale bundle and you need
// to re-run `npm run web-build && cd mobile && npx cap sync android` and
// reinstall the APK.
const BUILD_MARKER = 'scan-v3-2026-04-28';

type HostBridge = { closeScanActivity?: () => void };
const host = (): HostBridge | undefined =>
  (typeof window !== 'undefined'
    ? (window as unknown as { vibebudHost?: HostBridge }).vibebudHost
    : undefined);

function finishScan() {
  if (typeof window === 'undefined') return;
  const mode = new URLSearchParams(window.location.search).get('return');
  if (mode === 'close') { host()?.closeScanActivity?.(); return; }
  if (window.history.length > 1) window.history.back();
  else window.location.href = '/';
}

function applyPairing(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return 'Empty result.';
  let parsed: URL;
  try { parsed = new URL(trimmed); }
  catch { return 'Not a valid URL.'; }
  if (parsed.protocol !== 'vibebud:' || parsed.host !== 'pair') {
    return 'Not a vibebud://pair link.';
  }
  const url = parsed.searchParams.get('url');
  const token = parsed.searchParams.get('token');
  if (!url || !token) return 'Link is missing url or token.';
  setRemoteClaudeConfig({ url, token });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('vibebud:paired'));
  }
  return null;
}

export default function ScanPage() {
  const [logs, setLogs] = useState<string[]>([]);
  const [paired, setPaired] = useState(false);
  const [pasteValue, setPasteValue] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const log = (s: string) => {
    // Mirror to console for adb logcat -s chromium and to the visible page log.
    console.log('[scan]', s);
    setLogs((cur) => [...cur, `${new Date().toLocaleTimeString()}  ${s}`]);
  };

  const runScan = async () => {
    if (paired) return;
    log('runScan start');
    try {
      log('importing @capacitor/core …');
      const cap = await import('@capacitor/core');
      const platform = cap.Capacitor.getPlatform();
      const isNative = cap.Capacitor.isNativePlatform();
      const isPluginAvailable = cap.Capacitor.isPluginAvailable('CapacitorBarcodeScanner');
      log(`platform=${platform} native=${isNative} pluginAvailable=${isPluginAvailable}`);
      if (!isPluginAvailable) {
        log('PLUGIN NOT REGISTERED — APK must be rebuilt with @capacitor/barcode-scanner');
        return;
      }

      log('importing @capacitor/barcode-scanner …');
      const mod = await import('@capacitor/barcode-scanner');
      const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } = mod;
      log('calling scanBarcode({ hint: QR_CODE }) …');

      const result = await CapacitorBarcodeScanner.scanBarcode({
        hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
        scanInstructions: 'Point at the QR shown by the desktop app',
      });
      log(`scanBarcode resolved: ${JSON.stringify(result)}`);

      const text = result?.ScanResult;
      if (!text) { log('no ScanResult string in result'); return; }
      const err = applyPairing(text);
      if (err) { log(`applyPairing rejected: ${err}  raw=${text}`); return; }
      log('paired ✓');
      setPaired(true);
      setTimeout(() => finishScan(), 1000);
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      log(`scanBarcode threw: ${msg}`);
    }
  };

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void runScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePaste = () => {
    const err = applyPairing(pasteValue);
    if (err) { setPasteError(err); return; }
    setPasteError(null);
    setPaired(true);
    setTimeout(() => finishScan(), 400);
  };

  return (
    <div className="flex min-h-dvh flex-col gap-4 bg-zinc-50 p-4 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <h1 className="text-lg font-semibold">Pair with desktop</h1>
      <p className="-mt-3 font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
        build {BUILD_MARKER}
      </p>

      {paired ? (
        <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          Paired ✓ — returning to app…
        </div>
      ) : (
        <button
          onClick={() => { setLogs([]); startedRef.current = false; void runScan(); }}
          className="rounded-2xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-700"
        >
          Open scanner
        </button>
      )}

      {/* Diagnostic log — visible so failures don't disappear */}
      <div className="rounded-2xl bg-zinc-100 p-3 dark:bg-zinc-900">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Diagnostic log
        </p>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[10px] leading-snug text-zinc-700 dark:text-zinc-200">
{logs.length ? logs.join('\n') : '(waiting for first event…)'}
        </pre>
      </div>

      <div className="rounded-2xl border border-zinc-200 p-3 dark:border-zinc-700">
        <p className="mb-2 text-xs text-zinc-600 dark:text-zinc-300">
          Manual fallback: paste the <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">vibebud://pair?…</code> link from desktop.
        </p>
        <input
          type="text"
          value={pasteValue}
          onChange={(e) => setPasteValue(e.target.value)}
          placeholder="vibebud://pair?url=…&token=…"
          className="mb-2 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 font-mono text-[11px] outline-none focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <div className="flex gap-2">
          <button
            onClick={handlePaste}
            className="flex-1 rounded-full bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
          >
            Pair from link
          </button>
          <button
            onClick={() => finishScan()}
            className="rounded-full px-3 py-1.5 text-sm text-zinc-700 ring-1 ring-zinc-300 hover:bg-zinc-100 dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-800"
          >
            Back
          </button>
        </div>
        {pasteError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{pasteError}</p>}
      </div>
    </div>
  );
}
