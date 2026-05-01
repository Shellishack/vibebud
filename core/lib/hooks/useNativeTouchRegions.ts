'use client';

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { PlatformAdapter } from '@/lib/platform/types';
import type { Group } from '../../app/components/dashboard/types';

type Options = {
  adapter: PlatformAdapter;
  expanded: Record<string, boolean>;
  peeked: Record<string, boolean>;
  groups: Group[];
  expandedRef: RefObject<Record<string, boolean>>;
  openSetRef: RefObject<Set<string>>;
  onGroupTap: (gid: string) => void;
  onGroupTapCollapse: (gid: string) => void;
  collapseAllGroups: () => void;
};

export function useNativeTouchRegions({
  adapter,
  expanded,
  peeked,
  groups,
  expandedRef,
  openSetRef,
  onGroupTap,
  onGroupTapCollapse,
  collapseAllGroups,
}: Options) {
  const triggerRemeasureRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (adapter.id !== 'capacitor-android') return;
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      if (expandedRef.current[id]) onGroupTapCollapse(id);
      else onGroupTap(id);
    };
    window.addEventListener('vibebud:groupTap', handler);
    return () => window.removeEventListener('vibebud:groupTap', handler);
  }, [adapter, expandedRef, onGroupTap, onGroupTapCollapse]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (adapter.id === 'electron') return;
    const anyOpen = Object.values(expanded).some(Boolean) || Object.values(peeked).some(Boolean);
    if (!anyOpen) return;
    const onDown = (ev: PointerEvent) => {
      const target = ev.target as Element | null;
      if (target && target.closest('[data-buddy-interactive],[data-buddy-avatar],[data-group]')) return;
      collapseAllGroups();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [adapter, expanded, peeked, collapseAllGroups]);

  useEffect(() => {
    const anyPeeked = Object.values(peeked).some(Boolean);
    const anyExpanded = Object.values(expanded).some(Boolean);
    adapter.setOverlayExpanded(openSetRef.current.size > 0);
    adapter.setOverlaySpilledOut?.(anyPeeked || anyExpanded);
  }, [peeked, expanded, adapter, openSetRef]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!adapter.isNative || adapter.id !== 'capacitor-android') return;

    let raf = 0;
    const measure = () => {
      raf = 0;
      const dpr = window.devicePixelRatio || 1;
      const rects: { x: number; y: number; w: number; h: number }[] = [];
      document.querySelectorAll<HTMLElement>('[data-buddy-interactive]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        rects.push({
          x: Math.floor(r.left * dpr),
          y: Math.floor(r.top * dpr),
          w: Math.ceil(r.width * dpr),
          h: Math.ceil(r.height * dpr),
        });
      });
      adapter.publishInteractiveRects(rects);

      const expandedNow = expandedRef.current;
      const memberRectsByGroup = new Map<string, DOMRect[]>();
      document.querySelectorAll<HTMLElement>('[data-buddy-member][data-group]').forEach((member) => {
        const gid = member.getAttribute('data-group');
        if (!gid) return;
        const r = member.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        const arr = memberRectsByGroup.get(gid) ?? [];
        arr.push(r);
        memberRectsByGroup.set(gid, arr);
      });
      const nonExpandedGroupIds = new Set<string>();
      for (const gid of memberRectsByGroup.keys()) {
        if (!expandedNow[gid]) nonExpandedGroupIds.add(gid);
      }

      const avatarRects: { id: string; x: number; y: number; w: number; h: number }[] = [];
      document.querySelectorAll<HTMLElement>('[data-buddy-avatar]').forEach((el) => {
        const id = el.getAttribute('data-buddy-id');
        if (!id) return;
        const memberEl = el.closest<HTMLElement>('[data-buddy-member]');
        const gid = memberEl?.getAttribute('data-group') || null;
        if (gid && nonExpandedGroupIds.has(gid)) return;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        avatarRects.push({
          id,
          x: Math.floor(r.left * dpr),
          y: Math.floor(r.top * dpr),
          w: Math.ceil(r.width * dpr),
          h: Math.ceil(r.height * dpr),
        });
      });
      adapter.publishAvatarRects(avatarRects);

      const groupRects: { id: string; x: number; y: number; w: number; h: number }[] = [];
      const HANDLE_STRIP_CSS = 28;
      document.querySelectorAll<HTMLElement>('[data-group][data-buddy-interactive]').forEach((el) => {
        const id = el.getAttribute('data-group');
        if (!id || !expandedNow[id]) return;
        if (parseFloat(window.getComputedStyle(el).opacity) <= 0.01) return;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        groupRects.push({
          id: `${id}:strip`,
          x: Math.floor(r.left * dpr),
          y: Math.floor(r.top * dpr),
          w: Math.ceil(r.width * dpr),
          h: Math.ceil(Math.min(HANDLE_STRIP_CSS, r.height) * dpr),
        });
      });
      for (const [gid, rectsForGroup] of memberRectsByGroup) {
        if (expandedNow[gid]) continue;
        let l = Infinity, t = Infinity, rgt = -Infinity, btm = -Infinity;
        for (const r of rectsForGroup) {
          if (r.left < l) l = r.left;
          if (r.top < t) t = r.top;
          if (r.right > rgt) rgt = r.right;
          if (r.bottom > btm) btm = r.bottom;
        }
        if (!isFinite(l) || rgt <= l || btm <= t) continue;
        groupRects.push({
          id: `${gid}:cluster`,
          x: Math.floor(l * dpr),
          y: Math.floor(t * dpr),
          w: Math.ceil((rgt - l) * dpr),
          h: Math.ceil((btm - t) * dpr),
        });
      }
      adapter.publishGroupRects(groupRects);
    };

    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(measure);
    };
    triggerRemeasureRef.current = schedule;
    schedule();

    const ro = new ResizeObserver(schedule);
    ro.observe(document.documentElement);
    document.querySelectorAll<HTMLElement>('[data-buddy-interactive]').forEach((el) => ro.observe(el));
    const mo = new MutationObserver(() => {
      document.querySelectorAll<HTMLElement>('[data-buddy-interactive]').forEach((el) => ro.observe(el));
      schedule();
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);

    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      if (raf) cancelAnimationFrame(raf);
      triggerRemeasureRef.current = null;
      adapter.publishInteractiveRects([]);
      adapter.publishAvatarRects([]);
      adapter.publishGroupRects([]);
    };
  }, [adapter, expandedRef]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (adapter.id !== 'capacitor-android') return;
    const trigger = () => triggerRemeasureRef.current?.();
    const timers = [80, 200, 380, 560].map((ms) => setTimeout(trigger, ms));
    return () => { for (const timer of timers) clearTimeout(timer); };
  }, [adapter, expanded, peeked, groups]);
}
