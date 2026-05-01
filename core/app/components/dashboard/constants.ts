import { isMobile } from '@/lib/platform/detect';

export const STORAGE_KEY = 'vibebud.buddies.v2';

export const AVATAR_SIZE = 112;
export const HULL_PAD_X = 10;
export const HULL_PAD_TOP = 22;
export const HULL_PAD_BOTTOM = 8;
export const COLLAPSED_STRIDE = 28;
export const EXPANDED_STRIDE = 96;
export const EXPAND_HIT_INSET = 48;
export const MERGE_RADIUS = 90;
export const EJECT_DY = 36;
export const EJECT_DX = 80;
export const HOVER_LEAVE_GRACE_MS = 250;
export const STACK_STRIDE = 6;

export const ANCHOR = (() => {
  const pad = typeof window !== 'undefined' && isMobile() ? 12 : 24;
  return { right: pad, bottom: pad };
})();

export const SNAP_THRESHOLD = (typeof window !== 'undefined' && isMobile()) ? 12 : 64;
