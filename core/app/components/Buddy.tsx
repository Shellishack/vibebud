'use client';

import { useEffect, useRef, useState } from 'react';
import BuddyInstance, { type BuddyInstanceState } from './BuddyInstance';
import { nextUnusedPersonality } from './personalities';

const STORAGE_KEY = 'vibemoji.buddies.v1';

const initialBuddies = (): BuddyInstanceState[] => [
  { id: 'buddy-1', variantId: 'violet', pos: { x: 0, y: 0 }, messages: [] },
];

function loadFromStorage(): BuddyInstanceState[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    /* noop */
  }
  return null;
}

export default function Buddy() {
  const [buddies, setBuddies] = useState<BuddyInstanceState[]>(initialBuddies);
  const idRef = useRef(2);
  const hydratedRef = useRef(false);

  // Hydrate from localStorage after mount (avoids SSR mismatch).
  useEffect(() => {
    const stored = loadFromStorage();
    if (stored) {
      setBuddies(stored);
      const maxN = stored.reduce((m, b) => {
        const n = parseInt(b.id.replace(/^buddy-/, ''), 10);
        return Number.isFinite(n) ? Math.max(m, n) : m;
      }, 0);
      idRef.current = maxN + 1;
    }
    hydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(buddies));
    } catch {
      /* noop */
    }
  }, [buddies]);

  // (Click-through is no longer toggled per hover — see the resize effect
  // below. The window is sized to the interactive bounding box so any pixel
  // inside it is intentionally interactive, and toggling WS_EX_TRANSPARENT is
  // what caused Chrome below us to evict its hardware video overlay.)

  const updateBuddy = (id: string, next: BuddyInstanceState) => {
    setBuddies((cur) => cur.map((b) => (b.id === id ? next : b)));
  };

  const spawnBuddy = () => {
    setBuddies((cur) => {
      const taken = cur.map((b) => b.variantId);
      const personality = nextUnusedPersonality(taken);
      const offset = cur.length * 28;
      return [
        ...cur,
        {
          id: `buddy-${idRef.current++}`,
          variantId: personality.variantId,
          pos: { x: -offset * 4, y: -offset },
          messages: [],
        },
      ];
    });
  };

  useEffect(() => {
    const off = (window as any).vibemoji?.onSpawnBuddy?.(() => spawnBuddy());
    return () => { if (typeof off === 'function') off(); };
  }, []);

  // The OS window covers the full work area and is click-through by default
  // (setIgnoreMouseEvents in main.js). We toggle interactivity on whenever
  // the OS-forwarded mousemove lands over an element marked
  // data-buddy-interactive (or a descendant), and back off otherwise.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const v = (window as any).vibemoji;
    if (!v?.setInteractive) return;
    let interactive = false;
    const setInteractive = (next: boolean) => {
      if (next === interactive) return;
      interactive = next;
      v.setInteractive(next);
    };
    const onMove = (ev: MouseEvent) => {
      const dragging: Set<string> | undefined = (window as any).__vibemojiDragging;
      if (dragging && dragging.size > 0) { setInteractive(true); return; }
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      setInteractive(!!el?.closest('[data-buddy-interactive]'));
    };
    document.addEventListener('mousemove', onMove);
    return () => document.removeEventListener('mousemove', onMove);
  }, []);

  const removeBuddy = (id: string) => {
    setBuddies((cur) => (cur.length <= 1 ? cur : cur.filter((b) => b.id !== id)));
  };

  const openSetRef = useRef<Set<string>>(new Set());
  const focusableRef = useRef(false);
  const onOpenChange = (id: string, isOpen: boolean) => {
    if (isOpen) openSetRef.current.add(id);
    else openSetRef.current.delete(id);
    const wantFocusable = openSetRef.current.size > 0;
    if (wantFocusable === focusableRef.current) return;
    focusableRef.current = wantFocusable;
    (window as any).vibemoji?.setFocusable?.(wantFocusable);
  };

  return (
    <>
      {buddies.map((b, i) => (
        <BuddyInstance
          key={b.id}
          state={b}
          anchor={{ right: 24 + i * 0, bottom: 24 + i * 0 }}
          canRemove={buddies.length > 1}
          onChange={(next) => updateBuddy(b.id, next)}
          onSpawn={spawnBuddy}
          onRemove={() => removeBuddy(b.id)}
          onOpenChange={onOpenChange}
        />
      ))}

      <style jsx global>{`
        @keyframes buddy-toast-in {
          from { opacity: 0; transform: translateY(-8px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes buddy-bubble-in {
          from { opacity: 0; transform: translateY(8px) scale(0.96); transform-origin: bottom right; }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </>
  );
}
