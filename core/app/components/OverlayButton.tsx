'use client';

import { useEffect, useState } from 'react';
import { usePlatform } from './hooks/usePlatform';

type OverlayPlugin = {
  hasPermission: () => Promise<{ granted: boolean }>;
  requestPermission: () => Promise<{ granted: boolean; opened?: boolean }>;
  start: (opts?: { url?: string }) => Promise<{ ok: boolean }>;
  stop: () => Promise<{ ok: boolean }>;
  isRunning: () => Promise<{ running: boolean }>;
};

const getOverlay = (): OverlayPlugin | null => {
  if (typeof window === 'undefined') return null;
  const cap = (window as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  return (cap?.Plugins?.Overlay as OverlayPlugin | undefined) ?? null;
};

export default function OverlayButton() {
  const adapter = usePlatform();
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const overlay = getOverlay();
    overlay?.isRunning().then((r) => setRunning(!!r.running)).catch(() => {});
  }, []);

  if (adapter.id !== 'capacitor-android') return null;

  const onClick = async () => {
    const overlay = getOverlay();
    if (!overlay) return;
    setBusy(true);
    try {
      if (running) {
        await overlay.stop();
        setRunning(false);
        return;
      }
      const perm = await overlay.hasPermission();
      if (!perm.granted) {
        const req = await overlay.requestPermission();
        if (!req.granted) {
          // Settings opened — bail; user returns and taps again.
          return;
        }
      }
      await overlay.start();
      setRunning(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-500/30 transition-colors hover:bg-violet-700 disabled:opacity-60"
    >
      {running ? 'stop floating' : 'float on top of my apps'}
    </button>
  );
}
