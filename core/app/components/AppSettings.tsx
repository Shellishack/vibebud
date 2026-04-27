'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { usePlatform } from './hooks/usePlatform';
import { getNotifyMethod, setNotifyMethod, type NotifyMethod } from './llm';

type Props = { open: boolean; onClose: () => void };

export default function AppSettings({ open, onClose }: Props) {
  if (!open || typeof document === 'undefined') return null;
  return <AppSettingsBody onClose={onClose} />;
}

function AppSettingsBody({ onClose }: { onClose: () => void }) {
  const adapter = usePlatform();
  const [method, setMethod] = useState<NotifyMethod>(() => getNotifyMethod());
  const [permDenied, setPermDenied] = useState(false);

  const choose = async (next: NotifyMethod) => {
    if (next === 'native') {
      const ok = await adapter.requestNotificationPermission();
      if (!ok) {
        setPermDenied(true);
        return;
      }
    }
    setPermDenied(false);
    setMethod(next);
    setNotifyMethod(next);
  };

  return createPortal(
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
              onClick={() => void choose('in-app')}
            />
            <Option
              selected={method === 'native'}
              label="Native system notification"
              desc={
                adapter.id === 'electron' ? 'Windows Action Center / macOS Notification Center.'
                : adapter.id === 'capacitor-android' ? 'Android system notification tray.'
                : 'Browser notification banner.'
              }
              onClick={() => void choose('native')}
            />
          </div>
          {permDenied && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              Notification permission isn&apos;t granted. Enable it in your{' '}
              {adapter.id === 'capacitor-android' ? 'Android app settings' : 'browser/OS settings'} and try again.
            </p>
          )}
        </section>
      </div>
    </div>,
    document.body,
  );
}

function Option({ selected, label, desc, onClick }: { selected: boolean; label: string; desc: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-start gap-0.5 rounded-2xl border px-3 py-2.5 text-left transition-colors ${
        selected
          ? 'border-violet-500 bg-violet-50 dark:border-violet-400 dark:bg-violet-500/10'
          : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800'
      }`}
    >
      <span className="flex w-full items-center justify-between">
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{label}</span>
        {selected && (
          <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
            on
          </span>
        )}
      </span>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{desc}</span>
    </button>
  );
}
