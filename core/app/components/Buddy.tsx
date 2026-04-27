'use client';

import { useEffect, useRef, useState } from 'react';
import BuddyInstance, { type BuddyInstanceState } from './BuddyInstance';
import BuddyGroup from './BuddyGroup';
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
const EXPANDED_STRIDE = 132;
// Inner hit-box for expand: the hull rect inset by this many px on every side.
// Larger inset = thicker peek-only buffer ring around the hull edge.
const EXPAND_HIT_INSET = 48;
const MERGE_RADIUS = 90;
const EJECT_RADIUS = 180;
const HOVER_LEAVE_GRACE_MS = 250;
// Anchor offset from screen corner. Tighter on mobile/capacitor so the
// floating buddy hugs the corner — there's far less screen real estate to
// burn on whitespace than on desktop.
const ANCHOR = (() => {
  const pad = typeof window !== 'undefined' && isMobile() ? 12 : 24;
  return { right: pad, bottom: pad };
})();

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
    const clamped = { ...next, pos: clampBuddyPos(next.pos) };
    setBuddies((cur) => cur.map((b) => (b.id === id ? clamped : b)));
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Click-through hover detection is desktop-only; Capacitor uses
    // touchable-region routing instead (handled in the next effect).
    if (adapter.id !== 'electron') return;
    const electron = adapter as ElectronAdapter;
    let interactive = false;
    const setInteractive = (next: boolean) => {
      if (next === interactive) return;
      interactive = next;
      electron.setInteractive(next);
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
  // - Capacitor: setOverlayExpanded(true) (driven by hasGroupSpilloutRef
  //   below) makes the main WebView fully touchable, so the document sees
  //   pointerdowns landing on empty areas. Avatar/group tap-zones sit above
  //   the WebView and consume their own taps, so this listener only fires
  //   for true "outside" taps.
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
    adapter.setOverlayExpanded(openSetRef.current.size > 0 || hasGroupSpilloutRef.current);
  };

  // Capacitor: a peeked or expanded group overflows the idle window
  // horizontally (EXPANDED_STRIDE = 132px per buddy), so we have to expand
  // the overlay window for the duration. ACTION_DOWN on the avatar already
  // expands natively, so this only matters for hover-driven peek on web —
  // but the call is cheap and keeps the capacitor adapter in sync.
  const hasGroupSpilloutRef = useRef(false);
  useEffect(() => {
    const anyPeeked = Object.values(peeked).some(Boolean);
    const anyExpanded = Object.values(expanded).some(Boolean);
    const want = anyPeeked || anyExpanded;
    hasGroupSpilloutRef.current = want;
    adapter.setOverlayExpanded(want || openSetRef.current.size > 0);
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
    }
  };

  const onGroupDragMove = (gid: string, pos: { x: number; y: number }) => {
    // Update the group's pos AND every member's pos in the same React
    // batch — mirroring the avatar drag path where `onChange` writes the
    // buddy's pos directly. The [groups, expanded] effect would eventually
    // sync members to the new slot positions, but only on a *second*
    // render after the setGroups commit, which makes the hull race ahead
    // of its members during a drag and reads as broken.
    const memberCount = groupsRef.current.find((g) => g.id === gid)?.memberIds.length ?? 2;
    pos = clampGroupPos(pos, memberCount);
    setGroups((cur) => cur.map((g) => (g.id === gid ? { ...g, pos } : g)));
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
        teammates={teammatesFor(b)}
        isGroupExpanded={!!(b.groupId && expanded[b.groupId])}
        onGroupTap={onGroupTap}
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
        @keyframes buddy-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4%); }
        }
      `}</style>
    </>
  );
}
