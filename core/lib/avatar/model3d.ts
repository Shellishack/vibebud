import type { InstalledModel3D, Model3DAvatar } from './types';
import { readZip } from './zip';

const DB_NAME = 'vibebud-model3d';
const STORE = 'models';
const MODEL_EVENT = 'vibebud:model3dChanged';
const MAX_MODEL_BYTES = 80 * 1024 * 1024;
const MAX_ZIP_BYTES = 200 * 1024 * 1024;
const textDecoder = new TextDecoder();

const bundledModels: InstalledModel3D[] = [
  {
    source: 'bundled',
    installedAt: 0,
    license: 'Three.js example asset',
    avatar: {
      kind: 'model3d',
      id: 'robot-expressive',
      name: 'Robot GLB',
      modelSrc: '/model3d/RobotExpressive.glb',
      modelFormat: 'glb',
      scale: 1.25,
      yOffset: -0.9,
      cameraZ: 4.8,
      animations: {
        idle: ['Idle', 'Standing'],
        walk: ['Walking', 'Walk'],
        fall: ['Death', 'Jump', 'Falling'],
        sit: ['Sitting', 'Idle'],
        drag: ['Idle'],
      },
    },
  },
];

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 4);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'avatar.id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB failed.'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>, storeName = STORE): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed.'));
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('IndexedDB transaction failed.'));
    };
  });
}

function changed() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(MODEL_EVENT));
}

function modelToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read imported model.'));
    reader.readAsDataURL(file);
  });
}

function bytesToDataUrl(bytes: Uint8Array, type: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read imported model asset.'));
    const copy = new Uint8Array(bytes);
    reader.readAsDataURL(new Blob([copy], { type }));
  });
}

const cleanPath = (path: string) => path.replace(/^\.?\//, '').replace(/\\/g, '/');

function dirname(path: string): string {
  const clean = cleanPath(path);
  const index = clean.lastIndexOf('/');
  return index >= 0 ? clean.slice(0, index + 1) : '';
}

function resolveZipPath(baseDir: string, uri: string): string {
  const parts = `${baseDir}${uri}`.replace(/\\/g, '/').split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  }
  return resolved.join('/');
}

function mimeForPath(path: string): string {
  const ext = path.match(/\.([^.?#]+)$/)?.[1]?.toLowerCase();
  if (ext === 'bin') return 'application/octet-stream';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'ktx2') return 'image/ktx2';
  return 'application/octet-stream';
}

function isExternalUri(uri: string): boolean {
  return !/^data:/i.test(uri) && !/^[a-z][a-z0-9+.-]*:/i.test(uri);
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeModelId(name: string): string {
  const slug = name.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return `${slug || 'imported-model'}-${Date.now().toString(36)}`;
}

function titleFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Imported Model';
}

function formatFromFileName(name: string): Model3DAvatar['modelFormat'] {
  const ext = name.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
  if (ext === 'glb' || ext === 'gltf' || ext === 'fbx' || ext === 'obj') return ext;
  return undefined;
}

function clipNamesFromGltfJson(input: unknown): string[] {
  const animations = (input as { animations?: Array<{ name?: string }> })?.animations;
  if (!Array.isArray(animations)) return [];
  return animations.map((animation, index) => animation.name?.trim() || `Animation ${index + 1}`);
}

export function bundledModel3DAvatars(): Model3DAvatar[] {
  return bundledModels.map((model) => model.avatar);
}

export function model3DAnimationReadiness(avatar: Model3DAvatar): 'unknown' | 'ready' | 'no-skeleton' | 'non-humanoid' {
  if (!avatar.skeleton) return 'unknown';
  if (!avatar.skeleton.hasSkeleton) return 'no-skeleton';
  if (!avatar.skeleton.humanoid) return 'non-humanoid';
  return 'ready';
}

export async function listModel3D(): Promise<InstalledModel3D[]> {
  if (typeof indexedDB === 'undefined') return bundledModels;
  try {
    const stored = await withStore<InstalledModel3D[]>('readonly', (store) => store.getAll());
    const byId = new Map<string, InstalledModel3D>();
    for (const model of bundledModels) byId.set(model.avatar.id, model);
    for (const model of stored) byId.set(model.avatar.id, model);
    return Array.from(byId.values()).sort((a, b) => a.avatar.name.localeCompare(b.avatar.name));
  } catch {
    return bundledModels;
  }
}

export async function importModel3D(file: File): Promise<InstalledModel3D> {
  if (/\.zip$/i.test(file.name)) return importModel3DZip(file);
  const format = formatFromFileName(file.name);
  if (!format || !['glb', 'gltf', 'fbx', 'obj'].includes(format)) throw new Error('Import a self-contained GLB, GLTF, FBX, OBJ, or ZIP model package.');
  if (file.size > MAX_MODEL_BYTES) throw new Error(`Model is too large (${formatBytes(file.size)}). Limit is ${formatBytes(MAX_MODEL_BYTES)}.`);
  const model: InstalledModel3D = {
    source: 'imported',
    installedAt: Date.now(),
    avatar: {
      kind: 'model3d',
      id: safeModelId(file.name),
      name: titleFromFileName(file.name),
      modelSrc: await modelToDataUrl(file),
      modelFormat: format,
    },
  };
  await withStore('readwrite', (store) => store.put(model));
  changed();
  return model;
}

async function importModel3DZip(file: File): Promise<InstalledModel3D> {
  if (file.size > MAX_ZIP_BYTES) throw new Error(`ZIP is too large (${formatBytes(file.size)}). Limit is ${formatBytes(MAX_ZIP_BYTES)}.`);
  const entries = await readZip(file);
  const paths = Object.keys(entries);
  const gltfPath = paths.find((path) => /\.gltf$/i.test(path) && /(^|\/)(scene|model)\.gltf$/i.test(path))
    ?? paths.find((path) => /\.gltf$/i.test(path));
  const glbPath = paths.find((path) => /\.glb$/i.test(path) && /(^|\/)(scene|model)\.glb$/i.test(path))
    ?? paths.find((path) => /\.glb$/i.test(path));

  if (gltfPath) {
    const json = JSON.parse(textDecoder.decode(entries[gltfPath])) as {
      animations?: Array<{ name?: string }>;
      buffers?: Array<{ uri?: string }>;
      images?: Array<{ uri?: string }>;
    };
    const baseDir = dirname(gltfPath);
    for (const buffer of json.buffers ?? []) {
      if (!buffer.uri || !isExternalUri(buffer.uri)) continue;
      const path = resolveZipPath(baseDir, buffer.uri);
      const bytes = entries[path];
      if (!bytes) throw new Error(`ZIP is missing GLTF buffer: ${buffer.uri}`);
      buffer.uri = await bytesToDataUrl(bytes, 'application/octet-stream');
    }
    for (const image of json.images ?? []) {
      if (!image.uri || !isExternalUri(image.uri)) continue;
      const path = resolveZipPath(baseDir, image.uri);
      const bytes = entries[path];
      if (!bytes) throw new Error(`ZIP is missing GLTF image: ${image.uri}`);
      image.uri = await bytesToDataUrl(bytes, mimeForPath(path));
    }

    const model: InstalledModel3D = {
      source: 'imported',
      installedAt: Date.now(),
      avatar: {
        kind: 'model3d',
        id: safeModelId(file.name),
        name: titleFromFileName(file.name),
        modelSrc: `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(json))}`,
        modelFormat: 'gltf',
        availableAnimations: clipNamesFromGltfJson(json),
      },
    };
    await withStore('readwrite', (store) => store.put(model));
    changed();
    return model;
  }

  if (glbPath) {
    const model: InstalledModel3D = {
      source: 'imported',
      installedAt: Date.now(),
      avatar: {
        kind: 'model3d',
        id: safeModelId(file.name),
        name: titleFromFileName(file.name),
        modelSrc: await bytesToDataUrl(entries[glbPath], 'model/gltf-binary'),
        modelFormat: 'glb',
      },
    };
    await withStore('readwrite', (store) => store.put(model));
    changed();
    return model;
  }

  throw new Error('ZIP must contain a GLTF or GLB model.');
}

export async function updateModel3DAvatar(avatar: Model3DAvatar): Promise<void> {
  if (bundledModels.some((model) => model.avatar.id === avatar.id)) return;
  const existing = await withStore<InstalledModel3D | undefined>('readonly', (store) => store.get(avatar.id));
  if (!existing) return;
  await withStore('readwrite', (store) => store.put({ ...existing, avatar }));
  changed();
}

export async function removeModel3D(id: string): Promise<void> {
  if (bundledModels.some((model) => model.avatar.id === id)) return;
  await withStore('readwrite', (store) => store.delete(id));
  changed();
}

export function subscribeModel3D(cb: () => void): () => void {
  window.addEventListener(MODEL_EVENT, cb);
  return () => window.removeEventListener(MODEL_EVENT, cb);
}
