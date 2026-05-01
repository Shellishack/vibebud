'use client';

import { useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { PlatformAdapter } from '@/lib/platform/types';
import type { AvatarInstanceState } from '../../app/components/avatar/avatar-instance.types';
import {
  DRAG_ROT_DAMPING,
  DRAG_ROT_FORCE_GAIN,
  DRAG_ROT_MIN_ARM,
  GRAVITY_ACCEL,
  MAX_ANG_VEL,
  PENDULUM_MIN_GRAB,
  type PhysicsMode,
  type Vec2,
} from '../../app/components/physics';
import type { Group } from '../../app/components/dashboard/types';

type Flight = { kind: 'buddy' | 'group'; id: string; pos: Vec2; vel: Vec2; rot: number; angVel: number };
type PendulumState = {
  rot: number;
  angVel: number;
  grab: Vec2;
  history: Array<{ t: number; pos: Vec2 }>;
  lastT: number;
};

type Options = {
  adapter: PlatformAdapter;
  modeRef: MutableRefObject<PhysicsMode>;
  rotationEnabledRef: MutableRefObject<boolean>;
  rotationsRef: MutableRefObject<Record<string, number>>;
  setRotations: Dispatch<SetStateAction<Record<string, number>>>;
  setGrabPivots: Dispatch<SetStateAction<Record<string, Vec2>>>;
  grabOffsetsRef: MutableRefObject<Map<string, Vec2>>;
  lastDragSampleRef: MutableRefObject<Map<string, { t: number; x: number; y: number }>>;
  flightsRef: MutableRefObject<Map<string, Flight>>;
  buddiesRef: MutableRefObject<AvatarInstanceState[]>;
  groupsRef: MutableRefObject<Group[]>;
  markRotActive: (key: string, active: boolean) => void;
};

export function useDragRotation({
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
}: Options) {
  const pendulumsRef = useRef<Map<string, PendulumState>>(new Map());
  const pendulumRafRef = useRef<number>(0);

  const pendulumTick = () => {
    pendulumRafRef.current = 0;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const peds = pendulumsRef.current;
    if (peds.size === 0) return;
    const mode = modeRef.current;
    const updatedRot: Record<string, number> = {};
    for (const [key, p] of peds) {
      const dtRaw = Math.min(48, Math.max(1, now - p.lastT));
      p.lastT = now;
      let ax = 0, ay = 0;
      const h = p.history;
      if (h.length >= 3) {
        const a = h[h.length - 3], b = h[h.length - 2], c = h[h.length - 1];
        const dt1 = b.t - a.t;
        const dt2 = c.t - b.t;
        if (dt1 > 0 && dt2 > 0) {
          const v1x = (b.pos.x - a.pos.x) / dt1;
          const v1y = (b.pos.y - a.pos.y) / dt1;
          const v2x = (c.pos.x - b.pos.x) / dt2;
          const v2y = (c.pos.y - b.pos.y) / dt2;
          const dtMid = (dt1 + dt2) / 2;
          ax = (v2x - v1x) / dtMid;
          ay = (v2y - v1y) / dtMid;
        }
      }
      if (h.length > 0 && now - h[h.length - 1].t > 80) {
        ax = 0; ay = 0;
      }
      let Fx = -ax * DRAG_ROT_FORCE_GAIN;
      let Fy = -ay * DRAG_ROT_FORCE_GAIN;
      if (mode !== 'astronaut') Fy += GRAVITY_ACCEL;
      const dampPerMs = mode === 'astronaut' ? 0 : DRAG_ROT_DAMPING;
      const subDt = dtRaw / 4;
      for (let i = 0; i < 4; i++) {
        const theta = p.rot * Math.PI / 180;
        const cs = Math.cos(theta), sn = Math.sin(theta);
        const rx = -(p.grab.x * cs - p.grab.y * sn);
        const ry = -(p.grab.x * sn + p.grab.y * cs);
        const r2 = rx * rx + ry * ry;
        if (r2 >= DRAG_ROT_MIN_ARM * DRAG_ROT_MIN_ARM) {
          const alphaDeg = ((rx * Fy - ry * Fx) / r2) * (180 / Math.PI);
          p.angVel += alphaDeg * subDt;
        }
        if (dampPerMs > 0) p.angVel *= Math.exp(-dampPerMs * subDt);
        p.angVel = Math.max(-MAX_ANG_VEL, Math.min(MAX_ANG_VEL, p.angVel));
        p.rot += p.angVel * subDt;
      }
      updatedRot[key] = p.rot;
    }
    if (Object.keys(updatedRot).length) setRotations((cur) => ({ ...cur, ...updatedRot }));
    pendulumRafRef.current = requestAnimationFrame(pendulumTick);
  };

  const ensurePendulumLoop = () => {
    if (pendulumRafRef.current) return;
    pendulumRafRef.current = requestAnimationFrame(pendulumTick);
  };

  const seedPendulum = (key: string, grab: Vec2, startPos?: Vec2) => {
    if (!rotationEnabledRef.current) return;
    if (Math.hypot(grab.x, grab.y) < PENDULUM_MIN_GRAB) return;
    const t = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    pendulumsRef.current.set(key, {
      rot: rotationsRef.current[key] ?? 0,
      angVel: 0,
      grab: { ...grab },
      history: startPos ? [{ t, pos: { ...startPos } }] : [],
      lastT: t,
    });
    ensurePendulumLoop();
  };

  const onBuddyDragStart = (id: string, grab: Vec2) => {
    const key = `buddy:${id}`;
    grabOffsetsRef.current.set(key, grab);
    lastDragSampleRef.current.delete(key);
    setGrabPivots((cur) => ({ ...cur, [key]: grab }));
    if (flightsRef.current.has(key)) {
      flightsRef.current.delete(key);
      adapter.notifyDragEnd(`flight:${key}`);
    }
    const b0 = buddiesRef.current.find((x) => x.id === id);
    seedPendulum(key, grab, b0?.pos);
    markRotActive(key, true);
  };

  const onGroupDragStartPhysics = (gid: string, grab: Vec2) => {
    const key = `group:${gid}`;
    grabOffsetsRef.current.set(key, grab);
    lastDragSampleRef.current.delete(key);
    setGrabPivots((cur) => ({ ...cur, [key]: grab }));
    if (flightsRef.current.has(key)) {
      flightsRef.current.delete(key);
      adapter.notifyDragEnd(`flight:${key}`);
    }
    const g0 = groupsRef.current.find((x) => x.id === gid);
    seedPendulum(key, grab, g0?.pos);
    markRotActive(key, true);
  };

  const recordDragCursor = (key: string, pos: Vec2) => {
    const ped = pendulumsRef.current.get(key);
    if (!ped) return;
    const t = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    ped.history.push({ t, pos: { x: pos.x, y: pos.y } });
    while (ped.history.length > 6) ped.history.shift();
  };

  const cancelPendulumLoop = () => {
    if (pendulumRafRef.current) cancelAnimationFrame(pendulumRafRef.current);
    pendulumRafRef.current = 0;
  };

  return {
    pendulumsRef,
    cancelPendulumLoop,
    onBuddyDragStart,
    onGroupDragStartPhysics,
    recordDragCursor,
  };
}
