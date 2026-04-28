'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePlatform } from './hooks/usePlatform';
import { getNotifyMethod, setNotifyMethod, type NotifyMethod } from './llm';
import {
  getRemoteClaudeConfig, setRemoteClaudeConfig, type RemoteClaudeConfig,
} from '../../lib/platform/remoteClaude';

type Props = { open: boolean; onClose: () => void };

export default function AppSettings({ open, onClose }: Props) {
  if (!open || typeof document === 'undefined') return null;
  return <AppSettingsBody onClose={onClose} />;
}

function AppSettingsBody({ onClose }: { onClose: () => void }) {
  const adapter = usePlatform();
  const [method, setMethod] = useState<NotifyMethod>(() => getNotifyMethod());
  const [permGranted, setPermGranted] = useState<boolean>(() => adapter.hasNotificationPermission());

  // Pair-with-desktop state. Web/Capacitor only — Electron uses the
  // in-process Claude bridge and doesn't need a remote URL.
  const showPairingUi = adapter.id !== 'electron';
  const [pairConfig, setPairConfig] = useState<RemoteClaudeConfig | null>(() => getRemoteClaudeConfig());
  const [scanError, setScanError] = useState<string | null>(null);
  useEffect(() => {
    // MainActivity.handlePairingIntent fires this after a deep-link pair —
    // either from the system camera tapping the QR or from QrPairScanActivity
    // (Google ML Kit scanner) routing the decoded URI back through the same
    // intent filter.
    const onPaired = () => setPairConfig(getRemoteClaudeConfig());
    window.addEventListener('vibemoji:paired', onPaired);
    return () => window.removeEventListener('vibemoji:paired', onPaired);
  }, []);

  const choose = (next: NotifyMethod) => {
    setMethod(next);
    setNotifyMethod(next);
    if (next === 'native') {
      void adapter.requestNotificationPermission().then((ok) => setPermGranted(ok));
    }
  };

  // Re-poll permission state whenever the user returns to the app (e.g.
  // came back from the system Settings activity). Cheap, runs every 1s
  // while the panel is open, plus on visibility/focus.
  useEffect(() => {
    const recheck = () => setPermGranted(adapter.hasNotificationPermission());
    recheck();
    const t = setInterval(recheck, 1000);
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, [adapter]);

  const showPermHint = method === 'native' && !permGranted;

  return createPortal(
    <>
      <div
        data-buddy-interactive
        className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className="w-full max-w-md rounded-3xl border border-zinc-200 bg-white/95 p-5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900/95"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">App settings</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="grid h-7 w-7 place-items-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>

          {showPairingUi && (
            <section className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Pair with desktop
              </p>
              <p className="mt-1 mb-3 text-xs text-zinc-500 dark:text-zinc-400">
                Routes Claude Code chats to a <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">claude</code> subprocess on your PC.
                On the desktop app, right-click any buddy → <em>Pair phone…</em> to show the QR.
              </p>
              {pairConfig && (
                <p className="mb-3 text-xs text-zinc-700 dark:text-zinc-200">
                  Paired with <span className="font-mono">{pairConfig.url}</span>
                </p>
              )}
              {adapter.scanQrForPair ? (
                <>
                  <button
                    onClick={async () => {
                      setScanError('Opening scanner…');
                      const r = await adapter.scanQrForPair?.();
                      if (r && !r.ok) setScanError(r.reason || 'Unknown failure.');
                      else setScanError(null);
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-700"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="7" height="7" rx="1" />
                      <rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" />
                      <path d="M14 14h3v3h-3zM20 14v3M14 20h3M17 20h3M20 17v3" />
                    </svg>
                    {pairConfig ? 'Re-scan QR to pair' : 'Scan QR to pair'}
                  </button>
                  {scanError && (
                    <div className="mt-2 rounded-lg bg-red-50 p-2 text-[11px] text-red-700 dark:bg-red-500/10 dark:text-red-300">
                      {scanError}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  In-app camera scan isn&apos;t available on this platform. Open <code>vibemoji://pair?…</code> via your browser to pair.
                </p>
              )}
              {pairConfig && (
                <button
                  onClick={() => { setRemoteClaudeConfig(null); setPairConfig(null); }}
                  className="mt-2 w-full rounded-2xl px-4 py-2 text-xs text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-100 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-800"
                >
                  Unpair
                </button>
              )}
            </section>
          )}

          <section>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Notifications
            </p>
            <p className="mt-1 mb-3 text-xs text-zinc-500 dark:text-zinc-400">
              Where pings show up — agent dispatched, PR ready, needs your input, etc.
            </p>
            <div className="flex flex-col gap-2">
              <Option
                selected={method === 'in-app'}
                label="In-app toast (default)"
                desc="Card slides up next to the buddy. Only visible while the buddy window is on screen."
                onClick={() => choose('in-app')}
              />
              <Option
                selected={method === 'native'}
                label="Native system notification"
                desc={
                  adapter.id === 'electron' ? 'Windows Action Center / macOS Notification Center.'
                  : adapter.id === 'capacitor-android' ? 'Android system notification tray.'
                  : 'Browser notification banner.'
                }
                onClick={() => choose('native')}
                status={
                  method === 'native'
                    ? permGranted
                      ? { tone: 'ok', text: 'Allowed' }
                      : { tone: 'warn', text: 'Permission needed' }
                    : null
                }
              />
            </div>
            {showPermHint && (
              <div className="mt-3 flex flex-col gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                <p>
                  {adapter.id === 'capacitor-android'
                    ? 'Android hasn’t granted notification permission yet. Tap below to open the permission prompt or app settings.'
                    : 'Notification permission isn’t granted by your browser/OS.'}
                </p>
                <button
                  onClick={() => void adapter.requestNotificationPermission().then((ok) => setPermGranted(ok))}
                  className="self-start rounded-full bg-amber-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400"
                >
                  Open permission settings
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </>,
    document.body,
  );
}

function Option({ selected, label, desc, onClick, status }: {
  selected: boolean;
  label: string;
  desc: string;
  onClick: () => void;
  status?: { tone: 'ok' | 'warn'; text: string } | null;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-start gap-0.5 rounded-2xl border px-3 py-2.5 text-left transition-colors ${
        selected
          ? 'border-violet-500 bg-violet-50 dark:border-violet-400 dark:bg-violet-500/10'
          : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800'
      }`}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{label}</span>
        <span className="flex items-center gap-1.5">
          {status && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
              status.tone === 'ok'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300'
            }`}>
              {status.text}
            </span>
          )}
          {selected && (
            <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
              on
            </span>
          )}
        </span>
      </span>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{desc}</span>
    </button>
  );
}
