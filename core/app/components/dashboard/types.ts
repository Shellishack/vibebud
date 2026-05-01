import type { AvatarInstanceState } from '../avatar/avatar-instance.types';

export type Edge = 'left' | 'right' | 'top' | 'bottom';
export type EdgeDock = { edge: Edge };

export type Group = {
  id: string;
  memberIds: string[];
  pos: { x: number; y: number };
  minimized?: EdgeDock;
  lastFreePos?: { x: number; y: number };
};

export type Persisted = { buddies: AvatarInstanceState[]; groups: Group[] };
