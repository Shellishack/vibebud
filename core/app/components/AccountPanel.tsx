'use client';

import { useEffect, useState } from 'react';
import { fetchAuthSession, goToGoogleSignIn, goToSignOut, type AuthSession } from './authClient';

export default function AccountPanel() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const user = session?.user;

  useEffect(() => {
    let cancelled = false;
    fetchAuthSession()
      .then((next) => {
        if (!cancelled) setSession(next);
      })
      .finally(() => {
        if (!cancelled) setStatus('ready');
      });
    return () => { cancelled = true; };
  }, []);

  if (status === 'loading') {
    return (
      <div className="mt-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-400">
        Checking session...
      </div>
    );
  }

  if (user) {
    return (
      <div className="mt-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/60">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{user.name || 'Signed in'}</p>
        {user.email && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{user.email}</p>}
        <button
          onClick={() => { void goToSignOut(); }}
          className="mt-3 w-full rounded-full px-3 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 hover:bg-white dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-800"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-2xl border border-zinc-200 p-3 dark:border-zinc-700">
      <button
        onClick={() => {
          void goToGoogleSignIn();
        }}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
          <path fill="currentColor" d="M21.8 12.2c0-.7-.1-1.3-.2-1.9H12v3.6h5.5a4.7 4.7 0 0 1-2 3.1v2.6h3.2c1.9-1.8 3.1-4.4 3.1-7.4Z" />
          <path fill="currentColor" d="M12 22c2.7 0 5-.9 6.7-2.4L15.5 17c-.9.6-2 .9-3.5.9a6 6 0 0 1-5.6-4.1H3.1v2.7A10 10 0 0 0 12 22Z" />
          <path fill="currentColor" d="M6.4 13.8a6 6 0 0 1 0-3.6V7.5H3.1a10 10 0 0 0 0 9l3.3-2.7Z" />
          <path fill="currentColor" d="M12 6.1c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.8 9.8 0 0 0 12 2a10 10 0 0 0-8.9 5.5l3.3 2.7A6 6 0 0 1 12 6.1Z" />
        </svg>
        Sign in with Google
      </button>
    </div>
  );
}
