export type ShimejiAction = 'idle' | 'walk' | 'climb' | 'fall' | 'sit' | 'drag';
export type Model3DAction = 'idle' | 'walk' | 'climb' | 'fall' | 'sit' | 'drag';

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

export type Model3DAvatar = {
  kind: 'model3d';
  id: string;
  name: string;
  modelSrc: string;
  modelFormat?: 'glb' | 'gltf' | 'fbx' | 'obj';
  scale?: number;
  xOffset?: number;
  yOffset?: number;
  zOffset?: number;
  cameraZ?: number;
  fpsLimit?: number;
  availableAnimations?: string[];
  skeleton?: {
    hasSkeleton: boolean;
    humanoid: boolean;
    bones: string[];
  };
  animations?: Partial<Record<Model3DAction, string[]>>;
};

export type InstalledModel3D = {
  avatar: Model3DAvatar;
  source: 'bundled' | 'catalog' | 'imported';
  license?: string;
  author?: string;
  description?: string;
  installedAt: number;
};

export type AvatarSelection =
  | { kind: 'noto'; group: string; composition?: unknown }
  | ShimejiAvatar
  | Model3DAvatar;
