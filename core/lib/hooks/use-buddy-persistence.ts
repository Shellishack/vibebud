'use client';

import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { AvatarInstanceState } from '../../app/components/avatar/avatar-instance.types';
import { normalizeGamification } from '../../app/components/gamification';
import { COLLAPSED_STRIDE, EXPANDED_STRIDE, STACK_STRIDE, STORAGE_KEY } from '../../app/components/dashboard/constants';
import { clampBuddyPos, clampGroupPos, peekedGroupPos } from '../../app/components/dashboard/geometry';
import { loadFromStorage } from '../../app/components/dashboard/storage';
import type { Group } from '../../app/components/dashboard/types';

type Options = {
  buddies: AvatarInstanceState[];
  groups: Group[];
  expanded: Record<string, boolean>;
  peekedDock: Record<string, boolean>;
  hydratedRef: MutableRefObject<boolean>;
  idRef: MutableRefObject<number>;
  groupIdRef: MutableRefObject<number>;
  setBuddies: Dispatch<SetStateAction<AvatarInstanceState[]>>;
  setGroups: Dispatch<SetStateAction<Group[]>>;
};

export function useBuddyPersistence({
  buddies,
  groups,
  expanded,
  peekedDock,
  hydratedRef,
  idRef,
  groupIdRef,
  setBuddies,
  setGroups,
}: Options) {
  useEffect(() => {
    const stored = loadFromStorage();
    if (stored) {
      const clampedGroups = stored.groups.map((g) => ({
        ...g,
        pos: clampGroupPos(g.pos, g.memberIds.length),
      }));
      const groupById = new Map(clampedGroups.map((g) => [g.id, g]));
      setBuddies(stored.buddies.map((b) => {
        if (b.groupId && groupById.has(b.groupId)) {
          const g = groupById.get(b.groupId)!;
          const i = g.memberIds.indexOf(b.id);
          if (i >= 0) {
            return normalizeGamification<AvatarInstanceState>({ ...b, pos: { x: g.pos.x + i * COLLAPSED_STRIDE, y: g.pos.y } });
          }
        }
        return normalizeGamification<AvatarInstanceState>({ ...b, pos: clampBuddyPos(b.pos) });
      }));
      setGroups(clampedGroups);
      idRef.current = stored.buddies.reduce((max, b) => {
        const n = parseInt(b.id.replace(/^buddy-/, ''), 10);
        return Number.isFinite(n) ? Math.max(max, n) : max;
      }, 0) + 1;
      groupIdRef.current = stored.groups.reduce((max, g) => {
        const n = parseInt(g.id.replace(/^group-/, ''), 10);
        return Number.isFinite(n) ? Math.max(max, n) : max;
      }, 0) + 1;
    }
    hydratedRef.current = true;
  }, [groupIdRef, hydratedRef, idRef, setBuddies, setGroups]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ buddies, groups }));
    } catch {
      // noop
    }
  }, [buddies, groups, hydratedRef]);

  useEffect(() => {
    setBuddies((cur) => {
      const dragging: Set<string> | undefined = (window as { __vibebudDragging?: Set<string> }).__vibebudDragging;
      let changed = false;
      const next = cur.map((b) => {
        if (!b.groupId) return b;
        const g = groups.find((x) => x.id === b.groupId);
        if (!g) return b;
        const i = g.memberIds.indexOf(b.id);
        if (i < 0) return b;
        const dockPeeked = !!peekedDock[`group:${g.id}`];
        const stride = (g.minimized && !dockPeeked)
          ? STACK_STRIDE
          : (expanded[g.id] ? EXPANDED_STRIDE : COLLAPSED_STRIDE);
        const groupRenderPos = (g.minimized && dockPeeked)
          ? peekedGroupPos(g.minimized.edge, g.memberIds.length, g.lastFreePos, stride)
          : g.pos;
        const target = { x: groupRenderPos.x + i * stride, y: groupRenderPos.y };
        if (dragging?.has(b.id)) return b;
        if (b.pos.x === target.x && b.pos.y === target.y) return b;
        changed = true;
        return { ...b, pos: target };
      });
      return changed ? next : cur;
    });
  }, [groups, expanded, peekedDock, setBuddies]);
}
