'use client';

import { useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { AvatarInstanceState } from '../../app/components/avatar/avatar-instance.types';
import type { ShimejiAction } from '@/lib/avatar/types';
import type { PhysicsMode, Vec2 } from '../../app/components/physics';
import { clampBuddyPos } from '../../app/components/dashboard/geometry';

type Brain = { action: ShimejiAction; dir: -1 | 1; until: number };

type Options = {
  modeRef: RefObject<PhysicsMode>;
  buddiesRef: RefObject<AvatarInstanceState[]>;
  openBuddiesRef: RefObject<Record<string, boolean>>;
  wonderPausedBuddiesRef: RefObject<Record<string, boolean>>;
  setBuddies: Dispatch<SetStateAction<AvatarInstanceState[]>>;
};

export function useWonderAvatarBrain({
  modeRef,
  buddiesRef,
  openBuddiesRef,
  wonderPausedBuddiesRef,
  setBuddies,
}: Options) {
  const [actions, setActions] = useState<Record<string, ShimejiAction>>({});
  const [directions, setDirections] = useState<Record<string, -1 | 1>>({});
  const brainRef = useRef<Map<string, Brain>>(new Map());
  const rafRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);

  const setAction = (id: string, action: ShimejiAction) => {
    setActions((cur) => (cur[id] === action ? cur : { ...cur, [id]: action }));
  };
  const setDirection = (id: string, dir: -1 | 1) => {
    setDirections((cur) => (cur[id] === dir ? cur : { ...cur, [id]: dir }));
  };

  const tick = () => {
    rafRef.current = 0;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const dt = Math.min(48, Math.max(1, now - lastTickRef.current));
    lastTickRef.current = now;
    const dragging: Set<string> = (window as unknown as { __vibebudDragging?: Set<string> }).__vibebudDragging ?? new Set();
    const updates: Record<string, Vec2> = {};
    let hasActionAvatar = false;

    if (modeRef.current !== 'wonder') {
      setActions((cur) => (Object.keys(cur).length ? {} : cur));
      setDirections((cur) => (Object.keys(cur).length ? {} : cur));
      brainRef.current.clear();
      return;
    }

    for (const b of buddiesRef.current) {
      if (b.avatar?.kind !== 'shimeji' && b.avatar?.kind !== 'model3d' && b.avatar?.kind !== 'sprite') continue;
      hasActionAvatar = true;
      if (openBuddiesRef.current[b.id] || wonderPausedBuddiesRef.current[b.id]) {
        setAction(b.id, 'sit');
        continue;
      }
      if (b.minimized || b.groupId || dragging.has(b.id)) {
        setAction(b.id, dragging.has(b.id) ? 'drag' : 'idle');
        continue;
      }
      const floor = clampBuddyPos({ ...b.pos, y: 99999 }).y;
      const leftWall = clampBuddyPos({ ...b.pos, x: -99999 }).x;
      const rightWall = clampBuddyPos({ ...b.pos, x: 99999 }).x;
      const brain = brainRef.current.get(b.id) ?? {
        action: 'fall' as ShimejiAction,
        dir: Math.random() < 0.5 ? -1 : 1,
        until: now,
      };
      let action = brain.action;
      let pos = b.pos;

      if (b.pos.y < floor - 4) {
        action = 'fall';
        pos = clampBuddyPos({ x: b.pos.x, y: b.pos.y + 0.22 * dt });
      } else {
        if (now > brain.until || action === 'fall') {
          const r = Math.random();
          const nearWall = Math.abs(b.pos.x - leftWall) < 8 || Math.abs(b.pos.x - rightWall) < 8;
          action = nearWall && r > 0.72 ? 'climb' : r < 0.58 ? 'walk' : r < 0.8 ? 'sit' : 'idle';
          if (action === 'walk' && Math.random() < 0.35) brain.dir = Math.random() < 0.5 ? -1 : 1;
          brain.until = now + (action === 'walk' ? 2400 + Math.random() * 2600 : 1600 + Math.random() * 2600);
        }
        if (action === 'walk') {
          const next = clampBuddyPos({ x: b.pos.x + brain.dir * 0.028 * dt, y: floor });
          if (next.x === leftWall || next.x === rightWall) {
            brain.dir = next.x === leftWall ? 1 : -1;
            action = Math.random() < 0.25 ? 'climb' : 'walk';
          }
          pos = next;
        } else if (action === 'climb') {
          const wall = Math.abs(b.pos.x - leftWall) < Math.abs(b.pos.x - rightWall) ? leftWall : rightWall;
          pos = clampBuddyPos({ x: wall, y: b.pos.y - 0.024 * dt });
          if (pos.y < floor - 180 || now > brain.until) {
            action = 'fall';
            brain.until = now + 800;
          }
        } else {
          pos = { x: b.pos.x, y: floor };
        }
      }
      brain.action = action;
      brainRef.current.set(b.id, brain);
      setAction(b.id, action);
      setDirection(b.id, brain.dir);
      if (pos.x !== b.pos.x || pos.y !== b.pos.y) updates[b.id] = pos;
    }

    if (Object.keys(updates).length) {
      setBuddies((cur) => cur.map((b) => updates[b.id] ? { ...b, pos: updates[b.id] } : b));
    }
    if (hasActionAvatar) rafRef.current = requestAnimationFrame(tick);
  };

  const ensureLoop = () => {
    if (rafRef.current) return;
    lastTickRef.current = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    rafRef.current = requestAnimationFrame(tick);
  };

  const cancelLoop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  };

  return { actions, directions, ensureLoop, cancelLoop };
}
