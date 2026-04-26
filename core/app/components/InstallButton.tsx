'use client';

import { useEffect, useState } from 'react';

type Target = { id: string; label: string; file: string; ext: string };

const TARGETS: Target[] = [
  { id: 'win',   label: 'Windows',  file: '/installers/vibemoji-desktop-setup.exe', ext: 'exe' },
  { id: 'mac',   label: 'macOS',    file: '/installers/vibemoji-desktop.dmg',       ext: 'dmg' },
  { id: 'linux', label: 'Linux',    file: '/installers/vibemoji-desktop.AppImage',  ext: 'AppImage' },
  { id: 'android', label: 'Android', file: '/installers/vibemoji.apk',              ext: 'apk' },
];

const FALLBACK = '/installers/README.txt';

function detectTarget(): Target {
  if (typeof navigator === 'undefined') return TARGETS[0];
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('android')) return TARGETS[3];
  if (ua.includes('mac')) return TARGETS[1];
  if (ua.includes('linux')) return TARGETS[2];
  return TARGETS[0];
}

export default function InstallButton() {
  const [target, setTarget] = useState<Target>(TARGETS[0]);
  const [open, setOpen] = useState(false);
  const [insideElectron, setInsideElectron] = useState(false);

  useEffect(() => {
    setTarget(detectTarget());
    setInsideElectron(typeof window !== 'undefined' && Boolean((window as any).vibemoji?.isElectron));
  }, []);

  const handleDownload = async (t: Target, e: React.MouseEvent<HTMLAnchorElement>) => {
    try {
      const res = await fetch(t.file, { method: 'HEAD' });
      if (!res.ok) {
        e.preventDefault();
        const a = document.createElement('a');
        a.href = FALLBACK;
        a.download = `vibemoji-installer-placeholder.txt`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch {
      // let the browser try the direct link anyway
    }
    setOpen(false);
  };

  if (insideElectron) {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        running in desktop app
      </div>
    );
  }

  return (
    <div className="relative inline-block">
      <div className="inline-flex overflow-hidden rounded-full shadow-lg shadow-violet-500/20">
        <a
          href={target.file}
          download
          onClick={(e) => handleDownload(target, e)}
          className="inline-flex items-center gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-95"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
          Install for {target.label}
        </a>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Choose another platform"
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
              href={t.file}
              download
              onClick={(e) => handleDownload(t, e)}
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
