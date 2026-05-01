import AppSettings from '../app-settings';
import DiscordLink from '../discord-link';
import GitHubLink from '../github-link';
import LanguageSelector from '../language-selector';
import SignInStatus from '../sign-in-status';
import type { PlatformAdapter } from '@/lib/platform/types';

type Props = {
  adapter: PlatformAdapter;
  isAndroidOverlay: boolean;
  appSettingsOpen: boolean;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
};

export default function DashboardChrome({
  adapter,
  isAndroidOverlay,
  appSettingsOpen,
  onOpenSettings,
  onCloseSettings,
}: Props) {
  return (
    <>
      {adapter.id !== 'electron' && !isAndroidOverlay && (
        <div className="fixed right-3 top-3 z-[70] flex items-center gap-2">
          <GitHubLink />
          <DiscordLink />
          <LanguageSelector />
          <SignInStatus />
          {adapter.scanQrForPair && (
            <button
              data-buddy-interactive
              onClick={async () => { await adapter.scanQrForPair?.(); }}
              aria-label="Scan QR to pair"
              title="Scan QR to pair"
              className="grid h-9 w-9 place-items-center rounded-full bg-white/85 text-zinc-600 shadow-md ring-1 ring-zinc-200 backdrop-blur-md hover:bg-white hover:text-zinc-900 dark:bg-zinc-900/85 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7V5a2 2 0 0 1 2-2h2" />
                <path d="M17 3h2a2 2 0 0 1 2 2v2" />
                <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
                <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                <line x1="7" y1="12" x2="17" y2="12" />
              </svg>
            </button>
          )}
          <button
            data-buddy-interactive
            onClick={onOpenSettings}
            aria-label="App settings"
            title="App settings"
            className="grid h-9 w-9 place-items-center rounded-full bg-white/85 text-zinc-600 shadow-md ring-1 ring-zinc-200 backdrop-blur-md hover:bg-white hover:text-zinc-900 dark:bg-zinc-900/85 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.36.16.66.42.87.74A1.65 1.65 0 0 0 21 10h.09a2 2 0 1 1 0 4H21a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      )}

      <AppSettings open={appSettingsOpen} onClose={onCloseSettings} />
    </>
  );
}
