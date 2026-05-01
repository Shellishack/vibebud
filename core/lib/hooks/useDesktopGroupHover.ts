'use client';

import { useEffect } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { ElectronAdapter } from '@/lib/platform/electron';
import type { PlatformAdapter } from '@/lib/platform/types';
import type { AvatarInstanceState } from '../../app/components/avatar/avatar-instance.types';
import { EXPAND_HIT_INSET, HOVER_LEAVE_GRACE_MS } from '../../app/components/dashboard/constants';

type Options = {
  adapter: PlatformAdapter;
  buddiesRef: RefObject<AvatarInstanceState[]>;
  peekedRef: RefObject<Record<string, boolean>>;
  expandedRef: RefObject<Record<string, boolean>>;
  peekedDockRef: RefObject<Record<string, boolean>>;
  setPeeked: Dispatch<SetStateAction<Record<string, boolean>>>;
  setExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
  unpeekDockBuddy: (id: string) => void;
  unpeekDockGroup: (gid: string) => void;
};

export function useDesktopGroupHover({
  adapter,
  buddiesRef,
  peekedRef,
  expandedRef,
  peekedDockRef,
  setPeeked,
  setExpanded,
  unpeekDockBuddy,
  unpeekDockGroup,
}: Options) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (adapter.id !== 'electron' && adapter.id !== 'web') return;
    const electron = adapter.id === 'electron' ? (adapter as ElectronAdapter) : null;
    let interactive = false;
    const setInteractive = (next: boolean) => {
      if (next === interactive) return;
      interactive = next;
      electron?.setInteractive(next);
    };
    type Stage = 'peek' | 'expand';
    const collapseTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const keyOf = (gid: string, stage: Stage) => `${stage}:${gid}`;
    const setStage = (gid: string, stage: Stage, on: boolean) => {
      const setter = stage === 'peek' ? setPeeked : setExpanded;
      setter((cur) => (!!cur[gid] === on ? cur : { ...cur, [gid]: on }));
    };
    const scheduleCollapse = (gid: string, stage: Stage) => {
      const key = keyOf(gid, stage);
      if (collapseTimers.has(key)) return;
      const timer = setTimeout(() => {
        collapseTimers.delete(key);
        const dragging: Set<string> | undefined = (window as { __vibebudDragging?: Set<string> }).__vibebudDragging;
        if (dragging && dragging.size > 0) {
          scheduleCollapse(gid, stage);
          return;
        }
        setStage(gid, stage, false);
      }, HOVER_LEAVE_GRACE_MS);
      collapseTimers.set(key, timer);
    };
    const cancelCollapse = (gid: string, stage: Stage) => {
      const key = keyOf(gid, stage);
      const timer = collapseTimers.get(key);
      if (timer) {
        clearTimeout(timer);
        collapseTimers.delete(key);
      }
    };
    const onMove = (ev: MouseEvent) => {
      const dragging: Set<string> | undefined = (window as { __vibebudDragging?: Set<string> }).__vibebudDragging;
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const interactiveEl = el?.closest('[data-buddy-interactive]');
      setInteractive(!!interactiveEl || (!!dragging && dragging.size > 0));

      const groupEl = el?.closest('[data-group]') as HTMLElement | null;
      let peekGid = groupEl?.getAttribute('data-group') || null;
      let expandGid: string | null = null;
      if (peekGid) {
        const hullEl = document.querySelector(`[data-group="${peekGid}"][data-buddy-interactive]`) as HTMLElement | null;
        if (hullEl) {
          const r = hullEl.getBoundingClientRect();
          if (
            ev.clientX >= r.left + EXPAND_HIT_INSET &&
            ev.clientX <= r.right - EXPAND_HIT_INSET &&
            ev.clientY >= r.top + EXPAND_HIT_INSET &&
            ev.clientY <= r.bottom - EXPAND_HIT_INSET
          ) {
            expandGid = peekGid;
          }
        }
      }

      if (dragging && dragging.size > 0) {
        for (const key of dragging) {
          let gid: string | null = null;
          if (key.startsWith('group:')) gid = key.slice('group:'.length);
          else {
            const b = buddiesRef.current.find((x) => x.id === key);
            if (b?.groupId) gid = b.groupId;
          }
          if (gid) {
            if (!peekGid) peekGid = gid;
            if (!expandGid) expandGid = gid;
            break;
          }
        }
      }

      if (peekGid) {
        cancelCollapse(peekGid, 'peek');
        setStage(peekGid, 'peek', true);
      }
      if (expandGid) {
        cancelCollapse(expandGid, 'expand');
        setStage(expandGid, 'expand', true);
      }
      for (const gid of Object.keys(peekedRef.current)) {
        if (peekedRef.current[gid] && gid !== peekGid) scheduleCollapse(gid, 'peek');
      }
      for (const gid of Object.keys(expandedRef.current)) {
        if (expandedRef.current[gid] && gid !== expandGid) scheduleCollapse(gid, 'expand');
      }

      const dock = peekedDockRef.current;
      if (Object.keys(dock).length > 0) {
        const buddyEl = el?.closest('[data-buddy-avatar]') as HTMLElement | null;
        const overBuddyId = buddyEl?.getAttribute('data-buddy-id') || null;
        const memberEl = el?.closest('[data-buddy-member]') as HTMLElement | null;
        const overMemberGid = memberEl?.getAttribute('data-group') || null;
        const hullEl = el?.closest('[data-group][data-buddy-interactive]') as HTMLElement | null;
        const overHullGid = hullEl?.getAttribute('data-group') || null;
        for (const key of Object.keys(dock)) {
          const sep = key.indexOf(':');
          const kind = key.slice(0, sep);
          const id = key.slice(sep + 1);
          const stillOver = kind === 'buddy'
            ? overBuddyId === id
            : overMemberGid === id || overHullGid === id;
          if (!stillOver) {
            if (kind === 'buddy') unpeekDockBuddy(id);
            else if (kind === 'group') unpeekDockGroup(id);
          }
        }
      }
    };
    document.addEventListener('mousemove', onMove);
    return () => {
      document.removeEventListener('mousemove', onMove);
      for (const timer of collapseTimers.values()) clearTimeout(timer);
    };
  }, [adapter, buddiesRef, expandedRef, peekedDockRef, peekedRef, setExpanded, setPeeked, unpeekDockBuddy, unpeekDockGroup]);
}
