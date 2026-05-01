'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from '../../lib/hooks/use-translations';

const GITHUB_REPO_URL = 'https://github.com/shellishack/vibebud';
const GITHUB_REPO_API_URL = 'https://api.github.com/repos/shellishack/vibebud';

function formatStars(count: number) {
  if (count >= 1000) {
    const rounded = Math.round(count / 100) / 10;
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}k`;
  }
  return String(count);
}

export default function GitHubLink() {
  const { t } = useTranslations();
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(GITHUB_REPO_API_URL)
      .then((res) => res.ok ? res.json() : null)
      .then((data: { stargazers_count?: unknown } | null) => {
        if (cancelled || typeof data?.stargazers_count !== 'number') return;
        setStars(data.stargazers_count);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <a
      data-buddy-interactive
      href={GITHUB_REPO_URL}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-9 items-center gap-2 rounded-full bg-white/85 px-3 text-sm font-medium text-zinc-600 shadow-md ring-1 ring-zinc-200 backdrop-blur-md hover:bg-white hover:text-zinc-900 dark:bg-zinc-900/85 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="currentColor" aria-hidden>
        <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.48 2 2 6.58 2 12.22c0 4.51 2.87 8.34 6.84 9.69.5.09.68-.22.68-.49 0-.24-.01-1.04-.01-1.89-2.78.62-3.37-1.22-3.37-1.22-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1 .07 1.53 1.05 1.53 1.05.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.28 9.28 0 0 1 12 6.92c.85 0 1.7.12 2.5.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.59.69.49A10.15 10.15 0 0 0 22 12.22C22 6.58 17.52 2 12 2Z" />
      </svg>
      <span>{t('home.github')}</span>
      <span className="h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
      <span className="inline-flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
          <path d="m12 2.25 2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.27l-5.88 3.09 1.12-6.55-4.76-4.64 6.58-.96L12 2.25Z" />
        </svg>
        {stars === null ? 'Stars' : formatStars(stars)}
      </span>
    </a>
  );
}
