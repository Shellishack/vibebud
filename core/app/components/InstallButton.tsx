'use client';

// NOTE: this component still UA-sniffs to choose between Mac/Linux/Windows
// installers — the platform adapter intentionally doesn't carry desktop-OS
// granularity (it only distinguishes web/electron/capacitor). UA detection
// is appropriate here.

import { useEffect, useState } from 'react';
import { useTranslations } from '../../lib/hooks/use-translations';
import { usePlatform } from './hooks/usePlatform';

type Target = { id: string; label: string; href: string; ext: string; directDownload?: boolean };

const LATEST_RELEASE_URL = 'https://github.com/Shellishack/vibemoji/releases/latest';
const LATEST_RELEASE_DOWNLOAD_URL = `${LATEST_RELEASE_URL}/download`;

const TARGETS: Target[] = [
  {
    id: 'win',
    label: 'Windows',
    href: `${LATEST_RELEASE_DOWNLOAD_URL}/vibebud-desktop-setup.exe`,
    ext: 'exe',
    directDownload: true,
  },
  { id: 'mac', label: 'macOS', href: LATEST_RELEASE_URL, ext: 'dmg' },
  { id: 'linux', label: 'Linux', href: LATEST_RELEASE_URL, ext: 'AppImage' },
  { id: 'android', label: 'Android', href: LATEST_RELEASE_URL, ext: 'apk' },
];

function detectTarget(): Target {
  if (typeof navigator === 'undefined') return TARGETS[0];
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('android')) return TARGETS[3];
  if (ua.includes('mac')) return TARGETS[1];
  if (ua.includes('linux')) return TARGETS[2];
  return TARGETS[0];
}

export default function InstallButton() {
  const { t } = useTranslations();
  const adapter = usePlatform();
  const insideElectron = adapter.id === 'electron';
  const [target, setTarget] = useState<Target>(TARGETS[0]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setTarget(detectTarget());
  }, []);

  const handleDownload = () => {
    setOpen(false);
  };

  if (insideElectron) {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        {t('install.runningDesktop')}
      </div>
    );
  }

  return (
    <div className="relative inline-block">
      <div className="inline-flex overflow-hidden rounded-full shadow-lg shadow-violet-500/20">
        <a
          href={target.href}
          download={target.directDownload ? '' : undefined}
          onClick={handleDownload}
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-95"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
          {t('install.installFor', { platform: target.label })}
        </a>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={t('install.choosePlatform')}
          className="border-l border-white/20 bg-gradient-to-r from-fuchsia-500 to-fuchsia-600 px-3 text-white transition-opacity hover:opacity-95"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-zinc-200 bg-white/95 shadow-xl backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
          {TARGETS.map((t) => (
            <a
              key={t.id}
              href={t.href}
              download={t.directDownload ? '' : undefined}
              onClick={handleDownload}
              rel="noopener noreferrer"
              className={`flex items-center justify-between px-4 py-2.5 text-sm transition-colors hover:bg-violet-50 dark:hover:bg-violet-500/10 ${
                t.id === target.id
                  ? 'text-violet-700 dark:text-violet-300'
                  : 'text-zinc-700 dark:text-zinc-200'
              }`}
            >
              <span className="font-medium">{t.label}</span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">.{t.ext}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
