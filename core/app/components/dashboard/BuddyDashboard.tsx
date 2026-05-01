'use client';

import { useEffect, useRef, useState } from 'react';
import type { AvatarInstanceState } from '../avatar/avatar-instance.types';
import { PERSONALITY_BY_VARIANT } from '../personalities';
import type { Teammate } from '../llm';
import { usePlatform } from '@/lib/hooks/use-platform';
import type { ElectronAdapter } from '@/lib/platform/electron';
import {
  getPhysicsMode, getRotationEnabled,
  bboxOverlap, clampMag, cross2, randomDriftVel, randomDriftSpin,
  FLING_THRESHOLD, REST_THRESHOLD, FLIGHT_DRAG, EDGE_RESTITUTION,
  COLLIDE_RESTITUTION, VELOCITY_WINDOW_MS, MAX_FLING,
  ASTRONAUT_DRAG, ASTRONAUT_EDGE_RESTITUTION, ASTRONAUT_COLLIDE_RESTITUTION,
  ASTRONAUT_DRIFT_SPEED, ASTRONAUT_DRIFT_SPIN,
  ANG_DRAG, ANG_REST_THRESHOLD, RELEASE_TORQUE_GAIN, MAX_ANG_VEL,
  ROTATION_EASE_MS,
  type Vec2, type PhysicsMode,
} from '../physics';
import DashboardChrome from './DashboardChrome';
import DashboardStage from './DashboardStage';
import DashboardStyles from './DashboardStyles';
import {
  ANCHOR,
  AVATAR_SIZE,
  COLLAPSED_STRIDE,
  EJECT_DX,
  EJECT_DY,
  EXPANDED_STRIDE,
  MERGE_RADIUS,
  SNAP_THRESHOLD,
} from './constants';
import {
  clampBuddyPos,
  clampGroupPos,
  isHorizontalEdge,
  minimizedBuddyPos,
  minimizedGroupPos,
  nearestEdgeForBuddy,
  nearestEdgeForGroup,
  peekedBuddyPos,
  slotPos,
} from './geometry';
import { initialBuddies } from './storage';
import type { Edge, Group } from './types';
import { useBuddyActions } from '../../../lib/hooks/useBuddyActions';
import { useBuddyPersistence } from '../../../lib/hooks/useBuddyPersistence';
import { useDesktopGroupHover } from '../../../lib/hooks/useDesktopGroupHover';
import { useDragRotation } from '../../../lib/hooks/useDragRotation';
import { useGroupExpansion } from '../../../lib/hooks/useGroupExpansion';
import { useNativeTouchRegions } from '../../../lib/hooks/useNativeTouchRegions';
import { useWonderAvatarBrain } from '../../../lib/hooks/useWonderAvatarBrain';

export default function Buddy() {
  const adapter = usePlatform();
  const [buddies, setBuddies] = useState<AvatarInstanceState[]>(initialBuddies);
  const [groups, setGroups] = useState<Group[]>([]);
  const [peeked, setPeeked] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [openBuddies, setOpenBuddies] = useState<Record<string, boolean>>({});
  const [wonderPausedBuddies, setWonderPausedBuddies] = useState<Record<string, boolean>>({});
  const [magnet, setMagnet] = useState<{ draggedId: string; targetId: string; targetType: 'buddy' | 'group' } | null>(null);
  const magnetRef = useRef(magnet);
  useEffect(() => { magnetRef.current = magnet; }, [magnet]);
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
  const [llmOnboardingBuddyId, setLlmOnboardingBuddyId] = useState<string | null>(null);
  // True only inside the Android system-overlay WebView (where OverlayService
  // injects `vibebudNative`). The in-app Capacitor BridgeActivity WebView
  // never sees it. Resolved post-mount so SSR/static export renders the gear
  // and hydration removes it in the overlay.
  const [isAndroidOverlay, setIsAndroidOverlay] = useState(false);
  useEffect(() => {
    setIsAndroidOverlay(!!(window as unknown as { vibebudNative?: unknown }).vibebudNative);
  }, []);
  const idRef = useRef(2);
  const groupIdRef = useRef(1);
  const hydratedRef = useRef(false);

  const buddiesRef = useRef(buddies);
  const groupsRef = useRef(groups);
  const expandedRef = useRef(expanded);
  const peekedRef = useRef(peeked);
  const peekedDockRef = useRef(peekedDock);
  const openBuddiesRef = useRef(openBuddies);
  const wonderPausedBuddiesRef = useRef(wonderPausedBuddies);

  // --- Drag physics ---
  const [physicsMode, setPhysicsModeState] = useState<PhysicsMode>(() => getPhysicsMode());
  const modeRef = useRef(physicsMode);
  useEffect(() => { modeRef.current = physicsMode; }, [physicsMode]);
  useEffect(() => {
    const onChange = (e: Event) => {
      const m = (e as CustomEvent<PhysicsMode>).detail;
      if (m === 'off' || m === 'bouncy' || m === 'astronaut' || m === 'wonder') setPhysicsModeState(m);
    };
    window.addEventListener('vibebud:physicsChange', onChange);
    return () => window.removeEventListener('vibebud:physicsChange', onChange);
  }, []);
  // Master rotation toggle. When disabled, avatars never rotate — drag-time
  // pendulum, flight angVel, and release torque are all bypassed and the
  // rotation prop forwarded to children is forced to 0.
  const [rotationEnabled, setRotationEnabledState] = useState<boolean>(() => getRotationEnabled());
  const rotationEnabledRef = useRef(rotationEnabled);
  useEffect(() => { rotationEnabledRef.current = rotationEnabled; }, [rotationEnabled]);
  useEffect(() => {
    const onChange = (e: Event) => setRotationEnabledState(!!(e as CustomEvent<boolean>).detail);
    window.addEventListener('vibebud:rotationChange', onChange);
    return () => window.removeEventListener('vibebud:rotationChange', onChange);
  }, []);
  // Per-body rotation in degrees, keyed by `buddy:<id>` / `group:<id>`.
  // Updated 60fps while flying or being dragged from off-center.
  const [rotations, setRotations] = useState<Record<string, number>>({});
  const rotationsRef = useRef(rotations);
  useEffect(() => { rotationsRef.current = rotations; }, [rotations]);
  // Per-body grab pivot (cursor-relative-to-center, in CSS px). Used as the
  // CSS transform-origin so rotation pivots around the cursor — the grab pin
  // stays fixed in screen space instead of swinging out from the avatar's
  // geometric center. Survives across drags (rotation is 0 between drags so
  // the stored pivot is harmless), refreshed on each pointer-down.
  const [grabPivots, setGrabPivots] = useState<Record<string, Vec2>>({});
  // Grab offset (cursor relative to body's center, in CSS px) captured at
  // pointer-down. Used to derive torque-from-flick on release.
  const grabOffsetsRef = useRef<Map<string, Vec2>>(new Map());
  // Last drag-move sample (pos + timestamp) so we can compute incremental
  // rotation while dragging from an off-center grab (astronaut mode only).
  const lastDragSampleRef = useRef<Map<string, { t: number; x: number; y: number }>>(new Map());
  // Body keys whose rotation is currently being driven by physics (drag or
  // flight). Children turn off the rotation CSS transition while active so
  // 60fps updates don't lag, and turn it back on for the smooth ease-to-0.
  const [activeRotKeys, setActiveRotKeys] = useState<Record<string, boolean>>({});
  const markRotActive = (key: string, v: boolean) => {
    setActiveRotKeys((cur) => {
      if (!!cur[key] === v) return cur;
      const next = { ...cur };
      if (v) next[key] = true; else delete next[key];
      return next;
    });
  };
  // Bump tick: increments per id (`buddy:<id>` / `group:<id>`) on each
  // collision, so child components can react with a brief shake + emotion.
  const [bumpTicks, setBumpTicks] = useState<Record<string, number>>({});
  const {
    actions: shimejiActions,
    directions: shimejiDirections,
    ensureLoop: ensureShimejiLoop,
    cancelLoop: cancelShimejiLoop,
  } = useWonderAvatarBrain({
    modeRef,
    buddiesRef,
    openBuddiesRef,
    wonderPausedBuddiesRef,
    setBuddies,
  });
  const { onGroupTap, onGroupTapCollapse, collapseAllGroups } = useGroupExpansion({ setPeeked, setExpanded });
  useBuddyPersistence({
    buddies,
    groups,
    expanded,
    peekedDock,
    hydratedRef,
    idRef,
    groupIdRef,
    setBuddies,
    setGroups,
  });
  // Drag velocity samples, keyed by `buddy:<id>` / `group:<id>`.
  const velSamplesRef = useRef<Map<string, Array<{ t: number; x: number; y: number }>>>(new Map());
  const recordSample = (key: string, p: Vec2) => {
    const t = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    let buf = velSamplesRef.current.get(key);
    if (!buf) { buf = []; velSamplesRef.current.set(key, buf); }
    buf.push({ t, x: p.x, y: p.y });
    while (buf.length > 1 && t - buf[0].t > VELOCITY_WINDOW_MS) buf.shift();
  };
  const consumeVelocity = (key: string): Vec2 => {
    const buf = velSamplesRef.current.get(key);
    velSamplesRef.current.delete(key);
    if (!buf || buf.length < 2) return { x: 0, y: 0 };
    const a = buf[0], b = buf[buf.length - 1];
    const dt = b.t - a.t;
    if (dt <= 0) return { x: 0, y: 0 };
    return clampMag({ x: (b.x - a.x) / dt, y: (b.y - a.y) / dt }, MAX_FLING);
  };
  type Flight = {
    kind: 'buddy' | 'group';
    id: string;
    pos: Vec2;
    vel: Vec2;
    rot: number;     // degrees
    angVel: number;  // deg/ms
  };
  const flightsRef = useRef<Map<string, Flight>>(new Map());
  const flightRafRef = useRef<number>(0);
  const lastFlightTickRef = useRef<number>(0);
  const {
    pendulumsRef,
    cancelPendulumLoop,
    onBuddyDragStart,
    onGroupDragStartPhysics,
    recordDragCursor,
  } = useDragRotation({
    adapter,
    modeRef,
    rotationEnabledRef,
    rotationsRef,
    setRotations,
    setGrabPivots,
    grabOffsetsRef,
    lastDragSampleRef,
    flightsRef,
    buddiesRef,
    groupsRef,
    markRotActive,
  });
  const ensureFlightLoop = () => {
    if (flightRafRef.current) return;
    lastFlightTickRef.current = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    flightRafRef.current = requestAnimationFrame(flightTick);
  };
  const groupSize = (g: Group) => ({
    w: (g.memberIds.length - 1) * COLLAPSED_STRIDE + AVATAR_SIZE,
    h: AVATAR_SIZE,
  });
  const flightTick = () => {
    flightRafRef.current = 0;
    const mode = modeRef.current;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const rawDt = now - lastFlightTickRef.current;
    lastFlightTickRef.current = now;
    // Cap dt — if the tab was backgrounded we don't want a giant jump.
    const dt = Math.min(48, Math.max(1, rawDt));
    const flights = flightsRef.current;
    const dragging: Set<string> = (window as unknown as { __vibebudDragging?: Set<string> }).__vibebudDragging
      ?? new Set();

    // Astronaut: top up flights so every visible free body floats.
    if (mode === 'astronaut') {
      for (const b of buddiesRef.current) {
        if (b.minimized || b.groupId) continue;
        const key = `buddy:${b.id}`;
        if (flights.has(key)) continue;
        if (dragging.has(b.id)) continue;
        flights.set(key, {
          kind: 'buddy', id: b.id, pos: { ...b.pos },
          vel: randomDriftVel(ASTRONAUT_DRIFT_SPEED),
          rot: rotationsRef.current[key] ?? 0,
          angVel: rotationEnabledRef.current ? randomDriftSpin(ASTRONAUT_DRIFT_SPIN) : 0,
        });
      }
      for (const g of groupsRef.current) {
        if (g.minimized) continue;
        const key = `group:${g.id}`;
        if (flights.has(key)) continue;
        if (dragging.has(`group:${g.id}`)) continue;
        flights.set(key, {
          kind: 'group', id: g.id, pos: { ...g.pos },
          vel: randomDriftVel(ASTRONAUT_DRIFT_SPEED),
          rot: rotationsRef.current[key] ?? 0,
          angVel: rotationEnabledRef.current ? randomDriftSpin(ASTRONAUT_DRIFT_SPIN) : 0,
        });
      }
    }

    if (flights.size === 0) return;

    // Mode-specific tuning.
    const linDrag = mode === 'astronaut' ? ASTRONAUT_DRAG : FLIGHT_DRAG;
    const edgeRest = mode === 'astronaut' ? ASTRONAUT_EDGE_RESTITUTION : EDGE_RESTITUTION;
    const colRest = mode === 'astronaut' ? ASTRONAUT_COLLIDE_RESTITUTION : COLLIDE_RESTITUTION;
    const angDrag = mode === 'astronaut' ? 1.0 : ANG_DRAG;

    // Static-body view: every visible non-flying, non-dragged buddy/group
    // becomes a wall. Dragged bodies are intentionally excluded — colliding
    // with a body the user is currently positioning produces a bounce that
    // makes intent (e.g., merging into a group) hard to express.
    const flyingKeys = new Set(flights.keys());
    type Body = { kind: 'buddy' | 'group'; id: string; box: { x: number; y: number; w: number; h: number } };
    const bodies: Body[] = [];
    for (const b of buddiesRef.current) {
      if (b.minimized) continue;
      if (b.groupId) continue;
      if (dragging.has(b.id)) continue;
      bodies.push({ kind: 'buddy', id: b.id, box: { x: b.pos.x, y: b.pos.y, w: AVATAR_SIZE, h: AVATAR_SIZE } });
    }
    for (const g of groupsRef.current) {
      if (g.minimized) continue;
      if (dragging.has(`group:${g.id}`)) continue;
      const s = groupSize(g);
      bodies.push({ kind: 'group', id: g.id, box: { x: g.pos.x, y: g.pos.y, w: s.w, h: s.h } });
    }

    const updatedBuddyPos: Record<string, Vec2> = {};
    const updatedGroupPos: Record<string, Vec2> = {};
    const updatedRotations: Record<string, number> = {};
    const collided = new Set<string>();
    const toRest: Array<Flight> = [];
    const m = magnetRef.current;
    const magnetKey = m ? `${m.targetType}:${m.targetId}` : null;
    // dt is in ms; vel is px/ms; angVel is deg/ms.
    for (const [key, f] of flights) {
      // Magnetic stasis: while the user is dragging another body toward
      // this one for a merge, freeze the target so it's easy to hit.
      if (key === magnetKey) continue;
      // Integrate translation + rotation.
      f.pos = { x: f.pos.x + f.vel.x * dt, y: f.pos.y + f.vel.y * dt };
      f.rot = f.rot + f.angVel * dt;
      // Per-frame drag (normalize to ~16ms frame so dt jitter doesn't change feel).
      const dK = Math.pow(linDrag, dt / 16);
      const aK = Math.pow(angDrag, dt / 16);
      f.vel = { x: f.vel.x * dK, y: f.vel.y * dK };
      f.angVel = f.angVel * aK;

      // Edge bounce via the existing clamp helpers as the source of truth.
      let clamped: Vec2;
      let selfBox: { x: number; y: number; w: number; h: number };
      if (f.kind === 'buddy') {
        clamped = clampBuddyPos(f.pos);
        selfBox = { x: clamped.x, y: clamped.y, w: AVATAR_SIZE, h: AVATAR_SIZE };
      } else {
        const g = groupsRef.current.find((x) => x.id === f.id);
        const n = g?.memberIds.length ?? 2;
        clamped = clampGroupPos(f.pos, n);
        selfBox = { x: clamped.x, y: clamped.y, w: (n - 1) * COLLAPSED_STRIDE + AVATAR_SIZE, h: AVATAR_SIZE };
      }
      if (clamped.x !== f.pos.x) f.vel.x = -f.vel.x * edgeRest;
      if (clamped.y !== f.pos.y) f.vel.y = -f.vel.y * edgeRest;
      f.pos = clamped;

      // Collisions vs every other body. Skip self; skip other in-flight to
      // avoid double-resolving — the other flight's own pass handles it.
      for (const o of bodies) {
        if (o.kind === f.kind && o.id === f.id) continue;
        if (flyingKeys.has(`${o.kind}:${o.id}`)) continue;
        const ov = bboxOverlap(
          { x: f.pos.x, y: f.pos.y, w: selfBox.w, h: selfBox.h },
          o.box,
        );
        if (!ov) continue;
        if (ov.axis === 'x') {
          const dir = (f.pos.x + selfBox.w / 2) < (o.box.x + o.box.w / 2) ? -1 : 1;
          f.pos.x += dir * ov.depth;
          f.vel.x = -f.vel.x * colRest;
        } else {
          const dir = (f.pos.y + selfBox.h / 2) < (o.box.y + o.box.h / 2) ? -1 : 1;
          f.pos.y += dir * ov.depth;
          f.vel.y = -f.vel.y * colRest;
        }
        collided.add(`${f.kind}:${f.id}`);
        collided.add(`${o.kind}:${o.id}`);
      }

      // Astronaut: maintain a baseline drift so bodies never come to rest.
      if (mode === 'astronaut' && Math.hypot(f.vel.x, f.vel.y) < ASTRONAUT_DRIFT_SPEED * 0.4) {
        const nudge = randomDriftVel(ASTRONAUT_DRIFT_SPEED);
        f.vel.x += nudge.x; f.vel.y += nudge.y;
      }

      if (f.kind === 'buddy') updatedBuddyPos[f.id] = f.pos;
      else updatedGroupPos[f.id] = f.pos;
      updatedRotations[key] = f.rot;

      // Rest detection only in non-astronaut modes.
      if (mode !== 'astronaut'
        && Math.hypot(f.vel.x, f.vel.y) < REST_THRESHOLD
        && Math.abs(f.angVel) < ANG_REST_THRESHOLD
      ) {
        toRest.push(f);
      }
    }

    if (Object.keys(updatedBuddyPos).length) {
      setBuddies((cur) => cur.map((b) => updatedBuddyPos[b.id]
        ? { ...b, pos: updatedBuddyPos[b.id] }
        : b));
    }
    if (Object.keys(updatedGroupPos).length) {
      setGroups((cur) => cur.map((g) => updatedGroupPos[g.id]
        ? { ...g, pos: updatedGroupPos[g.id] }
        : g));
    }
    if (Object.keys(updatedRotations).length) {
      setRotations((cur) => ({ ...cur, ...updatedRotations }));
    }
    if (collided.size) {
      setBumpTicks((cur) => {
        const next = { ...cur };
        for (const k of collided) next[k] = (next[k] ?? 0) + 1;
        return next;
      });
    }

    // Settle any flight at rest. Dock to nearest edge if it landed close.
    // Skipped entirely in astronaut mode (handled above).
    for (const f of toRest) {
      const key = `${f.kind}:${f.id}`;
      flights.delete(key);
      adapter.notifyDragEnd(`flight:${key}`);
      // Rotation glides back to 0; CSS transition (re-enabled when the body
      // is no longer marked active) handles the easing. Astronaut bodies
      // never reach this branch — their flights never settle.
      setRotations((cur) => (cur[key] === 0 ? cur : { ...cur, [key]: 0 }));
      markRotActive(key, false);
      if (f.kind === 'buddy') {
        const near = nearestEdgeForBuddy(f.pos);
        if (near.d < SNAP_THRESHOLD) {
          const dock: { edge: Edge } = { edge: near.edge };
          const minPos = minimizedBuddyPos(dock.edge, f.pos);
          setBuddies((cur) => cur.map((b) => b.id === f.id
            ? { ...b, minimized: dock, lastFreePos: f.pos, pos: minPos }
            : b));
        }
      } else {
        const g = groupsRef.current.find((x) => x.id === f.id);
        if (g) {
          const near = nearestEdgeForGroup(f.pos, g.memberIds.length);
          if (near.d < SNAP_THRESHOLD) {
            const dock: { edge: Edge } = { edge: near.edge };
            const minPos = minimizedGroupPos(dock.edge, g.memberIds.length, f.pos);
            setGroups((cur) => cur.map((x) => x.id === f.id
              ? { ...x, minimized: dock, lastFreePos: f.pos, pos: minPos }
              : x));
          }
        }
      }
    }

    if (flights.size > 0 || mode === 'astronaut') {
      flightRafRef.current = requestAnimationFrame(flightTick);
    }
  };
  const startFlight = (
    kind: 'buddy' | 'group', id: string, startPos: Vec2, vel: Vec2, angVel: number,
  ) => {
    const key = `${kind}:${id}`;
    const cappedAng = Math.max(-MAX_ANG_VEL, Math.min(MAX_ANG_VEL, angVel));
    flightsRef.current.set(key, {
      kind, id,
      pos: { ...startPos },
      vel: { ...vel },
      rot: rotationsRef.current[key] ?? 0,
      angVel: cappedAng,
    });
    // Hold the drag-holder so Capacitor keeps the touchable region full-window
    // and persistence/region-publish suspensions remain in effect until rest.
    adapter.notifyDragStart(`flight:${key}`);
    markRotActive(key, true);
    ensureFlightLoop();
  };
  // Astronaut mode is always-on once enabled — the loop tops up flights and
  // keeps drifting until the user changes mode.
  useEffect(() => {
    if (physicsMode === 'astronaut') ensureFlightLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [physicsMode]);
  useEffect(() => {
    if (physicsMode === 'wonder' && buddies.some((b) => b.avatar?.kind === 'shimeji' || b.avatar?.kind === 'model3d')) {
      ensureShimejiLoop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buddies]);
  useEffect(() => () => {
    if (flightRafRef.current) cancelAnimationFrame(flightRafRef.current);
    cancelShimejiLoop();
    cancelPendulumLoop();
    for (const k of flightsRef.current.keys()) adapter.notifyDragEnd(`flight:${k}`);
    flightsRef.current.clear();
    pendulumsRef.current.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { buddiesRef.current = buddies; }, [buddies]);
  useEffect(() => { groupsRef.current = groups; }, [groups]);
  useEffect(() => { expandedRef.current = expanded; }, [expanded]);
  useEffect(() => { peekedRef.current = peeked; }, [peeked]);
  useEffect(() => { peekedDockRef.current = peekedDock; }, [peekedDock]);
  useEffect(() => { openBuddiesRef.current = openBuddies; }, [openBuddies]);
  useEffect(() => { wonderPausedBuddiesRef.current = wonderPausedBuddies; }, [wonderPausedBuddies]);
  const {
    openSetRef,
    updateBuddy,
    restoreBuddy,
    restoreGroup,
    spawnBuddy,
    removeBuddy,
    onOpenChange,
    onWonderPauseChange,
    ejectFromGroup,
  } = useBuddyActions({
    adapter,
    buddiesRef,
    groupsRef,
    idRef,
    setBuddies,
    setGroups,
    setOpenBuddies,
    setWonderPausedBuddies,
    setLlmOnboardingBuddyId,
  });
  useNativeTouchRegions({
    adapter,
    expanded,
    peeked,
    groups,
    expandedRef,
    openSetRef,
    onGroupTap,
    onGroupTapCollapse,
    collapseAllGroups,
  });

  const peekDockBuddy = (id: string) => {
    const b = buddiesRef.current.find((x) => x.id === id);
    if (!b?.minimized) return;
    setPeekedDock((cur) => (cur[`buddy:${id}`] ? cur : { ...cur, [`buddy:${id}`]: true }));
  };
  const unpeekDockBuddy = (id: string) => {
    const dragging: Set<string> | undefined = (window as { __vibebudDragging?: Set<string> }).__vibebudDragging;
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
    const dragging: Set<string> | undefined = (window as { __vibebudDragging?: Set<string> }).__vibebudDragging;
    if (dragging?.has(`group:${gid}`)) return;
    setPeekedDock((cur) => {
      if (!cur[`group:${gid}`]) return cur;
      const next = { ...cur };
      delete next[`group:${gid}`];
      return next;
    });
  };
  useDesktopGroupHover({
    adapter,
    buddiesRef,
    peekedRef,
    expandedRef,
    peekedDockRef,
    setPeeked,
    setExpanded,
    unpeekDockBuddy,
    unpeekDockGroup,
  });

  // Desktop tray "Settings…" menu item → open the app-wide settings modal.
  useEffect(() => {
    if (adapter.id !== 'electron') return;
    const electron = adapter as ElectronAdapter & { onOpenSettings?: (cb: () => void) => () => void };
    return electron.onOpenSettings?.(() => setAppSettingsOpen(true));
  }, [adapter]);

  const onDragMove = (id: string, pos: { x: number; y: number }) => {
    if (modeRef.current !== 'off') recordSample(`buddy:${id}`, pos);
    recordDragCursor(`buddy:${id}`, pos);
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
    const mode = modeRef.current;
    const key = `buddy:${id}`;
    const flingVel = mode !== 'off' ? consumeVelocity(key) : { x: 0, y: 0 };
    const flingSpeed = Math.hypot(flingVel.x, flingVel.y);
    const grab = grabOffsetsRef.current.get(key) ?? { x: 0, y: 0 };
    grabOffsetsRef.current.delete(key);
    lastDragSampleRef.current.delete(key);
    const flickAng = cross2(grab.x, grab.y, flingVel.x, flingVel.y) * RELEASE_TORQUE_GAIN;
    const ped = pendulumsRef.current.get(key);
    pendulumsRef.current.delete(key);
    const angVelRelease = rotationEnabledRef.current ? (flickAng + (ped?.angVel ?? 0)) : 0;
    const wantBouncyFling = mode === 'bouncy' && moved && flingSpeed >= FLING_THRESHOLD;
    const wantAstronautFling = mode === 'astronaut' && moved;
    // A drag commits the peek (in either direction); peekedDock tracks
    // hover-state only and shouldn't survive the drop.
    setPeekedDock((cur) => {
      const k = `buddy:${id}`;
      if (!cur[k]) return cur;
      const next = { ...cur }; delete next[k]; return next;
    });
    const easeRotIfNeeded = () => {
      if (mode === 'astronaut') return;
      setRotations((cur) => (cur[key] === 0 ? cur : { ...cur, [key]: 0 }));
      markRotActive(key, false);
    };
    if (!moved) { easeRotIfNeeded(); return; }
    const b = buddiesRef.current.find((x) => x.id === id);
    if (!b) { easeRotIfNeeded(); return; }
    if (b.groupId) {
      const g = groupsRef.current.find((x) => x.id === b.groupId);
      if (!g) { easeRotIfNeeded(); return; }
      const i = g.memberIds.indexOf(id);
      if (i < 0) { easeRotIfNeeded(); return; }
      const stride = expandedRef.current[g.id] ? EXPANDED_STRIDE : COLLAPSED_STRIDE;
      const target = slotPos(g, i, stride);
      setBuddies((cur) => cur.map((x) => (x.id === id ? { ...x, pos: target } : x)));
      easeRotIfNeeded();
      return;
    }
    // In astronaut mode, magnet-merge wins over fling: dropping near a
    // group / buddy should snap-merge, not bounce off. Compute now so we
    // can short-circuit the fling launch below.
    let astronautMergeG: Group | null = null;
    let astronautMergeB: AvatarInstanceState | null = null;
    if (mode === 'astronaut' && !b.minimized) {
      let bestD = MERGE_RADIUS;
      for (const g of groupsRef.current) {
        if (g.minimized) continue;
        const d = Math.hypot(g.pos.x - pos.x, g.pos.y - pos.y);
        if (d < bestD) { bestD = d; astronautMergeG = g; astronautMergeB = null; }
      }
      for (const other of buddiesRef.current) {
        if (other.id === id || other.groupId || other.minimized) continue;
        const d = Math.hypot(other.pos.x - pos.x, other.pos.y - pos.y);
        if (d < bestD) { bestD = d; astronautMergeB = other; astronautMergeG = null; }
      }
    }
    if ((wantBouncyFling || (wantAstronautFling && !astronautMergeG && !astronautMergeB)) && !b.minimized) {
      // Skip merge/edge-snap; let the integrator decide.
      const v = wantAstronautFling && flingSpeed < ASTRONAUT_DRIFT_SPEED
        ? randomDriftVel(ASTRONAUT_DRIFT_SPEED) // tiny release in astronaut still drifts
        : flingVel;
      startFlight('buddy', id, pos, v, angVelRelease);
      return;
    }
    // No flight launched → in calm/bouncy, glide rotation back to 0 (CSS
    // transition does the smoothing). Astronaut keeps its current rotation.
    if (mode !== 'astronaut') {
      setRotations((cur) => (cur[key] === 0 ? cur : { ...cur, [key]: 0 }));
      markRotActive(key, false);
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
      // Always level out the merged buddy so it sits upright in its slot,
      // even in astronaut mode.
      setRotations((cur) => (cur[key] === 0 ? cur : { ...cur, [key]: 0 }));
      markRotActive(key, false);
      return;
    }
    let bestB: AvatarInstanceState | null = null;
    let bestDB = MERGE_RADIUS;
    for (const other of buddiesRef.current) {
      if (other.id === id || other.groupId) continue;
      const d = Math.hypot(other.pos.x - pos.x, other.pos.y - pos.y);
      if (d < bestDB) { bestDB = d; bestB = other; }
    }
    if (bestB) {
      const target = bestB;
      const targetKey = `buddy:${target.id}`;
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
      // Both members enter the new group upright. Astronaut: stop the
      // target's flight too so it doesn't keep drifting away from the slot.
      flightsRef.current.delete(targetKey);
      adapter.notifyDragEnd(`flight:${targetKey}`);
      setRotations((cur) => {
        const next = { ...cur };
        if (next[key] !== 0) next[key] = 0;
        if (next[targetKey] !== 0) next[targetKey] = 0;
        return next;
      });
      markRotActive(key, false);
      markRotActive(targetKey, false);
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
    const mode = modeRef.current;
    const gKey = `group:${gid}`;
    // Always clear out drag-physics scratch state, even in calm mode where
    // we still seed the pendulum for gravity-driven rotation while held.
    const flingVel = consumeVelocity(gKey);
    const flingSpeed = Math.hypot(flingVel.x, flingVel.y);
    const grab = grabOffsetsRef.current.get(gKey) ?? { x: 0, y: 0 };
    grabOffsetsRef.current.delete(gKey);
    lastDragSampleRef.current.delete(gKey);
    const flickAng = cross2(grab.x, grab.y, flingVel.x, flingVel.y) * RELEASE_TORQUE_GAIN;
    const ped = pendulumsRef.current.get(gKey);
    pendulumsRef.current.delete(gKey);
    const angVelRelease = rotationEnabledRef.current ? (flickAng + (ped?.angVel ?? 0)) : 0;
    const wantFling = !g.minimized && (
      mode === 'astronaut'
      || (mode === 'bouncy' && flingSpeed >= FLING_THRESHOLD)
    );
    if (wantFling) {
      const v = (mode === 'astronaut' && flingSpeed < ASTRONAUT_DRIFT_SPEED)
        ? randomDriftVel(ASTRONAUT_DRIFT_SPEED)
        : flingVel;
      startFlight('group', gid, pos, v, angVelRelease);
      return;
    }
    if (mode !== 'astronaut') {
      setRotations((cur) => (cur[gKey] === 0 ? cur : { ...cur, [gKey]: 0 }));
      markRotActive(gKey, false);
    }
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
    if (modeRef.current !== 'off') recordSample(`group:${gid}`, pos);
    recordDragCursor(`group:${gid}`, pos);
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

  const teammatesFor = (b: AvatarInstanceState): Teammate[] => {
    if (!b.groupId) return [];
    const g = groups.find((x) => x.id === b.groupId);
    if (!g) return [];
    return g.memberIds
      .filter((mid) => mid !== b.id)
      .map((mid) => buddies.find((x) => x.id === mid))
      .filter((x): x is AvatarInstanceState => !!x)
      .map((mb) => {
        const p = PERSONALITY_BY_VARIANT[mb.variantId] ?? PERSONALITY_BY_VARIANT.violet;
        return { name: p.name, role: p.role };
      });
  };

  return (
    <>
      <DashboardStage
        buddies={buddies}
        groups={groups}
        peeked={peeked}
        expanded={expanded}
        peekedDock={peekedDock}
        magnet={magnet}
        edgeMagnet={edgeMagnet}
        bumpTicks={bumpTicks}
        rotationEnabled={rotationEnabled}
        rotations={rotations}
        activeRotKeys={activeRotKeys}
        grabPivots={grabPivots}
        shimejiActions={shimejiActions}
        shimejiDirections={shimejiDirections}
        llmOnboardingBuddyId={llmOnboardingBuddyId}
        teammatesFor={teammatesFor}
        updateBuddy={updateBuddy}
        spawnBuddy={spawnBuddy}
        removeBuddy={removeBuddy}
        onOpenChange={onOpenChange}
        onWonderPauseChange={onWonderPauseChange}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onGroupTap={onGroupTap}
        restoreBuddy={restoreBuddy}
        restoreGroup={restoreGroup}
        peekDockBuddy={peekDockBuddy}
        unpeekDockBuddy={unpeekDockBuddy}
        peekDockGroup={peekDockGroup}
        unpeekDockGroup={unpeekDockGroup}
        onBuddyDragStart={onBuddyDragStart}
        onGroupDragStartPhysics={onGroupDragStartPhysics}
        onGroupDragMove={onGroupDragMove}
        onGroupDragEnd={onGroupDragEnd}
        onOpenAppSettings={() => setAppSettingsOpen(true)}
        onDismissLlmOnboarding={(id) => setLlmOnboardingBuddyId((current) => (current === id ? null : current))}
      />
      <DashboardChrome
        adapter={adapter}
        isAndroidOverlay={isAndroidOverlay}
        appSettingsOpen={appSettingsOpen}
        onOpenSettings={() => setAppSettingsOpen(true)}
        onCloseSettings={() => setAppSettingsOpen(false)}
      />
      <DashboardStyles />
    </>
  );
}
