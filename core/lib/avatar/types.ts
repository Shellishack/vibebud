export type ShimejiAction = 'idle' | 'walk' | 'climb' | 'fall' | 'sit' | 'drag';

export type ShimejiAnimation = {
  src: string;
  frames: number;
  fps: number;
  loop?: boolean;
};

export type ShimejiCharacter = {
  id: string;
  name: string;
  preview: string;
  frameSize: { w: number; h: number };
  scale?: number;
  anchor?: { x: number; y: number };
  animations: Partial<Record<ShimejiAction, ShimejiAnimation>>;
};

export type ShimejiPackManifest = {
  schemaVersion: 1;
  id: string;
  name: string;
  license: string;
  author?: string;
  description?: string;
  characters: ShimejiCharacter[];
};

export type InstalledShimejiPack = {
  manifest: ShimejiPackManifest;
  source: 'bundled' | 'catalog' | 'imported';
  baseUrl?: string;
  files?: Record<string, string>;
  installedAt: number;
};

export type ShimejiAvatar = {
  kind: 'shimeji';
  packId: string;
  characterId?: string;
};

export type AvatarSelection =
  | { kind: 'noto'; group: string; composition?: unknown }
  | ShimejiAvatar;
