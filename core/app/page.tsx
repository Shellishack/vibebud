'use client';

import Link from 'next/link';
import Buddy from './components/Buddy';
import InstallButton from './components/InstallButton';
import OverlayButton from './components/OverlayButton';
import TodoList from './components/TodoList';
import { useTranslations } from '../lib/hooks/use-translations';

export default function Home() {
  const { t } = useTranslations();

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-zinc-50 via-violet-50 to-fuchsia-50 font-sans dark:from-zinc-950 dark:via-violet-950/30 dark:to-zinc-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(139,92,246,0.15),transparent_50%),radial-gradient(circle_at_80%_80%,rgba(236,72,153,0.12),transparent_50%)]" />

      <main className="relative mx-auto flex min-h-screen max-w-3xl flex-col items-start justify-center gap-10 px-8 py-24">
        <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/60 px-3 py-1 text-xs font-medium text-violet-700 backdrop-blur dark:border-violet-500/30 dark:bg-zinc-900/60 dark:text-violet-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500" />
          {t('home.badge')}
        </div>

        <h1 className="max-w-2xl text-5xl font-semibold leading-tight tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-6xl">
          {t('home.headlinePrefix')}{' '}
          <span className="bg-gradient-to-r from-violet-600 to-fuchsia-500 bg-clip-text text-transparent">
            {t('home.headlineAccent')}
          </span>
          {t('home.headlineSuffix')}
        </h1>

        <p className="max-w-xl text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
          {t('home.description')}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <InstallButton />
          <OverlayButton />
          <Link
            href="/manage"
            className="rounded-full border border-violet-200 bg-white/70 px-4 py-2 text-sm font-medium text-violet-700 backdrop-blur transition-colors hover:border-violet-300 hover:bg-white dark:border-violet-500/30 dark:bg-zinc-900/60 dark:text-violet-300 dark:hover:border-violet-400/50"
          >
            {t('home.manageAvatars')}
          </Link>
          <a
            href="https://github.com/shellishack/vibebud"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-4 py-2 text-sm font-medium text-zinc-700 backdrop-blur transition-colors hover:border-zinc-300 hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200 dark:hover:border-zinc-500"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.48 2 2 6.58 2 12.22c0 4.51 2.87 8.34 6.84 9.69.5.09.68-.22.68-.49 0-.24-.01-1.04-.01-1.89-2.78.62-3.37-1.22-3.37-1.22-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1 .07 1.53 1.05 1.53 1.05.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.28 9.28 0 0 1 12 6.92c.85 0 1.7.12 2.5.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.59.69.49A10.15 10.15 0 0 0 22 12.22C22 6.58 17.52 2 12 2Z" />
            </svg>
            {t('home.github')}
          </a>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">{t('home.downloadMeta')}</span>
        </div>

        <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
          <Capability emoji="●" title={t('home.capabilities.floating.title')} body={t('home.capabilities.floating.body')} />
          <Capability emoji="●" title={t('home.capabilities.chat.title')} body={t('home.capabilities.chat.body')} />
          <Capability emoji="●" title={t('home.capabilities.toasts.title')} body={t('home.capabilities.toasts.body')} />
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white/70 p-5 text-sm text-zinc-600 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
          <p className="font-medium text-zinc-900 dark:text-zinc-100">{t('home.tryTitle')}</p>
          <p className="mt-1">
            {t('home.tryBodyPrefix')}{' '}
            <span className="rounded bg-violet-100 px-1.5 py-0.5 font-mono text-xs text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">{t('home.tryPing')}</span>{' '}
            {t('home.tryBodySuffix')}
          </p>
        </div>

        <TodoList />
      </main>

      <Buddy />
    </div>
  );
}

function Capability({ emoji, title, body }: { emoji: string; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white/70 p-4 backdrop-blur transition-colors hover:border-violet-300 dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-violet-500/40">
      <div className="text-lg text-violet-500">{emoji}</div>
      <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{body}</p>
    </div>
  );
}
