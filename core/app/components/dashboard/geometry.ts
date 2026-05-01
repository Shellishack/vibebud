import { VARIANTS } from '../avatars';
import { getPersonality } from '../personalities';
import {
  ANCHOR,
  AVATAR_SIZE,
  COLLAPSED_STRIDE,
  EXPANDED_STRIDE,
  HULL_PAD_TOP,
  STACK_STRIDE,
} from './constants';
import type { Edge, Group } from './types';

const HULL_LIGHTEN = 0.55;
const HULL_ALPHA = 0.85;

const rgba = (rgb: [number, number, number], a: number, lighten = 0) => {
  const mix = (c: number) => c + (1 - c) * lighten;
  return `rgba(${Math.round(mix(rgb[0]) * 255)}, ${Math.round(mix(rgb[1]) * 255)}, ${Math.round(mix(rgb[2]) * 255)}, ${a})`;
};

export const gradientFor = (variantIds: string[]) => {
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

export const isHorizontalEdge = (edge: Edge) => edge === 'left' || edge === 'right';

export const viewportSize = () => {
  if (typeof window === 'undefined') return { w: 0, h: 0 };
  const vv = window.visualViewport;
  return { w: vv?.width ?? window.innerWidth, h: vv?.height ?? window.innerHeight };
};

export const nearestEdgeForBuddy = (pos: { x: number; y: number }) => {
  const { w, h } = viewportSize();
  const right = ANCHOR.right - pos.x;
  const left = w - ANCHOR.right - AVATAR_SIZE + pos.x;
  const bottom = ANCHOR.bottom - pos.y;
  const top = h - ANCHOR.bottom - AVATAR_SIZE + pos.y;
  const dists: Array<{ edge: Edge; d: number }> = [
    { edge: 'left', d: left },
    { edge: 'right', d: right },
    { edge: 'top', d: top },
    { edge: 'bottom', d: bottom },
  ];
  dists.sort((a, b) => a.d - b.d);
  return dists[0];
};

export const minimizedBuddyPos = (edge: Edge, lastFree?: { x: number; y: number }) => {
  const { w, h } = viewportSize();
  const half = AVATAR_SIZE / 2;
  switch (edge) {
    case 'left': return { x: ANCHOR.right + AVATAR_SIZE - w - half, y: lastFree?.y ?? 0 };
    case 'right': return { x: ANCHOR.right + half, y: lastFree?.y ?? 0 };
    case 'top': return { x: lastFree?.x ?? 0, y: ANCHOR.bottom + AVATAR_SIZE - h - half };
    case 'bottom': return { x: lastFree?.x ?? 0, y: ANCHOR.bottom + half };
  }
};

export const nearestEdgeForGroup = (pos: { x: number; y: number }, memberCount: number) => {
  const { w, h } = viewportSize();
  const groupW = (memberCount - 1) * COLLAPSED_STRIDE + AVATAR_SIZE;
  const groupH = AVATAR_SIZE;
  const rightmost = pos.x + (memberCount - 1) * COLLAPSED_STRIDE;
  const right = ANCHOR.right - rightmost;
  const left = w - ANCHOR.right - AVATAR_SIZE + pos.x;
  const bottom = ANCHOR.bottom - pos.y;
  const top = h - ANCHOR.bottom - groupH + pos.y;
  const dists: Array<{ edge: Edge; d: number }> = [
    { edge: 'left', d: left },
    { edge: 'right', d: right },
    { edge: 'top', d: top },
    { edge: 'bottom', d: bottom },
  ];
  dists.sort((a, b) => a.d - b.d);
  return { ...dists[0], groupW, groupH };
};

export const peekedBuddyPos = (edge: Edge, lastFree?: { x: number; y: number }) => {
  const { w, h } = viewportSize();
  const PAD = -16;
  switch (edge) {
    case 'left': return { x: -(w - ANCHOR.right - AVATAR_SIZE - PAD), y: lastFree?.y ?? 0 };
    case 'right': return { x: ANCHOR.right - PAD, y: lastFree?.y ?? 0 };
    case 'top': return { x: lastFree?.x ?? 0, y: -(h - ANCHOR.bottom - AVATAR_SIZE - PAD) };
    case 'bottom': return { x: lastFree?.x ?? 0, y: ANCHOR.bottom - PAD };
  }
};

export const peekedGroupPos = (
  edge: Edge,
  n: number,
  lastFree: { x: number; y: number } | undefined,
  stride: number = COLLAPSED_STRIDE,
) => {
  const { w, h } = viewportSize();
  const EDGE_GAP = -16;
  switch (edge) {
    case 'left': return { x: -(w - ANCHOR.right - AVATAR_SIZE - EDGE_GAP), y: lastFree?.y ?? 0 };
    case 'right': return { x: (ANCHOR.right - EDGE_GAP) - (n - 1) * stride, y: lastFree?.y ?? 0 };
    case 'top': return { x: lastFree?.x ?? 0, y: -(h - ANCHOR.bottom - AVATAR_SIZE - EDGE_GAP) };
    case 'bottom': return { x: lastFree?.x ?? 0, y: ANCHOR.bottom - EDGE_GAP };
  }
};

export const minimizedGroupPos = (edge: Edge, memberCount: number, lastFree?: { x: number; y: number }) => {
  const { w, h } = viewportSize();
  const half = AVATAR_SIZE / 2;
  switch (edge) {
    case 'left': return { x: ANCHOR.right + AVATAR_SIZE - w - half, y: lastFree?.y ?? 0 };
    case 'right': return { x: ANCHOR.right + half - (memberCount - 1) * STACK_STRIDE, y: lastFree?.y ?? 0 };
    case 'top': return { x: lastFree?.x ?? 0, y: ANCHOR.bottom + AVATAR_SIZE - h - half };
    case 'bottom': return { x: lastFree?.x ?? 0, y: ANCHOR.bottom + half };
  }
};

export const slotPos = (group: Group, index: number, stride: number) => ({
  x: group.pos.x + index * stride,
  y: group.pos.y,
});

export const clampBuddyPos = (candidate: { x: number; y: number }) => {
  if (typeof window === 'undefined') return candidate;
  const vv = window.visualViewport;
  const viewportW = vv?.width ?? window.innerWidth;
  const viewportH = vv?.height ?? window.innerHeight;
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

export const clampGroupPos = (
  candidate: { x: number; y: number },
  memberCount: number,
  stride: number = COLLAPSED_STRIDE,
) => {
  if (typeof window === 'undefined') return candidate;
  const viewportW = window.innerWidth;
  const EDGE_GAP = -16;
  const minX = -(viewportW - ANCHOR.right - AVATAR_SIZE - EDGE_GAP);
  const maxXRaw = (ANCHOR.right - EDGE_GAP) - (memberCount - 1) * stride;
  const maxX = Math.max(minX, maxXRaw);
  const x = Math.min(maxX, Math.max(minX, candidate.x));
  const viewportH = window.innerHeight;
  const minY = -(viewportH - ANCHOR.bottom - AVATAR_SIZE - HULL_PAD_TOP - 8);
  const maxY = 0;
  const y = Math.min(maxY, Math.max(minY, candidate.y));
  return { x, y };
};
