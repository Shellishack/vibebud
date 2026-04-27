'use client';

import { useEffect, useRef, useState } from 'react';
import BuddyInstance, { type BuddyInstanceState } from './BuddyInstance';
import BuddyGroup from './BuddyGroup';
import AppSettings from './AppSettings';
import { VARIANTS } from './avatars';
import { nextUnusedPersonality, PERSONALITY_BY_VARIANT, getPersonality } from './personalities';
import type { Teammate } from './llm';
import { usePlatform } from './hooks/usePlatform';
import { isMobile } from '@/lib/platform/detect';
import type { ElectronAdapter } from '@/lib/platform/electron';

// Lighten each avatar color toward white so the hull reads as a pastel
// backdrop and the saturated avatars pop against it.
const HULL_LIGHTEN = 0.55;
const HULL_ALPHA = 0.85;

const rgba = (rgb: [number, number, number], a: number, lighten = 0) => {
  const mix = (c: number) => c + (1 - c) * lighten;
  return `rgba(${Math.round(mix(rgb[0]) * 255)}, ${Math.round(mix(rgb[1]) * 255)}, ${Math.round(mix(rgb[2]) * 255)}, ${a})`;
};

const gradientFor = (variantIds: string[]) => {
  // variantIds may include custom-personality ids; route through getPersonality
  // so we land on the correct color variant in either case.
  const stops = variantIds.map((vid) => {
    const colorId = getPersonality(vid).colorId;
    return VARIANTS.find((v) => v.id === colorId)?.body ?? VARIANTS[0].body;
  });
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
const EXPANDED_STRIDE = 96;
// Inner hit-box for expand: the hull rect inset by this many px on every side.
// Larger inset = thicker peek-only buffer ring around the hull edge.
const EXPAND_HIT_INSET = 48;
const MERGE_RADIUS = 90;
// Eject thresholds. Members are laid out horizontally, so a vertical pull is
// the clearest "I want to leave the group" signal — trigger on a smaller dy
// than dx. The horizontal threshold is kept under one full EXPANDED_STRIDE
// so the user doesn't have to drag past a neighbor's slot before escaping.
const EJECT_DY = 36;
const EJECT_DX = 80;
const HOVER_LEAVE_GRACE_MS = 250;
// Anchor offset from screen corner. Tighter on mobile/capacitor so the
// floating buddy hugs the corner — there's far less screen real estate to
// burn on whitespace than on desktop.
const ANCHOR = (() => {
  const pad = typeof window !== 'undefined' && isMobile() ? 12 : 24;
  return { right: pad, bottom: pad };
})();

// --- Minimize-to-edge ---
// Drag-end edge proximity (px) below which a buddy/group snaps to the edge.
// Generous so the snap feels reliable; the live edge-magnet cue (see
// edgeMagnetRef wiring) shows the user when they're in the snap zone.
const SNAP_THRESHOLD = (typeof window !== 'undefined' && isMobile()) ? 12 : 64;
// Tight inter-member stride used while a group is minimized — members read
// as a stack (vs. COLLAPSED_STRIDE 28).
const STACK_STRIDE = 6;

export type Edge = 'left' | 'right' | 'top' | 'bottom';
export type EdgeDock = { edge: Edge };

const isHorizontalEdge = (e: Edge) => e === 'left' || e === 'right';

// Read the actually-visible viewport (excludes IME / system bars).
const viewportSize = () => {
  if (typeof window === 'undefined') return { w: 0, h: 0 };
  const vv = window.visualViewport;
  return { w: vv?.width ?? window.innerWidth, h: vv?.height ?? window.innerHeight };
};

// Given a buddy's current pos translate, return the closest edge (in CSS px
// distance from the bbox to the screen edge) and that distance. Used by the
// drag-end snap detection.
const nearestEdgeForBuddy = (pos: { x: number; y: number }) => {
  const { w, h } = viewportSize();
  // Bbox sides relative to the (right:ANCHOR.right, bottom:ANCHOR.bottom) anchor.
  const right  = ANCHOR.right - pos.x;                       // gap to right edge
  const left   = w - ANCHOR.right - AVATAR_SIZE + pos.x;      // gap to left edge (>=0 when on screen)
  const bottom = ANCHOR.bottom - pos.y;                       // gap to bottom edge
  const top    = h - ANCHOR.bottom - AVATAR_SIZE + pos.y;     // gap to top edge
  const dists: Array<{ edge: Edge; d: number }> = [
    { edge: 'left',   d: left },
    { edge: 'right',  d: right },
    { edge: 'top',    d: top },
    { edge: 'bottom', d: bottom },
  ];
  dists.sort((a, b) => a.d - b.d);
  return dists[0];
};

// Position a single buddy so its CENTER sits exactly on the chosen edge —
// half visible, half off-screen. The bbox is positioned with right:ANCHOR.right
// (so untranslated box.right = viewport - ANCHOR.right) and translated by pos.
// Derivation per edge:
//   left:   want box.left   = -half  → pos.x = -half - (viewport - ANCHOR.right - AVATAR_SIZE)
//   right:  want box.right  =  viewport + half → pos.x =  ANCHOR.right + half
//   top:    want box.top    = -half  → pos.y = -half - (viewport - ANCHOR.bottom - AVATAR_SIZE)
//   bottom: want box.bottom =  viewport + half → pos.y =  ANCHOR.bottom + half
const minimizedBuddyPos = (edge: Edge, lastFree?: { x: number; y: number }) => {
  const { w, h } = viewportSize();
  const half = AVATAR_SIZE / 2;
  switch (edge) {
    case 'left':   return { x: ANCHOR.right + AVATAR_SIZE - w - half, y: lastFree?.y ?? 0 };
    case 'right':  return { x: ANCHOR.right + half,                    y: lastFree?.y ?? 0 };
    case 'top':    return { x: lastFree?.x ?? 0, y: ANCHOR.bottom + AVATAR_SIZE - h - half };
    case 'bottom': return { x: lastFree?.x ?? 0, y: ANCHOR.bottom + half };
  }
};

// Distance from each edge for a group's bbox (group-extent depends on
// stride and member count and orientation).
const nearestEdgeForGroup = (pos: { x: number; y: number }, memberCount: number) => {
  const { w, h } = viewportSize();
  // Members spread to the RIGHT of pos.x at COLLAPSED_STRIDE in the
  // non-minimized rendered state; that's also the bbox the user sees when
  // dropping. Width = (N-1)*stride + AVATAR_SIZE.
  const groupW = (memberCount - 1) * COLLAPSED_STRIDE + AVATAR_SIZE;
  const groupH = AVATAR_SIZE;
  // Leftmost member translate.x = pos.x; rightmost = pos.x + (N-1)*stride.
  const rightmost = pos.x + (memberCount - 1) * COLLAPSED_STRIDE;
  const right  = ANCHOR.right - rightmost;
  const left   = w - ANCHOR.right - AVATAR_SIZE + pos.x;
  const bottom = ANCHOR.bottom - pos.y;
  const top    = h - ANCHOR.bottom - groupH + pos.y;
  const dists: Array<{ edge: Edge; d: number }> = [
    { edge: 'left',   d: left },
    { edge: 'right',  d: right },
    { edge: 'top',    d: top },
    { edge: 'bottom', d: bottom },
  ];
  dists.sort((a, b) => a.d - b.d);
  return { ...dists[0], groupW, groupH };
};

// Peeked-out position for a single buddy: the avatar pops fully into view at
// the docking edge (touching the edge with the same negative-pad gap as the
// normal clamp), still semantically minimized. lastFreePos's perpendicular
// axis is preserved so the avatar pops out where it was last seen along the
// edge.
const peekedBuddyPos = (edge: Edge, lastFree?: { x: number; y: number }) => {
  const { w, h } = viewportSize();
  const PAD = -16;
  switch (edge) {
    case 'left':   return { x: -(w - ANCHOR.right - AVATAR_SIZE - PAD), y: lastFree?.y ?? 0 };
    case 'right':  return { x: ANCHOR.right - PAD, y: lastFree?.y ?? 0 };
    case 'top':    return { x: lastFree?.x ?? 0, y: -(h - ANCHOR.bottom - AVATAR_SIZE - PAD) };
    case 'bottom': return { x: lastFree?.x ?? 0, y: ANCHOR.bottom - PAD };
  }
};

// Peeked-out position for a group: the whole stack pops fully into view at
// the docking edge using COLLAPSED_STRIDE (so the user sees a normal-looking
// group), still semantically minimized.
// stride lets the right-edge dock keep the rightmost member anchored to the
// edge regardless of whether the group is currently collapsed or expanded —
// expansion grows leftward into the screen instead of off the right edge.
const peekedGroupPos = (edge: Edge, n: number, lastFree: { x: number; y: number } | undefined, stride: number = COLLAPSED_STRIDE) => {
  const { w, h } = viewportSize();
  const EDGE_GAP = -16;
  switch (edge) {
    case 'left':   return { x: -(w - ANCHOR.right - AVATAR_SIZE - EDGE_GAP), y: lastFree?.y ?? 0 };
    case 'right':  return { x: (ANCHOR.right - EDGE_GAP) - (n - 1) * stride, y: lastFree?.y ?? 0 };
    case 'top':    return { x: lastFree?.x ?? 0, y: -(h - ANCHOR.bottom - AVATAR_SIZE - EDGE_GAP) };
    case 'bottom': return { x: lastFree?.x ?? 0, y: ANCHOR.bottom - EDGE_GAP };
  }
};

// Position a group so the CENTER of its (always-horizontal V1) stack lies
// half-on, half-off the chosen edge. Same sign conventions as minimizedBuddyPos.
const minimizedGroupPos = (edge: Edge, memberCount: number, lastFree?: { x: number; y: number }) => {
  const { w, h } = viewportSize();
  const half = AVATAR_SIZE / 2;
  switch (edge) {
    case 'left':
      // Leftmost member's box.left = -half.
      return { x: ANCHOR.right + AVATAR_SIZE - w - half, y: lastFree?.y ?? 0 };
    case 'right':
      // Rightmost member's box.right = viewport + half. Rightmost member
      // translate = pos.x + (N-1)*STACK_STRIDE; want it = ANCHOR.right + half.
      return { x: ANCHOR.right + half - (memberCount - 1) * STACK_STRIDE, y: lastFree?.y ?? 0 };
    case 'top':
      return { x: lastFree?.x ?? 0, y: ANCHOR.bottom + AVATAR_SIZE - h - half };
    case 'bottom':
      return { x: lastFree?.x ?? 0, y: ANCHOR.bottom + half };
  }
};

type Group = {
  id: string;
  memberIds: string[];
  pos: { x: number; y: number };
  minimized?: EdgeDock;
  lastFreePos?: { x: number; y: number };
};
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

// Clamp a candidate group origin so that the rightmost member at expanded
// stride still fits on-screen and the hull renders inside the viewport.
// The hull right-CSS = anchor.right - HULL_PAD_X - (pos.x + (N-1)*stride),
// so we need pos.x + (N-1)*EXPANDED_STRIDE <= anchor.right - HULL_PAD_X.
// Clamp a single buddy's drag/spawn offset so the avatar stays fully on
// screen. pos is the translate applied on top of (right: ANCHOR.right,
// bottom: ANCHOR.bottom). Positive x moves right, positive y moves down.
//
// Prefer visualViewport over innerWidth/innerHeight — on Android WebView
// (especially when the overlay extends behind status/nav bars under
// FLAG_LAYOUT_NO_LIMITS), innerWidth/Height can report the full window
// including system-bar areas that aren't visually usable. visualViewport
// reflects the actually-visible area, including IME state.
const clampBuddyPos = (candidate: { x: number; y: number }) => {
  if (typeof window === 'undefined') return candidate;
  const vv = window.visualViewport;
  const viewportW = vv?.width ?? window.innerWidth;
  const viewportH = vv?.height ?? window.innerHeight;
  // Extra safety pad (status bar / nav bar / rounded corners on some devices).
  // Negative pad: the Lottie SVG has ~16px of transparent padding inside
  // the 112px button bbox (the body ellipse is centered with empty space
  // around it). Letting the button extend past the screen edge lets the
  // *visible* avatar art touch the edge instead of the invisible bbox.
  const PAD = -16;
  const minX = -(viewportW - ANCHOR.right - AVATAR_SIZE - PAD);
  const maxX = ANCHOR.right - PAD;
  const minY = -(viewportH - ANCHOR.bottom - AVATAR_SIZE - PAD);
  const maxY = ANCHOR.bottom - PAD;
  return {
    x: Math.min(maxX, Math.max(minX, candidate.x)),
    y: Math.min(maxY, Math.max(minY, candidate.y)),
  };
};

const clampGroupPos = (
  candidate: { x: number; y: number },
  memberCount: number,
  stride: number = COLLAPSED_STRIDE,
) => {
  if (typeof window === 'undefined') return candidate;
  const viewportW = window.innerWidth;
  // Edge gap (distance from screen edge to nearest avatar edge). Same on
  // both sides so the group's clamp window is symmetric.
  // Same negative-gap reasoning as clampBuddyPos: the Lottie has internal
  // padding inside each member's 112px bbox.
  const EDGE_GAP = -16;
  // Leftmost member's left edge sits at viewport_w - anchor.right - avatar + pos.x.
  // Clamp so that left edge >= EDGE_GAP.
  const minX = -(viewportW - ANCHOR.right - AVATAR_SIZE - EDGE_GAP);
  // Rightmost member's right edge sits at viewport_w - anchor.right + (pos.x + (N-1)*stride).
  // Clamp so that right edge <= viewport_w - EDGE_GAP, i.e.
  //   pos.x + (N-1)*stride <= anchor.right - EDGE_GAP.
  // Stride defaults to COLLAPSED so the user's normal (non-expanded) view
  // gets symmetric gaps; the brief expanded view may spill past the right,
  // which the overlay-spillout mechanism already handles.
  const maxXRaw = (ANCHOR.right - EDGE_GAP) - (memberCount - 1) * stride;
  const maxX = Math.max(minX, maxXRaw);
  const x = Math.min(maxX, Math.max(minX, candidate.x));
  // Y: keep at most a reasonable distance from the bottom anchor.
  const viewportH = window.innerHeight;
  const minY = -(viewportH - ANCHOR.bottom - AVATAR_SIZE - HULL_PAD_TOP - 8);
  const maxY = 0;
  const y = Math.min(maxY, Math.max(minY, candidate.y));
  return { x, y };
};

export default function Buddy() {
  const adapter = usePlatform();
  const [buddies, setBuddies] = useState<BuddyInstanceState[]>(initialBuddies);
  const [groups, setGroups] = useState<Group[]>([]);
  const [peeked, setPeeked] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [magnet, setMagnet] = useState<{ draggedId: string; targetId: string; targetType: 'buddy' | 'group' } | null>(null);
  // Live edge-magnet cue: which buddy/group is currently within the
  // SNAP_THRESHOLD of which edge (set during drag, cleared on drag end).
  // Renderers show a glow/scale to signal the snap zone.
  const [edgeMagnet, setEdgeMagnet] = useState<{ kind: 'buddy' | 'group'; id: string; edge: Edge } | null>(null);
  // Hover-driven peek-out for minimized buddies/groups. Keys are
  // `buddy:<id>` / `group:<id>`. While set, the renderer uses peekedXxxPos
  // (fully visible at the edge) but the underlying state.minimized stays
  // set — releasing without a drag re-docks; starting a drag commits.
  const [peekedDock, setPeekedDock] = useState<Record<string, boolean>>({});
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const idRef = useRef(2);
  const groupIdRef = useRef(1);
  const hydratedRef = useRef(false);

  const buddiesRef = useRef(buddies);
  const groupsRef = useRef(groups);
  const expandedRef = useRef(expanded);
  const peekedRef = useRef(peeked);
  const peekedDockRef = useRef(peekedDock);
  useEffect(() => { buddiesRef.current = buddies; }, [buddies]);
  useEffect(() => { groupsRef.current = groups; }, [groups]);
  useEffect(() => { expandedRef.current = expanded; }, [expanded]);
  useEffect(() => { peekedRef.current = peeked; }, [peeked]);
  useEffect(() => { peekedDockRef.current = peekedDock; }, [peekedDock]);

  const peekDockBuddy = (id: string) => {
    const b = buddiesRef.current.find((x) => x.id === id);
    if (!b?.minimized) return;
    setPeekedDock((cur) => (cur[`buddy:${id}`] ? cur : { ...cur, [`buddy:${id}`]: true }));
  };
  const unpeekDockBuddy = (id: string) => {
    const dragging: Set<string> | undefined = (window as { __vibemojiDragging?: Set<string> }).__vibemojiDragging;
    if (dragging?.has(id)) return;
    setPeekedDock((cur) => {
      if (!cur[`buddy:${id}`]) return cur;
      const next = { ...cur };
      delete next[`buddy:${id}`];
      return next;
    });
  };
  const peekDockGroup = (gid: string) => {
    const g = groupsRef.current.find((x) => x.id === gid);
    if (!g?.minimized) return;
    setPeekedDock((cur) => (cur[`group:${gid}`] ? cur : { ...cur, [`group:${gid}`]: true }));
  };
  const unpeekDockGroup = (gid: string) => {
    const dragging: Set<string> | undefined = (window as { __vibemojiDragging?: Set<string> }).__vibemojiDragging;
    if (dragging?.has(`group:${gid}`)) return;
    setPeekedDock((cur) => {
      if (!cur[`group:${gid}`]) return cur;
      const next = { ...cur };
      delete next[`group:${gid}`];
      return next;
    });
  };

  // Mobile (Capacitor / web-mobile) lacks the hover signal that drives the
  // peek/expand state on desktop, so we expose an explicit "tap a group to
  // expand it" gesture. Dismissal happens when the user taps outside the
  // group/avatar/popup region (see the document-level listener below).
  const onGroupTap = (gid: string) => {
    setPeeked((cur) => ({ ...cur, [gid]: true }));
    setExpanded((cur) => {
      const next: Record<string, boolean> = {};
      // Collapse any other groups that were expanded.
      for (const k of Object.keys(cur)) if (k !== gid) next[k] = false;
      next[gid] = true;
      return next;
    });
  };
  const onGroupTapCollapse = (gid: string) => {
    setExpanded((cur) => (cur[gid] ? { ...cur, [gid]: false } : cur));
    setPeeked((cur) => (cur[gid] ? { ...cur, [gid]: false } : cur));
  };
  const collapseAllGroups = () => {
    setExpanded((cur) => {
      if (!Object.values(cur).some(Boolean)) return cur;
      const next: Record<string, boolean> = {};
      for (const k of Object.keys(cur)) next[k] = false;
      return next;
    });
    setPeeked((cur) => {
      if (!Object.values(cur).some(Boolean)) return cur;
      const next: Record<string, boolean> = {};
      for (const k of Object.keys(cur)) next[k] = false;
      return next;
    });
  };

  useEffect(() => {
    const stored = loadFromStorage();
    if (stored) {
      // Reclamp persisted positions in case they were saved off-screen by an
      // earlier build that didn't clamp, or if the viewport has shrunk.
      const clampedGroups = stored.groups.map((g) => ({
        ...g,
        pos: clampGroupPos(g.pos, g.memberIds.length),
      }));
      // Member buddies' stored pos may also be off-screen — re-derive them
      // from the (now-clamped) group pos so the hull and members align.
      const groupById = new Map(clampedGroups.map((g) => [g.id, g]));
      setBuddies(stored.buddies.map((b) => {
        if (b.groupId && groupById.has(b.groupId)) {
          const g = groupById.get(b.groupId)!;
          const i = g.memberIds.indexOf(b.id);
          if (i >= 0) {
            return { ...b, pos: { x: g.pos.x + i * COLLAPSED_STRIDE, y: g.pos.y } };
          }
        }
        return { ...b, pos: clampBuddyPos(b.pos) };
      }));
      setGroups(clampedGroups);
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
        // Minimized groups stack horizontally at STACK_STRIDE regardless of
        // dock edge (V1 — vertical stacks would require a separate hull
        // layout). collapsed/expanded use the normal horizontal strides.
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
  }, [groups, expanded, peekedDock]);

  const updateBuddy = (id: string, next: BuddyInstanceState) => {
    // Minimized buddies intentionally extend off-screen, so skip the
    // viewport clamp for them. The minimize/restore handlers compute the
    // exact pos themselves.
    const clamped = next.minimized ? next : { ...next, pos: clampBuddyPos(next.pos) };
    setBuddies((cur) => cur.map((b) => (b.id === id ? clamped : b)));
  };

  // Restore a minimized buddy to its lastFreePos (clamped to current viewport).
  const restoreBuddy = (id: string) => {
    setBuddies((cur) => cur.map((b) => {
      if (b.id !== id || !b.minimized) return b;
      const target = clampBuddyPos(b.lastFreePos ?? b.pos);
      return { ...b, minimized: undefined, lastFreePos: undefined, pos: target };
    }));
  };

  // Restore a minimized group to its lastFreePos. Member buddy positions
  // resync via the group/expanded-state effect.
  const restoreGroup = (gid: string) => {
    setGroups((cur) => cur.map((g) => {
      if (g.id !== gid || !g.minimized) return g;
      const target = clampGroupPos(g.lastFreePos ?? g.pos, g.memberIds.length);
      return { ...g, minimized: undefined, lastFreePos: undefined, pos: target };
    }));
  };

  const spawnBuddy = () => {
    setBuddies((cur) => {
      const taken = cur.map((b) => b.variantId);
      const personality = nextUnusedPersonality(taken);
      // Place new buddies in a row to the left of the bottom-right anchor,
      // with a small gap between each. clampBuddyPos keeps them on screen
      // when the row outgrows the viewport — they pile up at the left edge.
      const gap = 16;
      const candidate = { x: -cur.length * (AVATAR_SIZE + gap), y: 0 };
      return [
        ...cur,
        {
          id: `buddy-${idRef.current++}`,
          variantId: personality.variantId,
          pos: clampBuddyPos(candidate),
          messages: [],
        },
      ];
    });
  };

  useEffect(() => {
    return adapter.onSpawnRequest(() => spawnBuddy());
  }, [adapter]);

  // Desktop tray "Settings…" menu item → open the app-wide settings modal.
  useEffect(() => {
    if (adapter.id !== 'electron') return;
    const electron = adapter as ElectronAdapter & { onOpenSettings?: (cb: () => void) => () => void };
    return electron.onOpenSettings?.(() => setAppSettingsOpen(true));
  }, [adapter]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Hover-driven peek/expand runs on both Electron and plain web. Electron
    // additionally pipes hover state into setInteractive() for click-through;
    // plain web doesn't need that. Capacitor uses touchable-region routing
    // instead (handled in the next effect).
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

      // Hover-driven peek-out: re-dock any peeked buddy/group whose visible
      // bbox no longer holds the cursor (and isn't currently being dragged).
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
          let stillOver = false;
          if (kind === 'buddy') stillOver = overBuddyId === id;
          else if (kind === 'group') stillOver = overMemberGid === id || overHullGid === id;
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
      for (const t of collapseTimers.values()) clearTimeout(t);
    };
  }, [adapter]);

// Android-overlay touch routing: the OverlayService window has no
  // FLAG_NOT_TOUCHABLE, so by default it would consume every touch on screen.
  // We continuously report the bounding boxes of all interactive buddy
  // elements to native, which sets them as the window's touchable region —
  // touches outside fall through to whatever app is underneath. Replaces the
  // mouse-hover-driven setInteractive model on touchscreens.
  // Native group tap-zone fires `vibemoji:groupTap` when a non-drag tap
  // lands on the cluster zone (non-expanded group) or on the handle strip
  // (expanded group). Route to onGroupTap to toggle expansion.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (adapter.id !== 'capacitor-android') return;
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      if (expandedRef.current[id]) {
        onGroupTapCollapse(id);
      } else {
        onGroupTap(id);
      }
    };
    window.addEventListener('vibemoji:groupTap', handler);
    return () => window.removeEventListener('vibemoji:groupTap', handler);
  }, [adapter]);

  // Tap-outside-to-dismiss: while any group is peeked/expanded, a tap that
  // misses the group/avatar/popup regions collapses every group. Replaces
  // the previous time-based auto-collapse on mobile.
  // - Capacitor: setOverlaySpilledOut(true) (when any group is peeked or
  //   expanded) makes the main WebView touchable on empty areas while
  //   keeping avatar/group tap-zones live. Tap-zones consume their own
  //   region's taps, so this document listener only sees true "outside"
  //   pointerdowns and uses them to collapse the group.
  // - Web/web-mobile: same idea, just pointer events on the page directly.
  // - Electron: the existing hover-driven HOVER_LEAVE_GRACE_MS path already
  //   handles dismissal naturally; no need for a click handler that would
  //   conflict with click-through routing.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (adapter.id === 'electron') return;
    const anyOpen = Object.values(expanded).some(Boolean) || Object.values(peeked).some(Boolean);
    if (!anyOpen) return;
    // Bubble phase (not capture). Capture-phase pointerdown on document runs
    // before React 19's root-level event delegation, and on Capacitor WebView
    // can interfere with button onClick dispatch even though we don't call
    // preventDefault/stopPropagation. Bubble lets the React click handlers
    // fire first; we still see the document event afterwards for outside-tap.
    const onDown = (ev: PointerEvent) => {
      const target = ev.target as Element | null;
      if (target && target.closest('[data-buddy-interactive],[data-buddy-avatar],[data-group]')) return;
      collapseAllGroups();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [adapter, expanded, peeked]);

  // Exposed by the publishing effect below so other effects (e.g. settle
  // re-measures after a CSS transition) can request a fresh rect publish.
  const triggerRemeasureRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!adapter.isNative || adapter.id !== 'capacitor-android') return;

    let raf = 0;

    // Drag-time region behavior:
    //   - Native (OverlayService.setOnTouchListener) flips a full-window
    //     touchable region on ACTION_DOWN, so input routing keeps working.
    //   - JS (CapacitorAdapter.notifyDragStart) suspends publishing rects
    //     entirely while a drag is in progress. Frequent setTouchableRegion
    //     calls during drag cause webView.requestLayout to fire repeatedly,
    //     which Chromium's gesture detector treats as scroll-cancel.
    // This effect only handles idle-state per-element rects; the suspension
    // contract lives inside the adapter.
    const measure = () => {
      raf = 0;
      const dpr = window.devicePixelRatio || 1;
      const els = document.querySelectorAll<HTMLElement>('[data-buddy-interactive]');
      const rects: { x: number; y: number; w: number; h: number }[] = [];
      els.forEach((el) => {
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

      // Members of a non-expanded group cluster on top of each other; their
      // avatar tap-zones sit above the group tap-zone in z-order and would
      // steal drags meant for the whole group. For every non-expanded group
      // we skip publishing member avatar zones — the group zone owns the
      // cluster (tap → expand, drag → move group). We also union the member
      // bounding rects to publish a group zone even when the hull is not
      // visible (peeked), so the user can grab the cluster directly without
      // first peeking.
      const expandedNow = expandedRef.current;
      const memberRectsByGroup = new Map<string, DOMRect[]>();
      const memberEls = document.querySelectorAll<HTMLElement>('[data-buddy-member][data-group]');
      memberEls.forEach((m) => {
        const gid = m.getAttribute('data-group');
        if (!gid) return;
        const r = m.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        const arr = memberRectsByGroup.get(gid) ?? [];
        arr.push(r);
        memberRectsByGroup.set(gid, arr);
      });
      const nonExpandedGroupIds = new Set<string>();
      for (const gid of memberRectsByGroup.keys()) {
        if (!expandedNow[gid]) nonExpandedGroupIds.add(gid);
      }

      // Per-buddy tap-zones: native maintains one transparent overlay
      // window per avatar id, sized exactly to that avatar's screen rect.
      // Tapping zone N forwards N's buddy id to JS so only that buddy's
      // popup toggles. Main WebView is full-screen at top-left so viewport
      // coords == screen coords (CSS px; multiply by dpr for device px).
      const avatars = document.querySelectorAll<HTMLElement>('[data-buddy-avatar]');
      const avatarRects: { id: string; x: number; y: number; w: number; h: number }[] = [];
      avatars.forEach((el) => {
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

      // Per-group tap-zones: native maintains one transparent window per
      // visible group hull (BuddyGroup wrapper). Lets the user drag the
      // entire group on touch. Only currently-visible hulls (those with a
      // non-zero rect — invisible hulls have opacity:0 but still measure
      // non-zero, so we additionally filter by computed opacity to avoid
      // creating tap-zones over invisible hulls and stealing taps from the
      // background app).
      const groupRects: { id: string; x: number; y: number; w: number; h: number }[] = [];
      // CSS px height of the drag-handle strip published as the group zone
      // when the group is expanded. The visible handle pill sits at top:8 of
      // the hull; this strip generously covers the padTop area above the
      // member avatars without overlapping them.
      const HANDLE_STRIP_CSS = 28;
      // Expanded groups: shrink the group zone to the top "handle" strip of
      // the hull so it doesn't overlap member avatar zones. Source rect from
      // the visible hull element.
      // Mode-tagged ids: the handle-strip zone for an expanded group and the
      // cluster zone for a collapsed group are PUBLISHED AS DIFFERENT WINDOWS
      // ("<gid>:strip" vs "<gid>:cluster"). Sharing the same id and just
      // updating bounds via WindowManager.updateViewLayout occasionally leaves
      // the OS touch-dispatch region stuck on the previous mode's bounds, so
      // after dismissing the expanded view the cluster never receives taps.
      // Native strips the suffix before dispatching, so JS still sees the bare
      // gid in vibemoji:groupTap / Drag* events.
      const hullEls = document.querySelectorAll<HTMLElement>('[data-group][data-buddy-interactive]');
      hullEls.forEach((el) => {
        const id = el.getAttribute('data-group');
        if (!id || !expandedNow[id]) return;
        const cs = window.getComputedStyle(el);
        if (parseFloat(cs.opacity) <= 0.01) return;
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
      // Non-expanded groups: union member rects into one cluster zone so the
      // user can grab the whole group without first peeking it. This zone
      // owns the cluster (tap → expand via vibemoji:groupTap; drag → move).
      for (const [gid, rects] of memberRectsByGroup) {
        if (expandedNow[gid]) continue;
        let l = Infinity, t = Infinity, rgt = -Infinity, btm = -Infinity;
        for (const r of rects) {
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
  }, [adapter]);

  // CSS transitions on the buddy/hull transforms (~360ms) animate getBoundingClientRect
  // values continuously, but transitions don't fire MutationObserver events.
  // Without follow-up measures, the cluster tap-zone for a just-collapsed
  // group ends up at an intermediate position and misses the actual settled
  // cluster — the group becomes untappable. Re-measure a few times across
  // the transition window to publish the final rects.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (adapter.id !== 'capacitor-android') return;
    const trigger = () => triggerRemeasureRef.current?.();
    const timers = [80, 200, 380, 560].map((ms) => setTimeout(trigger, ms));
    return () => { for (const t of timers) clearTimeout(t); };
  }, [adapter, expanded, peeked, groups]);

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
    if (wantFocusable !== focusableRef.current) {
      focusableRef.current = wantFocusable;
      adapter.setFocusable(wantFocusable);
    }
    // Capacitor: chat-open also forces the overlay window to full screen so
    // the bottom-anchored sheet isn't clipped to the idle bottom-right box.
    adapter.setOverlayExpanded(openSetRef.current.size > 0);
  };

  // Capacitor: a peeked or expanded group overflows the idle window
  // horizontally (EXPANDED_STRIDE = 132px per buddy), so we have to expand
  // the overlay window for the duration. ACTION_DOWN on the avatar already
  // expands natively, so this only matters for hover-driven peek on web —
  // but the call is cheap and keeps the capacitor adapter in sync.
  useEffect(() => {
    const anyPeeked = Object.values(peeked).some(Boolean);
    const anyExpanded = Object.values(expanded).some(Boolean);
    const want = anyPeeked || anyExpanded;
    // setOverlayExpanded (popup mode) only turns on for actual popups: it
    // disables avatar tap-zones, which makes member drags hard to trigger
    // via React pointer events on a fullscreen transparent WebView.
    // setOverlaySpilledOut keeps the WebView touchable for empty-area taps
    // (so outside-tap-dismiss still collapses an expanded group) WITHOUT
    // killing the per-avatar/per-group native tap-zones.
    adapter.setOverlayExpanded(openSetRef.current.size > 0);
    adapter.setOverlaySpilledOut?.(want);
  }, [peeked, expanded, adapter]);

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
      if (Math.abs(dy) > EJECT_DY || Math.abs(dx) > EJECT_DX) {
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

    // Live edge-magnet preview. If buddy is in the magnet zone (and no
    // merge target — merge wins), publish the edge to the renderer for a
    // visual cue. Cleared on drag end.
    if (!bestId) {
      const near = nearestEdgeForBuddy(pos);
      const inZone = near.d < SNAP_THRESHOLD;
      setEdgeMagnet((cur) => {
        if (!inZone) return cur ? null : cur;
        if (cur && cur.kind === 'buddy' && cur.id === id && cur.edge === near.edge) return cur;
        return { kind: 'buddy', id, edge: near.edge };
      });
    } else {
      setEdgeMagnet((cur) => (cur ? null : cur));
    }
  };

  const onDragEnd = (id: string, pos: { x: number; y: number }, moved: boolean) => {
    setMagnet(null);
    setEdgeMagnet(null);
    // A drag commits the peek (in either direction); peekedDock tracks
    // hover-state only and shouldn't survive the drop.
    setPeekedDock((cur) => {
      const k = `buddy:${id}`;
      if (!cur[k]) return cur;
      const next = { ...cur }; delete next[k]; return next;
    });
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
      // Keep the group's existing position — re-clamping on every merge
      // would cause a visible leftward jump each time the user adds a
      // buddy. Drag-time clamping (in onGroupDragMove) keeps the group on
      // screen if it gets dragged out of bounds.
      setGroups((cur) => cur.map((x) => (
        x.id === g.id
          ? { ...x, memberIds: [...x.memberIds, id] }
          : x
      )));
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
      // Members spread rightward from group.pos via slotPos (x: pos.x + i*stride),
      // and the hull's right CSS subtracts the rightmost member offset. With the
      // avatar anchored to viewport's right edge (translate(positive) = move
      // rightward = off-screen), the group only fits if group.pos.x is far
      // enough negative to absorb the spread at the widest stride. Clamp at
      // creation so a small phone screen doesn't render the hull and the
      // newly-added member fully off the right edge.
      const groupPos = clampGroupPos(target.pos, 2);
      setGroups((cur) => [...cur, { id: newGroupId, memberIds: [target.id, id], pos: groupPos }]);
      setBuddies((cur) => cur.map((x) => (
        x.id === target.id || x.id === id ? { ...x, groupId: newGroupId } : x
      )));
      return;
    }

    // Edge-snap: if no merge target won, check whether the user dropped
    // the buddy near a screen edge. If so, dock it to that edge in
    // half-hidden form. lastFreePos remembers where to slide back to.
    const near = nearestEdgeForBuddy(pos);
    if (near.d < SNAP_THRESHOLD) {
      const dock: { edge: Edge } = { edge: near.edge };
      const minPos = minimizedBuddyPos(dock.edge, pos);
      setBuddies((cur) => cur.map((x) => (
        x.id === id ? { ...x, minimized: dock, lastFreePos: pos, pos: minPos } : x
      )));
    }
  };

  // Group drag end: detect edge-snap. If the drop is near a screen edge,
  // dock the group there (members rerender at STACK_STRIDE via the
  // grouped-members sync effect). If the user dragged a minimized group
  // AWAY from any edge, un-minimize and clamp it back into bounds.
  const onGroupDragEnd = (gid: string, pos: { x: number; y: number }) => {
    setEdgeMagnet(null);
    setPeekedDock((cur) => {
      const k = `group:${gid}`;
      if (!cur[k]) return cur;
      const next = { ...cur }; delete next[k]; return next;
    });
    const g = groupsRef.current.find((x) => x.id === gid);
    if (!g) return;
    const near = nearestEdgeForGroup(pos, g.memberIds.length);
    if (near.d < SNAP_THRESHOLD) {
      const dock: { edge: Edge } = { edge: near.edge };
      const minPos = minimizedGroupPos(dock.edge, g.memberIds.length, pos);
      const lastFree = g.minimized ? (g.lastFreePos ?? pos) : pos;
      setGroups((cur) => cur.map((x) => (
        x.id === gid ? { ...x, minimized: dock, lastFreePos: lastFree, pos: minPos } : x
      )));
    } else if (g.minimized) {
      // Released far from any edge — un-minimize at the dropped position.
      const target = clampGroupPos(pos, g.memberIds.length);
      setGroups((cur) => cur.map((x) => (
        x.id === gid ? { ...x, minimized: undefined, lastFreePos: undefined, pos: target } : x
      )));
    }
  };

  const onGroupDragMove = (gid: string, pos: { x: number; y: number }) => {
    // A drag from a hover-peeked dock commits the restore: clear the
    // minimized intent so the new drag pos owns the rendered position
    // (otherwise renderedGroupPos would keep snapping back to peekedPos).
    const gPre = groupsRef.current.find((x) => x.id === gid);
    if (gPre?.minimized) {
      setGroups((cur) => cur.map((g) => (g.id === gid ? { ...g, minimized: undefined, lastFreePos: undefined } : g)));
      setPeekedDock((cur) => {
        const k = `group:${gid}`;
        if (!cur[k]) return cur;
        const next = { ...cur }; delete next[k]; return next;
      });
    }
    // Update the group's pos AND every member's pos in the same React
    // batch — mirroring the avatar drag path where `onChange` writes the
    // buddy's pos directly. The [groups, expanded] effect would eventually
    // sync members to the new slot positions, but only on a *second*
    // render after the setGroups commit, which makes the hull race ahead
    // of its members during a drag and reads as broken.
    const groupRef = groupsRef.current.find((g) => g.id === gid);
    const memberCount = groupRef?.memberIds.length ?? 2;
    // Skip viewport clamp while the group is minimized — drag is allowed
    // to move freely off-screen; onGroupDragEnd handles re-snap or eject.
    if (!groupRef?.minimized) pos = clampGroupPos(pos, memberCount);
    setGroups((cur) => cur.map((g) => (g.id === gid ? { ...g, pos } : g)));

    // Live edge-magnet preview for the group.
    const near = nearestEdgeForGroup(pos, memberCount);
    const inZone = near.d < SNAP_THRESHOLD;
    setEdgeMagnet((cur) => {
      if (!inZone) return cur && cur.kind === 'group' && cur.id === gid ? null : cur;
      if (cur && cur.kind === 'group' && cur.id === gid && cur.edge === near.edge) return cur;
      return { kind: 'group', id: gid, edge: near.edge };
    });
    setBuddies((cur) => {
      const g = groupsRef.current.find((x) => x.id === gid);
      if (!g) return cur;
      const stride = expandedRef.current[gid] ? EXPANDED_STRIDE : COLLAPSED_STRIDE;
      let changed = false;
      const nextArr = cur.map((b) => {
        if (b.groupId !== gid) return b;
        const i = g.memberIds.indexOf(b.id);
        if (i < 0) return b;
        const target = { x: pos.x + i * stride, y: pos.y };
        if (b.pos.x === target.x && b.pos.y === target.y) return b;
        changed = true;
        return { ...b, pos: target };
      });
      return changed ? nextArr : cur;
    });
  };

  const teammatesFor = (b: BuddyInstanceState): Teammate[] => {
    if (!b.groupId) return [];
    const g = groups.find((x) => x.id === b.groupId);
    if (!g) return [];
    return g.memberIds
      .filter((mid) => mid !== b.id)
      .map((mid) => buddies.find((x) => x.id === mid))
      .filter((x): x is BuddyInstanceState => !!x)
      .map((mb) => {
        const p = PERSONALITY_BY_VARIANT[mb.variantId] ?? PERSONALITY_BY_VARIANT.violet;
        return { name: p.name, role: p.role };
      });
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
        edgeMagnet={edgeMagnet?.kind === 'buddy' && edgeMagnet.id === b.id ? edgeMagnet.edge : null}
        teammates={teammatesFor(b)}
        isGroupExpanded={!!(b.groupId && expanded[b.groupId])}
        isGroupMinimized={!!(b.groupId && groups.find((g) => g.id === b.groupId)?.minimized)}
        onGroupTap={onGroupTap}
        onRestore={() => restoreBuddy(b.id)}
        onGroupRestore={restoreGroup}
        dockPeeked={!!peekedDock[`buddy:${b.id}`]}
        groupDockPeeked={!!(b.groupId && peekedDock[`group:${b.groupId}`])}
        onDockPeek={() => peekDockBuddy(b.id)}
        onDockUnpeek={() => unpeekDockBuddy(b.id)}
        onGroupDockPeek={(gid) => peekDockGroup(gid)}
        onGroupDockUnpeek={(gid) => unpeekDockGroup(gid)}
      />
    );
  };

  return (
    <>
      {/* Hulls render BEHIND members (lower z-index). Members are always at
          the top level so they aren't unmounted/remounted when joining or
          leaving a group. */}
      {groups.map((g) => {
        const dockPeeked = !!peekedDock[`group:${g.id}`];
        const stride = (g.minimized && !dockPeeked)
          ? STACK_STRIDE
          : (expanded[g.id] ? EXPANDED_STRIDE : COLLAPSED_STRIDE);
        const memberVariantIds = g.memberIds
          .map((mid) => buddies.find((b) => b.id === mid)?.variantId)
          .filter((v): v is string => !!v);
        if (memberVariantIds.length < 2) return null;
        const renderedGroupPos = (g.minimized && dockPeeked)
          ? peekedGroupPos(g.minimized.edge, memberVariantIds.length, g.lastFreePos, stride)
          : g.pos;
        return (
          <BuddyGroup
            key={g.id}
            groupId={g.id}
            pos={renderedGroupPos}
            memberCount={memberVariantIds.length}
            stride={stride}
            avatarSize={AVATAR_SIZE}
            padX={HULL_PAD_X}
            padTop={HULL_PAD_TOP}
            padBottom={HULL_PAD_BOTTOM}
            anchor={ANCHOR}
            // Hull shows on peek/expand of a free group, OR while a
            // minimized group is being hover-peeked.
            visible={(!g.minimized && (!!peeked[g.id] || !!expanded[g.id])) || (!!g.minimized && dockPeeked)}
            magnetActive={magnet?.targetType === 'group' && magnet.targetId === g.id}
            edgeMagnetActive={edgeMagnet?.kind === 'group' && edgeMagnet.id === g.id}
            background={gradientFor(memberVariantIds)}
            expanded={!!expanded[g.id]}
            onGroupDragMove={onGroupDragMove}
            onGroupDragEnd={onGroupDragEnd}
            onGroupTap={onGroupTap}
          />
        );
      })}

      {buddies.map(renderBuddy)}

      {/* Web / Capacitor: a small gear in the top-right opens app-wide
          settings (notification method, future global prefs). On Electron
          the same modal is opened from the tray "Settings…" item, so we
          skip rendering the gear there to keep the always-on-top window
          uncluttered. */}
      {adapter.id !== 'electron' && (
        <button
          data-buddy-interactive
          onClick={() => setAppSettingsOpen(true)}
          aria-label="App settings"
          title="App settings"
          className="fixed right-3 top-3 z-[70] grid h-9 w-9 place-items-center rounded-full bg-white/85 text-zinc-600 shadow-md ring-1 ring-zinc-200 backdrop-blur-md hover:bg-white hover:text-zinc-900 dark:bg-zinc-900/85 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.36.16.66.42.87.74A1.65 1.65 0 0 0 21 10h.09a2 2 0 1 1 0 4H21a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      )}

      <AppSettings open={appSettingsOpen} onClose={() => setAppSettingsOpen(false)} />

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
        @keyframes buddy-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4%); }
        }
      `}</style>
    </>
  );
}
