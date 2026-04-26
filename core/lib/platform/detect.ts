import { Capacitor } from '@capacitor/core';
import type { PlatformId } from './types';

const isElectron = (): boolean => {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { process?: { versions?: { electron?: string } } };
  return typeof w.process?.versions?.electron === 'string';
};

export function getPlatform(): PlatformId {
  if (typeof window === 'undefined') return 'web';
  if (Capacitor.isNativePlatform()) return 'capacitor-android';
  if (isElectron()) return 'electron';
  if (/Mobi|Android/i.test(navigator.userAgent)) return 'web-mobile';
  return 'web';
}

export function isMobile(): boolean {
  const p = getPlatform();
  return p === 'capacitor-android' || p === 'web-mobile';
}

export function isWeb(): boolean {
  const p = getPlatform();
  return p === 'web' || p === 'web-mobile';
}
