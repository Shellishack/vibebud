'use client';

import { useEffect, useRef, useState } from 'react';
import BuddyInstance, { type BuddyInstanceState } from './BuddyInstance';
import BuddyGroup from './BuddyGroup';
import { nextUnusedPersonality } from './personalities';

const STORAGE_KEY = 'vibemoji.buddies.v2';

const AVATAR_SIZE = 112;
const HULL_PAD_X = 10;
const HULL_PAD_TOP = 22;
const HULL_PAD_BOTTOM = 8;
const COLLAPSED_STRIDE = 28;
const EXPANDED_STRIDE = 132;
const MERGE_RADIUS = 90;
const EJECT_RADIUS = 180;
const HOVER_LEAVE_GRACE_MS = 250;
const ANCHOR = { right: 24, bottom: 24 };

type Group = { id: string; memberIds: string[]; pos: { x: number; y: number } };
type Persisted = { buddies: BuddyInstanceState[]; groups: Group[] };

const initialBuddies = (): BuddyInstanceState[] => [
  { id: 'buddy-1', variantId: 'violet', pos: { x: 0, y: 0 }, messages: [] },
];

function loadFromStorage(): Persisted | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.buddies) && parsed.buddies.length > 0) {
      return { buddies: parsed.buddies, groups: Array.isArray(parsed.groups) ? parsed.groups : [] };
    }
  } catch { /* noop */ }
  return null;
}

const slotPos = (group: Group, index: number, stride: number) => ({
  x: group.pos.x + index * stride,
  y: group.pos.y,
});

export default function Buddy() {
  const [buddies, setBuddies] = useState<BuddyInstanceState[]>(initialBuddies);
  const [groups, setGroups] = useState<Group[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const idRef = useRef(2);
  const groupIdRef = useRef(1);
  const hydratedRef = useRef(false);

  const buddiesRef = useRef(buddies);
  const groupsRef = useRef(groups);
  const expandedRef = useRef(expanded);
  useEffect(() => { buddiesRef.current = buddies; }, [buddies]);
  useEffect(() => { groupsRef.current = groups; }, [groups]);
  useEffect(() => { expandedRef.current = expanded; }, [expanded]);

  useEffect(() => {
    const stored = loadFromStorage();
    if (stored) {
      setBuddies(stored.buddies);
      setGroups(stored.groups);
      const maxN = stored.buddies.reduce((m, b) => {
        const n = parseInt(b.id.replace(/^buddy-/, ''), 10);
        return Number.isFinite(n) ? Math.max(m, n) : m;
      }, 0);
      idRef.current = maxN + 1;
      const maxG = stored.groups.reduce((m, g) => {
        const n = parseInt(g.id.replace(/^group-/, ''), 10);
        return Number.isFinite(n) ? Math.max(m, n) : m;
      }, 0);
      groupIdRef.current = maxG + 1;
    }
    hydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ buddies, groups }));
    } catch { /* noop */ }
  }, [buddies, groups]);

  // Sync grouped member positions to their slots whenever group/expanded state
  // changes — except for buddies currently being dragged (their drag owns pos).
  useEffect(() => {
    setBuddies((cur) => {
      const dragging: Set<string> | undefined = (window as any).__vibemojiDragging;
      let changed = false;
      const next = cur.map((b) => {
        if (!b.groupId) return b;
        const g = groups.find((x) => x.id === b.groupId);
        if (!g) return b;
        const i = g.memberIds.indexOf(b.id);
        if (i < 0) return b;
        const stride = expanded[g.id] ? EXPANDED_STRIDE : COLLAPSED_STRIDE;
        const target = slotPos(g, i, stride);
        if (dragging?.has(b.id)) return b;
        if (b.pos.x === target.x && b.pos.y === target.y) return b;
        changed = true;
        return { ...b, pos: target };
      });
      return changed ? next : cur;
    });
  }, [groups, expanded]);

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const v = (window as any).vibemoji;
    let interactive = false;
    const setInteractive = (next: boolean) => {
      if (next === interactive) return;
      interactive = next;
      v?.setInteractive?.(next);
    };
    const collapseTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const scheduleCollapse = (gid: string) => {
      if (collapseTimers.has(gid)) return;
      const t = setTimeout(() => {
        collapseTimers.delete(gid);
        const dragging: Set<string> | undefined = (window as any).__vibemojiDragging;
        if (dragging && dragging.size > 0) {
          // Defer collapse while anything is being dragged.
          scheduleCollapse(gid);
          return;
        }
        setExpanded((cur) => (cur[gid] ? { ...cur, [gid]: false } : cur));
      }, HOVER_LEAVE_GRACE_MS);
      collapseTimers.set(gid, t);
    };
    const cancelCollapse = (gid: string) => {
      const t = collapseTimers.get(gid);
      if (t) { clearTimeout(t); collapseTimers.delete(gid); }
    };
    const onMove = (ev: MouseEvent) => {
      const dragging: Set<string> | undefined = (window as any).__vibemojiDragging;
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const interactiveEl = el?.closest('[data-buddy-interactive]');
      setInteractive(!!interactiveEl || (!!dragging && dragging.size > 0));

      const groupEl = el?.closest('[data-group]') as HTMLElement | null;
      const hoverGid = groupEl?.getAttribute('data-group') || null;
      if (hoverGid) {
        cancelCollapse(hoverGid);
        setExpanded((cur) => (cur[hoverGid] ? cur : { ...cur, [hoverGid]: true }));
      }
      // Schedule collapse for any expanded group not currently hovered.
      const exp = expandedRef.current;
      for (const gid of Object.keys(exp)) {
        if (exp[gid] && gid !== hoverGid) scheduleCollapse(gid);
      }
    };
    document.addEventListener('mousemove', onMove);
    return () => {
      document.removeEventListener('mousemove', onMove);
      for (const t of collapseTimers.values()) clearTimeout(t);
    };
  }, []);

  const removeBuddy = (id: string) => {
    setBuddies((cur) => {
      if (cur.length <= 1) return cur;
      return cur.filter((b) => b.id !== id);
    });
    setGroups((cur) => {
      const updated = cur
        .map((g) => ({ ...g, memberIds: g.memberIds.filter((m) => m !== id) }))
        .filter((g) => g.memberIds.length >= 2);
      // Clear groupId for any buddies whose group dissolved.
      const surviving = new Set(updated.map((g) => g.id));
      setBuddies((bs) => bs.map((b) => (b.groupId && !surviving.has(b.groupId) ? { ...b, groupId: undefined } : b)));
      return updated;
    });
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

  // Eject a member from its group; dissolve group if it would have <2 members.
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

  const onDragMove = (id: string, pos: { x: number; y: number }) => {
    const b = buddiesRef.current.find((x) => x.id === id);
    if (!b?.groupId) return;
    const g = groupsRef.current.find((x) => x.id === b.groupId);
    if (!g) return;
    const i = g.memberIds.indexOf(id);
    if (i < 0) return;
    const stride = expandedRef.current[g.id] ? EXPANDED_STRIDE : COLLAPSED_STRIDE;
    const slot = slotPos(g, i, stride);
    const dx = pos.x - slot.x;
    const dy = pos.y - slot.y;
    if (Math.hypot(dx, dy) > EJECT_RADIUS) {
      ejectFromGroup(id, g.id);
    }
  };

  const onDragEnd = (id: string, pos: { x: number; y: number }, moved: boolean) => {
    if (!moved) return;
    const b = buddiesRef.current.find((x) => x.id === id);
    if (!b) return;
    if (b.groupId) {
      const g = groupsRef.current.find((x) => x.id === b.groupId);
      if (!g) return;
      const i = g.memberIds.indexOf(id);
      if (i < 0) return;
      const stride = expandedRef.current[g.id] ? EXPANDED_STRIDE : COLLAPSED_STRIDE;
      const target = slotPos(g, i, stride);
      setBuddies((cur) => cur.map((x) => (x.id === id ? { ...x, pos: target } : x)));
      return;
    }
    let bestG: Group | null = null;
    let bestDG = MERGE_RADIUS;
    for (const g of groupsRef.current) {
      const d = Math.hypot(g.pos.x - pos.x, g.pos.y - pos.y);
      if (d < bestDG) { bestDG = d; bestG = g; }
    }
    if (bestG) {
      const g = bestG;
      setGroups((cur) => cur.map((x) => (x.id === g.id ? { ...x, memberIds: [...x.memberIds, id] } : x)));
      setBuddies((cur) => cur.map((x) => (x.id === id ? { ...x, groupId: g.id } : x)));
      return;
    }
    let bestB: BuddyInstanceState | null = null;
    let bestDB = MERGE_RADIUS;
    for (const other of buddiesRef.current) {
      if (other.id === id || other.groupId) continue;
      const d = Math.hypot(other.pos.x - pos.x, other.pos.y - pos.y);
      if (d < bestDB) { bestDB = d; bestB = other; }
    }
    if (bestB) {
      const target = bestB;
      const newGroupId = `group-${groupIdRef.current++}`;
      setGroups((cur) => [...cur, { id: newGroupId, memberIds: [target.id, id], pos: target.pos }]);
      setBuddies((cur) => cur.map((x) => (
        x.id === target.id || x.id === id ? { ...x, groupId: newGroupId } : x
      )));
    }
  };

  const onGroupDragMove = (gid: string, pos: { x: number; y: number }) => {
    setGroups((cur) => cur.map((g) => (g.id === gid ? { ...g, pos } : g)));
  };

  const renderBuddy = (b: BuddyInstanceState) => (
    <BuddyInstance
      key={b.id}
      state={b}
      anchor={ANCHOR}
      canRemove={buddies.length > 1}
      onChange={(next) => updateBuddy(b.id, next)}
      onSpawn={spawnBuddy}
      onRemove={() => removeBuddy(b.id)}
      onOpenChange={onOpenChange}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
    />
  );

  return (
    <>
      {/* Hulls render BEHIND members (lower z-index). Members are always at
          the top level so they aren't unmounted/remounted when joining or
          leaving a group. */}
      {groups.map((g) => {
        const stride = expanded[g.id] ? EXPANDED_STRIDE : COLLAPSED_STRIDE;
        const memberCount = g.memberIds.filter((mid) => buddies.some((b) => b.id === mid)).length;
        if (memberCount < 2) return null;
        return (
          <BuddyGroup
            key={g.id}
            groupId={g.id}
            pos={g.pos}
            memberCount={memberCount}
            stride={stride}
            avatarSize={AVATAR_SIZE}
            padX={HULL_PAD_X}
            padTop={HULL_PAD_TOP}
            padBottom={HULL_PAD_BOTTOM}
            anchor={ANCHOR}
            visible={!!expanded[g.id]}
            onGroupDragMove={onGroupDragMove}
          />
        );
      })}

      {buddies.map(renderBuddy)}

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
