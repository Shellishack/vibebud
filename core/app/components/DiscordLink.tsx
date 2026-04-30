'use client';

import { useTranslations } from '../../lib/hooks/use-translations';

const DISCORD_INVITE_URL = 'https://discord.gg/9tPu9SQhVz';

export default function DiscordLink() {
  const { t } = useTranslations();

  return (
    <a
      data-buddy-interactive
      href={DISCORD_INVITE_URL}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-9 items-center gap-2 rounded-full bg-white/85 px-3 text-sm font-medium text-zinc-600 shadow-md ring-1 ring-zinc-200 backdrop-blur-md hover:bg-white hover:text-zinc-900 dark:bg-zinc-900/85 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="currentColor" aria-hidden>
        <path d="M20.32 4.37A19.8 19.8 0 0 0 15.36 2.8a13.78 13.78 0 0 0-.64 1.34 18.33 18.33 0 0 0-5.44 0 12.4 12.4 0 0 0-.65-1.34 19.74 19.74 0 0 0-4.97 1.57C.52 9.06-.33 13.64.1 18.16a19.9 19.9 0 0 0 6.1 3.04 14.7 14.7 0 0 0 1.3-2.08 12.93 12.93 0 0 1-2.05-.98c.17-.12.34-.25.5-.38a14.22 14.22 0 0 0 12.1 0c.16.13.33.26.5.38-.65.38-1.34.71-2.05.98.38.73.82 1.43 1.3 2.08a19.83 19.83 0 0 0 6.1-3.04c.5-5.24-.85-9.78-3.58-13.79ZM8.02 15.38c-1.18 0-2.14-1.07-2.14-2.38 0-1.32.94-2.38 2.14-2.38 1.2 0 2.16 1.08 2.14 2.38 0 1.31-.94 2.38-2.14 2.38Zm7.96 0c-1.18 0-2.14-1.07-2.14-2.38 0-1.32.94-2.38 2.14-2.38 1.2 0 2.16 1.08 2.14 2.38 0 1.31-.94 2.38-2.14 2.38Z" />
      </svg>
      <span>{t('home.discord')}</span>
    </a>
  );
}
