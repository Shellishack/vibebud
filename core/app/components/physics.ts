// Bouncy-drag physics: small pure helpers + a localStorage-backed toggle.
// The integrator and per-buddy/group flight state lives in Buddy.tsx, where
// cross-body collision detection has natural access to all bodies.

const PHYSICS_KEY = 'vibemoji.physics.v1';

export function getPhysicsEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const v = localStorage.getItem(PHYSICS_KEY);
    return v === null ? true : v === '1';
  } catch { return true; }
}

export function setPhysicsEnabled(v: boolean) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(PHYSICS_KEY, v ? '1' : '0'); } catch { /* noop */ }
  window.dispatchEvent(new CustomEvent<boolean>('vibemoji:physicsChange', { detail: v }));
}

export type Vec2 = { x: number; y: number };

// Velocity threshold (px/ms) above which a drag-release becomes a fling.
// Below this, the existing snap-to-edge / merge logic keeps owning drop.
export const FLING_THRESHOLD = 0.35;
// Velocity (px/ms) at which a flight is considered settled and stops.
export const REST_THRESHOLD = 0.05;
// Per-frame multiplicative drag — light enough that a fling crosses the
// screen and bounces a couple of times before resting.
export const FLIGHT_DRAG = 0.985;
// Restitution coefficients: how much speed is preserved after a bounce.
export const EDGE_RESTITUTION = 0.72;
export const COLLIDE_RESTITUTION = 0.6;
// Sample window for drag-velocity computation (ms). Short enough to ignore
// the slow-down a user does just before releasing, long enough to be stable.
export const VELOCITY_WINDOW_MS = 90;
// Hard cap on velocity magnitude (px/ms) — protects against jittery samples.
export const MAX_FLING = 3.0;

// AABB overlap on two boxes given as top-left + size. Returns null if no
// overlap, else the smaller-overlap axis and depth (for separation).
export type Box = { x: number; y: number; w: number; h: number };
export function bboxOverlap(a: Box, b: Box): { axis: 'x' | 'y'; depth: number } | null {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (ox <= 0 || oy <= 0) return null;
  return ox < oy ? { axis: 'x', depth: ox } : { axis: 'y', depth: oy };
}

export function clampMag(v: Vec2, max: number): Vec2 {
  const m = Math.hypot(v.x, v.y);
  if (m <= max || m === 0) return v;
  const k = max / m;
  return { x: v.x * k, y: v.y * k };
}
