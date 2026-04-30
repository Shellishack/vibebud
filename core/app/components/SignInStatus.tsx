'use client';

import { useEffect, useState } from 'react';
import { fetchAuthSession, signInUrl, signOutUrl, type AuthSession } from './authClient';

function initials(session: AuthSession) {
  const label = session.user?.name || session.user?.email || '?';
  return label
    .split(/\s|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';
}

export default function SignInStatus() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchAuthSession()
      .then((next) => {
        if (!cancelled) setSession(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div
        data-buddy-interactive
        className="h-9 w-20 animate-pulse rounded-full bg-white/70 shadow-md ring-1 ring-zinc-200 backdrop-blur-md dark:bg-zinc-900/70 dark:ring-zinc-700"
      />
    );
  }

  if (!session) {
    return (
      <button
        data-buddy-interactive
        onClick={() => { window.location.href = signInUrl(); }}
        aria-label="Sign in"
        title="Sign in"
        className="rounded-full bg-white/85 px-3 py-2 text-sm font-semibold text-zinc-700 shadow-md ring-1 ring-zinc-200 backdrop-blur-md hover:bg-white hover:text-zinc-900 dark:bg-zinc-900/85 dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
      >
        Sign in
      </button>
    );
  }

  return (
    <div
      data-buddy-interactive
      className="flex h-9 items-center gap-2 rounded-full bg-white/85 pl-1.5 pr-3 text-zinc-700 shadow-md ring-1 ring-zinc-200 backdrop-blur-md dark:bg-zinc-900/85 dark:text-zinc-200 dark:ring-zinc-700"
      title={session.user?.email || session.user?.name || 'Signed in'}
    >
      <span className="grid h-6 w-6 place-items-center rounded-full bg-violet-600 text-[10px] font-bold text-white">
        {initials(session)}
      </span>
      <span className="max-w-32 truncate text-sm font-semibold">
        {session.user?.name || session.user?.email || 'Signed in'}
      </span>
      <button
        onClick={() => { window.location.href = signOutUrl(); }}
        className="ml-1 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
      >
        Sign out
      </button>
    </div>
  );
}
