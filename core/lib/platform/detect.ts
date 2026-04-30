import { Capacitor } from '@capacitor/core';
import type { PlatformId } from './types';

const isElectron = (): boolean => {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as {
    process?: { versions?: { electron?: string } };
    vibebud?: { isElectron?: boolean };
  };
  if (w.vibebud?.isElectron) return true;
  return typeof w.process?.versions?.electron === 'string';
};

export function getPlatform(): PlatformId {
  if (typeof window === 'undefined') return 'web';
  // The Android overlay WebView (OverlayService) is a plain WebView outside
  // Capacitor's BridgeActivity, so Capacitor.isNativePlatform() returns
  // false — but it does have our `vibebudNative` JS interface injected.
  // That presence is what we actually rely on for rect-publishing and the
  // failsafe-close bridge, so check it first.
  const w = window as unknown as { vibebudNative?: unknown };
  if (w.vibebudNative) return 'capacitor-android';
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
