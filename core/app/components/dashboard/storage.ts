import type { AvatarInstanceState } from '../avatar/avatar-instance.types';
import { normalizeGamification } from '../gamification';
import { STORAGE_KEY } from './constants';
import type { Persisted } from './types';

export const initialBuddies = (): AvatarInstanceState[] => [
  normalizeGamification<AvatarInstanceState>({ id: 'buddy-1', variantId: 'violet', pos: { x: 0, y: 0 }, messages: [] }),
];

export function loadFromStorage(): Persisted | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.buddies) && parsed.buddies.length > 0) {
      return { buddies: parsed.buddies, groups: Array.isArray(parsed.groups) ? parsed.groups : [] };
    }
  } catch {
    // noop
  }
  return null;
}
