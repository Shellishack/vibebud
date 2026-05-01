'use client';

import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { PlatformAdapter } from '@/lib/platform/types';
import type { AvatarInstanceState } from '../../app/components/avatar/avatar-instance.types';
import { normalizeGamification } from '../../app/components/gamification';
import { nextUnusedPersonality } from '../../app/components/personalities';
import { AVATAR_SIZE } from '../../app/components/dashboard/constants';
import { clampBuddyPos, clampGroupPos } from '../../app/components/dashboard/geometry';
import type { Group } from '../../app/components/dashboard/types';

type Options = {
  adapter: PlatformAdapter;
  buddiesRef: MutableRefObject<AvatarInstanceState[]>;
  groupsRef: MutableRefObject<Group[]>;
  idRef: MutableRefObject<number>;
  setBuddies: Dispatch<SetStateAction<AvatarInstanceState[]>>;
  setGroups: Dispatch<SetStateAction<Group[]>>;
  setOpenBuddies: Dispatch<SetStateAction<Record<string, boolean>>>;
  setWonderPausedBuddies: Dispatch<SetStateAction<Record<string, boolean>>>;
  setLlmOnboardingBuddyId: Dispatch<SetStateAction<string | null>>;
};

export function useBuddyActions({
  adapter,
  buddiesRef,
  groupsRef,
  idRef,
  setBuddies,
  setGroups,
  setOpenBuddies,
  setWonderPausedBuddies,
  setLlmOnboardingBuddyId,
}: Options) {
  const openSetRef = useRef<Set<string>>(new Set());
  const focusableRef = useRef(false);

  const updateBuddy = (id: string, next: AvatarInstanceState) => {
    const clamped = next.minimized ? next : { ...next, pos: clampBuddyPos(next.pos) };
    setBuddies((cur) => cur.map((b) => (b.id === id ? clamped : b)));
  };

  const restoreBuddy = (id: string) => {
    setBuddies((cur) => cur.map((b) => {
      if (b.id !== id || !b.minimized) return b;
      return { ...b, minimized: undefined, lastFreePos: undefined, pos: clampBuddyPos(b.lastFreePos ?? b.pos) };
    }));
  };

  const restoreGroup = (gid: string) => {
    setGroups((cur) => cur.map((g) => {
      if (g.id !== gid || !g.minimized) return g;
      return {
        ...g,
        minimized: undefined,
        lastFreePos: undefined,
        pos: clampGroupPos(g.lastFreePos ?? g.pos, g.memberIds.length),
      };
    }));
  };

  const spawnBuddy = () => {
    const id = `buddy-${idRef.current++}`;
    setBuddies((cur) => {
      const personality = nextUnusedPersonality(cur.map((b) => b.variantId));
      const gap = 16;
      return [
        ...cur,
        normalizeGamification<AvatarInstanceState>({
          id,
          variantId: personality.variantId,
          pos: clampBuddyPos({ x: -cur.length * (AVATAR_SIZE + gap), y: 0 }),
          messages: [],
        }),
      ];
    });
    setLlmOnboardingBuddyId(id);
  };

  const removeBuddy = (id: string) => {
    setBuddies((cur) => cur.length <= 1 ? cur : cur.filter((b) => b.id !== id));
    setGroups((cur) => {
      const updated = cur
        .map((g) => ({ ...g, memberIds: g.memberIds.filter((m) => m !== id) }))
        .filter((g) => g.memberIds.length >= 2);
      const surviving = new Set(updated.map((g) => g.id));
      setBuddies((bs) => bs.map((b) => (b.groupId && !surviving.has(b.groupId) ? { ...b, groupId: undefined } : b)));
      return updated;
    });
    setWonderPausedBuddies((cur) => {
      if (!cur[id]) return cur;
      const next = { ...cur };
      delete next[id];
      return next;
    });
  };

  const onOpenChange = (id: string, isOpen: boolean) => {
    setOpenBuddies((cur) => {
      if (!!cur[id] === isOpen) return cur;
      const next = { ...cur };
      if (isOpen) next[id] = true;
      else delete next[id];
      return next;
    });
    if (isOpen) openSetRef.current.add(id);
    else openSetRef.current.delete(id);
    const wantFocusable = openSetRef.current.size > 0;
    if (wantFocusable !== focusableRef.current) {
      focusableRef.current = wantFocusable;
      adapter.setFocusable(wantFocusable);
    }
    adapter.setOverlayExpanded(openSetRef.current.size > 0);
  };

  const onWonderPauseChange = (id: string, paused: boolean) => {
    setWonderPausedBuddies((cur) => {
      if (!!cur[id] === paused) return cur;
      const next = { ...cur };
      if (paused) next[id] = true;
      else delete next[id];
      return next;
    });
  };

  const ejectFromGroup = (buddyId: string, groupId: string) => {
    const g = groupsRef.current.find((x) => x.id === groupId);
    if (!g) return;
    const remaining = g.memberIds.filter((m) => m !== buddyId);
    if (remaining.length >= 2) {
      setGroups((cur) => cur.map((x) => (x.id === groupId ? { ...x, memberIds: remaining } : x)));
      setBuddies((cur) => cur.map((b) => (b.id === buddyId ? { ...b, groupId: undefined } : b)));
    } else {
      setGroups((cur) => cur.filter((x) => x.id !== groupId));
      setBuddies((cur) => cur.map((b) =>
        (b.id === buddyId || remaining.includes(b.id)) ? { ...b, groupId: undefined } : b
      ));
    }
  };

  useEffect(() => adapter.onSpawnRequest(() => spawnBuddy()), [adapter]);

  return {
    openSetRef,
    updateBuddy,
    restoreBuddy,
    restoreGroup,
    spawnBuddy,
    removeBuddy,
    onOpenChange,
    onWonderPauseChange,
    ejectFromGroup,
  };
}
