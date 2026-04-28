// Drag physics: localStorage-backed mode + small pure helpers.
// The integrator and per-buddy/group flight state lives in Buddy.tsx, where
// cross-body collision detection has natural access to all bodies.

const MODE_KEY = 'vibemoji.physics.mode.v1';
const LEGACY_KEY = 'vibemoji.physics.v1';

export type PhysicsMode = 'off' | 'bouncy' | 'astronaut';
const ALL_MODES: PhysicsMode[] = ['off', 'bouncy', 'astronaut'];

export function getPhysicsMode(): PhysicsMode {
  if (typeof window === 'undefined') return 'bouncy';
  try {
    const m = localStorage.getItem(MODE_KEY) as PhysicsMode | null;
    if (m && ALL_MODES.includes(m)) return m;
    // Migration from the v1 boolean toggle.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === '0') return 'off';
    return 'bouncy';
  } catch { return 'bouncy'; }
}

export function setPhysicsMode(m: PhysicsMode) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(MODE_KEY, m); } catch { /* noop */ }
  window.dispatchEvent(new CustomEvent<PhysicsMode>('vibemoji:physicsChange', { detail: m }));
}

// Back-compat for callers still using the boolean toggle.
export function getPhysicsEnabled(): boolean { return getPhysicsMode() !== 'off'; }
export function setPhysicsEnabled(v: boolean) { setPhysicsMode(v ? 'bouncy' : 'off'); }

export type Vec2 = { x: number; y: number };

// Velocity threshold (px/ms) above which a drag-release becomes a fling
// in bouncy mode. Below this, the existing snap-to-edge / merge logic owns
// the drop. Astronaut mode launches a flight on every release.
export const FLING_THRESHOLD = 0.35;
export const REST_THRESHOLD = 0.05;
export const FLIGHT_DRAG = 0.985;
export const EDGE_RESTITUTION = 0.72;
export const COLLIDE_RESTITUTION = 0.6;
export const VELOCITY_WINDOW_MS = 90;
export const MAX_FLING = 3.0;

// --- Astronaut mode tuning ---
// Targets a slow zero-g drift that never decays. Low restitution loss + a
// random nudge floor keeps every body moving without ramping up to chaos.
export const ASTRONAUT_DRAG = 1.0;
export const ASTRONAUT_EDGE_RESTITUTION = 1.0;
export const ASTRONAUT_COLLIDE_RESTITUTION = 0.95;
// Initial drift speed for a freshly-seeded floating body (px/ms).
export const ASTRONAUT_DRIFT_SPEED = 0.07;
// Initial spin for a freshly-seeded floating body (deg/ms, ~30 deg/sec).
export const ASTRONAUT_DRIFT_SPIN = 0.03;

// --- Rotational physics ---
// Angular drag per frame in bouncy mode (decays spin to a stop).
export const ANG_DRAG = 0.985;
// Angular rest threshold (deg/ms) — below this, spin halts.
export const ANG_REST_THRESHOLD = 0.005;
// On release, derive angular velocity from (r × v) where v is in px/ms.
// Tuned so a fast frisbee-style flick from the rim produces a brisk
// (a couple of revolutions) spin.
export const RELEASE_TORQUE_GAIN = 0.012; // (deg/ms) per (px * px/ms)
// Hard cap on angular velocity (deg/ms) to keep spin from looking strobed.
export const MAX_ANG_VEL = 1.4;

// --- Drag-time rotation (rigid body on a string under three forces) ---
// While dragging in any mode, the cursor is the pivot. The avatar's center
// of mass swings around it driven by:
//   1. Gravity            — only when not astronaut.
//   2. Linear pseudo-force — when the cursor accelerates, the body's CoM
//                            inertia produces a force in the opposite
//                            direction of cursor acceleration.
//   3. Centripetal pseudo-force — when the cursor curves, the off-axis
//                                 component of cursor acceleration shows
//                                 up here automatically. (It's the same
//                                 vector as #2, decomposed differently;
//                                 we don't need to compute it explicitly.)
// Gravity in screen px/ms². Strong enough to bring the avatar back to
// upright quickly, light enough that it overshoots and swings a few times.
export const GRAVITY_ACCEL = 0.0024;
// Per-ms exponential damping on angular velocity. Low value → noticeable
// oscillation when the user stops moving (the body swings around the
// cursor for a beat before settling).
export const DRAG_ROT_DAMPING = 0.0025;
// Multiplier on the cursor-acceleration pseudo-force. 1.0 = unit mass.
export const DRAG_ROT_FORCE_GAIN = 1.0;
// Min |r| (CSS px) for which we trust the torque/inertia calculation —
// below this the lever arm is too short and dynamics blow up at the pivot.
export const DRAG_ROT_MIN_ARM = 8;
// Below this grab radius (CSS px), drag-rotation is skipped entirely — a
// near-center grab would have ambiguous equilibrium and just jitter.
export const PENDULUM_MIN_GRAB = 6;
// Easing duration (ms) used to glide rotation back to 0 once a non-astronaut
// body settles (or a calm-mode drag releases without a fling).
export const ROTATION_EASE_MS = 420;

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

// Random unit vector × magnitude (uniform direction).
export function randomDriftVel(speed: number): Vec2 {
  const a = Math.random() * Math.PI * 2;
  return { x: Math.cos(a) * speed, y: Math.sin(a) * speed };
}

// Random spin in deg/ms, ± magnitude.
export function randomDriftSpin(magnitude: number): number {
  return (Math.random() * 2 - 1) * magnitude;
}

// 2D scalar cross product (rx*vy - ry*vx). Sign indicates rotation direction.
export function cross2(rx: number, ry: number, vx: number, vy: number): number {
  return rx * vy - ry * vx;
}
