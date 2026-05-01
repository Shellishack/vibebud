'use client';

export type AuthSession = {
  user?: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  expires?: string;
};

export const SERVER_ORIGIN = (process.env.NEXT_PUBLIC_VIBEBUD_SERVER_URL || 'http://localhost:3070').replace(/\/+$/, '');

export async function fetchAuthSession(): Promise<AuthSession | null> {
  try {
    const res = await fetch(`${SERVER_ORIGIN}/auth/session`, { credentials: 'include' });
    if (!res.ok) return null;
    const session = await res.json() as AuthSession;
    return session?.user ? session : null;
  } catch {
    return null;
  }
}

export function signInUrl(callbackUrl = window.location.href) {
  return `${SERVER_ORIGIN}/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;
}

export function signOutUrl(callbackUrl = window.location.href) {
  return `${SERVER_ORIGIN}/auth/signout?callbackUrl=${encodeURIComponent(callbackUrl)}`;
}

async function getCsrfToken(): Promise<string> {
  const res = await fetch(`${SERVER_ORIGIN}/auth/csrf`, { credentials: 'include' });
  if (!res.ok) throw new Error('Unable to prepare auth request.');
  const { csrfToken } = await res.json() as { csrfToken?: string };
  if (!csrfToken) throw new Error('Auth server did not return a CSRF token.');
  return csrfToken;
}

function submitAuthForm(action: string, fields: Record<string, string>) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = action;
  form.style.display = 'none';
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

export async function goToGoogleSignIn(callbackUrl = window.location.href) {
  const csrfToken = await getCsrfToken();
  submitAuthForm(`${SERVER_ORIGIN}/auth/signin/google`, { csrfToken, callbackUrl });
}

export async function goToSignOut(callbackUrl = window.location.href) {
  const csrfToken = await getCsrfToken();
  submitAuthForm(`${SERVER_ORIGIN}/auth/signout`, { csrfToken, callbackUrl });
}
