'use client';

import { useEffect, useRef, useState } from 'react';
import BuddyInstance, { type BuddyInstanceState } from './BuddyInstance';
import BuddyGroup from './BuddyGroup';
import { VARIANTS } from './avatars';
import { nextUnusedPersonality } from './personalities';

// Lighten each avatar color toward white so the hull reads as a pastel
// backdrop and the saturated avatars pop against it.
const HULL_LIGHTEN = 0.55;
const HULL_ALPHA = 0.85;

const rgba = (rgb: [number, number, number], a: number, lighten = 0) => {
  const mix = (c: number) => c + (1 - c) * lighten;
  return `rgba(${Math.round(mix(rgb[0]) * 255)}, ${Math.round(mix(rgb[1]) * 255)}, ${Math.round(mix(rgb[2]) * 255)}, ${a})`;
};

const gradientFor = (variantIds: string[]) => {
  const stops = variantIds.map((vid) => VARIANTS.find((v) => v.id === vid)?.body ?? VARIANTS[0].body);
  if (stops.length === 1) {
    const c = rgba(stops[0], HULL_ALPHA, HULL_LIGHTEN);
    return `linear-gradient(90deg, ${c}, ${c})`;
  }
  const parts = stops.map((c, i) => `${rgba(c, HULL_ALPHA, HULL_LIGHTEN)} ${(i / (stops.length - 1)) * 100}%`);
  return `linear-gradient(90deg, ${parts.join(', ')})`;
};

const STORAGE_KEY = 'vibemoji.buddies.v2';

const AVATAR_SIZE = 112;
const HULL_PAD_X = 10;
const HULL_PAD_TOP = 22;
const HULL_PAD_BOTTOM = 8;
const COLLAPSED_STRIDE = 28;
const EXPANDED_STRIDE = 132;
// Inner hit-box for expand: the hull rect inset by this many px on every side.
// Larger inset = thicker peek-only buffer ring around the hull edge.
const EXPAND_HIT_INSET = 48;
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
  const [peeked, setPeeked] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [magnet, setMagnet] = useState<{ draggedId: string; targetId: string; targetType: 'buddy' | 'group' } | null>(null);
  const idRef = useRef(2);
  const groupIdRef = useRef(1);
  const hydratedRef = useRef(false);

  const buddiesRef = useRef(buddies);
  const groupsRef = useRef(groups);
  const expandedRef = useRef(expanded);
  const peekedRef = useRef(peeked);
  useEffect(() => { buddiesRef.current = buddies; }, [buddies]);
  useEffect(() => { groupsRef.current = groups; }, [groups]);
  useEffect(() => { expandedRef.current = expanded; }, [expanded]);
  useEffect(() => { peekedRef.current = peeked; }, [peeked]);

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
    type Stage = 'peek' | 'expand';
    const collapseTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const keyOf = (gid: string, stage: Stage) => `${stage}:${gid}`;
    const setStage = (gid: string, stage: Stage, on: boolean) => {
      const setter = stage === 'peek' ? setPeeked : setExpanded;
      setter((cur) => (!!cur[gid] === on ? cur : { ...cur, [gid]: on }));
    };
    const scheduleCollapse = (gid: string, stage: Stage) => {
      const k = keyOf(gid, stage);
      if (collapseTimers.has(k)) return;
      const t = setTimeout(() => {
        collapseTimers.delete(k);
        const dragging: Set<string> | undefined = (window as any).__vibemojiDragging;
        if (dragging && dragging.size > 0) {
          scheduleCollapse(gid, stage);
          return;
        }
        setStage(gid, stage, false);
      }, HOVER_LEAVE_GRACE_MS);
      collapseTimers.set(k, t);
    };
    const cancelCollapse = (gid: string, stage: Stage) => {
      const k = keyOf(gid, stage);
      const t = collapseTimers.get(k);
      if (t) { clearTimeout(t); collapseTimers.delete(k); }
    };
    const onMove = (ev: MouseEvent) => {
      const dragging: Set<string> | undefined = (window as any).__vibemojiDragging;
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const interactiveEl = el?.closest('[data-buddy-interactive]');
      setInteractive(!!interactiveEl || (!!dragging && dragging.size > 0));

      // The element under the cursor tells us two things:
      //   - data-group on it (or an ancestor) → cursor is over the hull region.
      //   - data-buddy-member ancestor with data-group → cursor is over an
      //     actual member avatar of that group → expand stage.
      const groupEl = el?.closest('[data-group]') as HTMLElement | null;
      let peekGid = groupEl?.getAttribute('data-group') || null;
      let expandGid: string | null = null;
      // Expand only while cursor is inside the hull rect inset by
      // EXPAND_HIT_INSET on every side. Outer ring acts as a peek-only buffer.
      if (peekGid) {
        const hullEl = document.querySelector(
          `[data-group="${peekGid}"][data-buddy-interactive]`
        ) as HTMLElement | null;
        if (hullEl) {
          const r = hullEl.getBoundingClientRect();
          const inset = EXPAND_HIT_INSET;
          if (
            ev.clientX >= r.left + inset &&
            ev.clientX <= r.right - inset &&
            ev.clientY >= r.top + inset &&
            ev.clientY <= r.bottom - inset
          ) {
            expandGid = peekGid;
          }
        }
      }

      // While dragging, keep the dragged buddy's group both peeked and expanded.
      if (dragging && dragging.size > 0) {
        for (const k of dragging) {
          let gid: string | null = null;
          if (k.startsWith('group:')) gid = k.slice('group:'.length);
          else {
            const b = buddiesRef.current.find((x) => x.id === k);
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
    if (!b) return;
    if (b.groupId) {
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
      return;
    }
    // Free buddy: compute magnet target preview.
    let bestId: string | null = null;
    let bestType: 'buddy' | 'group' = 'buddy';
    let bestD = MERGE_RADIUS;
    for (const g of groupsRef.current) {
      const d = Math.hypot(g.pos.x - pos.x, g.pos.y - pos.y);
      if (d < bestD) { bestD = d; bestId = g.id; bestType = 'group'; }
    }
    for (const other of buddiesRef.current) {
      if (other.id === id || other.groupId) continue;
      const d = Math.hypot(other.pos.x - pos.x, other.pos.y - pos.y);
      if (d < bestD) { bestD = d; bestId = other.id; bestType = 'buddy'; }
    }
    setMagnet((cur) => {
      if (!bestId) return cur ? null : cur;
      if (cur && cur.draggedId === id && cur.targetId === bestId && cur.targetType === bestType) return cur;
      return { draggedId: id, targetId: bestId, targetType: bestType };
    });
  };

  const onDragEnd = (id: string, pos: { x: number; y: number }, moved: boolean) => {
    setMagnet(null);
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

  const renderBuddy = (b: BuddyInstanceState) => {
    let magnetState: 'attractor' | 'target' | null = null;
    if (magnet) {
      if (magnet.draggedId === b.id) magnetState = 'attractor';
      else if (magnet.targetType === 'buddy' && magnet.targetId === b.id) magnetState = 'target';
    }
    return (
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
        magnetState={magnetState}
      />
    );
  };

  return (
    <>
      {/* Hulls render BEHIND members (lower z-index). Members are always at
          the top level so they aren't unmounted/remounted when joining or
          leaving a group. */}
      {groups.map((g) => {
        const stride = expanded[g.id] ? EXPANDED_STRIDE : COLLAPSED_STRIDE;
        const memberVariantIds = g.memberIds
          .map((mid) => buddies.find((b) => b.id === mid)?.variantId)
          .filter((v): v is string => !!v);
        if (memberVariantIds.length < 2) return null;
        return (
          <BuddyGroup
            key={g.id}
            groupId={g.id}
            pos={g.pos}
            memberCount={memberVariantIds.length}
            stride={stride}
            avatarSize={AVATAR_SIZE}
            padX={HULL_PAD_X}
            padTop={HULL_PAD_TOP}
            padBottom={HULL_PAD_BOTTOM}
            anchor={ANCHOR}
            visible={!!peeked[g.id] || !!expanded[g.id]}
            magnetActive={magnet?.targetType === 'group' && magnet.targetId === g.id}
            background={gradientFor(memberVariantIds)}
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
        @keyframes buddy-magnet-pulse {
          0%, 100% { transform: scale(1); opacity: 0.85; }
          50% { transform: scale(1.06); opacity: 1; }
        }
        @keyframes buddy-magnet-ping {
          0% { transform: scale(1); opacity: 0.7; }
          100% { transform: scale(1.45); opacity: 0; }
        }
      `}</style>
    </>
  );
}
