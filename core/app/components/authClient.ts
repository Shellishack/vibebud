'use client';

export type AuthSession = {
  user?: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  expires?: string;
};

export const SERVER_ORIGIN = (process.env.NEXT_PUBLIC_VIBEMOJI_SERVER_URL || 'http://localhost:3070').replace(/\/+$/, '');

export async function fetchAuthSession(): Promise<AuthSession | null> {
  const res = await fetch(`${SERVER_ORIGIN}/auth/session`, { credentials: 'include' });
  if (!res.ok) return null;
  const session = await res.json() as AuthSession;
  return session?.user ? session : null;
}

export function signInUrl(callbackUrl = window.location.href) {
  return `${SERVER_ORIGIN}/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;
}

export function signOutUrl(callbackUrl = window.location.href) {
  return `${SERVER_ORIGIN}/auth/signout?callbackUrl=${encodeURIComponent(callbackUrl)}`;
}
