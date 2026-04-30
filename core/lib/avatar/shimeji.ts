import type { InstalledShimejiPack, ShimejiAction, ShimejiCharacter, ShimejiPackManifest } from './types';
import { readZip } from './zip';

const DB_NAME = 'vibebud-shimeji';
const STORE = 'packs';
const CATALOG_URL = process.env.NEXT_PUBLIC_SHIMEJI_CATALOG_URL || '/shimeji/catalog.json';
const MARKETPLACE_URL = process.env.NEXT_PUBLIC_SHIMEJI_MARKETPLACE_URL || CATALOG_URL;
const PACK_EVENT = 'vibebud:shimejiPacksChanged';
const REQUIRED_ACTIONS: ShimejiAction[] = ['idle', 'walk', 'climb', 'fall', 'sit', 'drag'];
const MAX_ZIP_BYTES = 12 * 1024 * 1024;
const textDecoder = new TextDecoder();

type CatalogPack = {
  manifest: ShimejiPackManifest;
  baseUrl: string;
};

const bundledPack: InstalledShimejiPack = {
  source: 'bundled',
  baseUrl: '/shimeji/sample-bean/',
  installedAt: 0,
  manifest: {
    schemaVersion: 1,
    id: 'sample-bean',
    name: 'Sample Bean',
    license: 'CC0-1.0',
    author: 'Vibebud',
    description: 'A self-authored royalty-free sample Shimeji character with clear action poses.',
    characters: [{
      id: 'default',
      name: 'Sample Bean',
      preview: 'preview.svg',
      frameSize: { w: 128, h: 128 },
      scale: 1,
      anchor: { x: 64, y: 112 },
      animations: {
        idle: { src: 'idle.svg', frames: 4, fps: 5, loop: true },
        walk: { src: 'walk.svg', frames: 6, fps: 9, loop: true },
        climb: { src: 'climb.svg', frames: 4, fps: 8, loop: true },
        fall: { src: 'fall.svg', frames: 2, fps: 8, loop: true },
        sit: { src: 'sit.svg', frames: 2, fps: 3, loop: true },
        drag: { src: 'drag.svg', frames: 1, fps: 1, loop: true },
      },
    }],
  },
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'manifest.id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB failed.'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
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
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PACK_EVENT));
}

const cleanPath = (path: string) => path.replace(/^\.?\//, '').replace(/\\/g, '/');
const joinZipPath = (prefix: string, path: string) => cleanPath(`${prefix}${cleanPath(path)}`);

function bytesToDataUrl(bytes: Uint8Array, type: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read imported asset.'));
    const copy = new Uint8Array(bytes);
    reader.readAsDataURL(new Blob([copy], { type }));
  });
}

function validateManifest(input: unknown): ShimejiPackManifest {
  const m = input as ShimejiPackManifest;
  if (!m || m.schemaVersion !== 1 || typeof m.id !== 'string' || typeof m.name !== 'string') {
    throw new Error('Invalid Shimeji manifest.');
  }
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(m.id)) throw new Error('Pack id must be URL-safe.');
  if (!Array.isArray(m.characters) || m.characters.length === 0) throw new Error('Pack must include a character.');
  for (const c of m.characters) {
    if (!c.id || !c.name || !c.preview || !c.frameSize?.w || !c.frameSize?.h) {
      throw new Error('Each character needs id, name, preview, and frameSize.');
    }
    for (const action of REQUIRED_ACTIONS) {
      const anim = c.animations?.[action];
      if (!anim?.src || !anim.frames || !anim.fps) throw new Error(`Missing ${action} animation.`);
      if (cleanPath(anim.src) !== anim.src || anim.src.includes('..')) throw new Error(`Unsafe asset path: ${anim.src}`);
    }
    if (cleanPath(c.preview) !== c.preview || c.preview.includes('..')) throw new Error(`Unsafe asset path: ${c.preview}`);
  }
  return m;
}

function characterFor(pack: InstalledShimejiPack, characterId?: string): ShimejiCharacter {
  return pack.manifest.characters.find((c) => c.id === characterId) ?? pack.manifest.characters[0];
}

export function resolveShimejiAsset(pack: InstalledShimejiPack, path: string): string {
  const clean = cleanPath(path);
  if (pack.files?.[clean]) return pack.files[clean];
  return `${pack.baseUrl ?? ''}${clean}`;
}

export function getShimejiCharacter(pack: InstalledShimejiPack, characterId?: string): ShimejiCharacter {
  return characterFor(pack, characterId);
}

export async function listShimejiPacks(): Promise<InstalledShimejiPack[]> {
  if (typeof indexedDB === 'undefined') return [bundledPack];
  try {
    const imported = await withStore<InstalledShimejiPack[]>('readonly', (store) => store.getAll());
    const byId = new Map<string, InstalledShimejiPack>();
    byId.set(bundledPack.manifest.id, bundledPack);
    for (const pack of imported) byId.set(pack.manifest.id, pack);
    return Array.from(byId.values()).sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  } catch {
    return [bundledPack];
  }
}

export async function getShimejiPack(id: string): Promise<InstalledShimejiPack | null> {
  if (id === bundledPack.manifest.id || id === 'sample-star') return bundledPack;
  if (typeof indexedDB === 'undefined') return null;
  try {
    return await withStore<InstalledShimejiPack | undefined>('readonly', (store) => store.get(id)) ?? null;
  } catch {
    return null;
  }
}

export async function importShimejiZip(file: File): Promise<InstalledShimejiPack> {
  if (file.size > MAX_ZIP_BYTES) throw new Error('ZIP is too large.');
  const entries = await readZip(file);
  const manifestPath = entries['manifest.json']
    ? 'manifest.json'
    : Object.keys(entries).find((path) => path.endsWith('/manifest.json'));
  if (!manifestPath) return importClassicShimeji(entries, file.name);
  const manifestEntry = manifestPath ? entries[manifestPath] : null;
  if (!manifestEntry) throw new Error('ZIP must contain manifest.json.');
  const assetPrefix = manifestPath === 'manifest.json' ? '' : manifestPath.slice(0, -'manifest.json'.length);
  const manifest = validateManifest(JSON.parse(textDecoder.decode(manifestEntry)));
  const files: Record<string, string> = {};
  const needed = new Set<string>();
  for (const c of manifest.characters) {
    needed.add(c.preview);
    for (const anim of Object.values(c.animations)) if (anim?.src) needed.add(anim.src);
  }
  for (const path of needed) {
    const clean = cleanPath(path);
    const bytes = entries[clean] ?? entries[joinZipPath(assetPrefix, clean)];
    if (!bytes) throw new Error(`Missing asset: ${path}`);
    const type = path.endsWith('.svg') ? 'image/svg+xml'
      : path.endsWith('.png') ? 'image/png'
      : path.endsWith('.jpg') || path.endsWith('.jpeg') ? 'image/jpeg'
      : path.endsWith('.webp') ? 'image/webp'
      : '';
    if (!type) throw new Error(`Unsupported asset type: ${path}`);
    files[clean] = await bytesToDataUrl(bytes, type);
  }
  const pack: InstalledShimejiPack = { manifest, files, source: 'imported', installedAt: Date.now() };
  await withStore('readwrite', (store) => store.put(pack));
  changed();
  return pack;
}

async function importClassicShimeji(entries: Record<string, Uint8Array>, fileName: string): Promise<InstalledShimejiPack> {
  const imagePaths = Object.keys(entries)
    .filter((path) => /(^|\/)img\/(?:[^/]+\/)?shime\d+\.png$/i.test(path))
    .sort((a, b) => classicFrameNumber(a) - classicFrameNumber(b));
  if (!imagePaths.length) {
    throw new Error('ZIP must contain manifest.json or a classic img/shime*.png Shimeji folder.');
  }

  const firstPath = imagePaths[0];
  const name = titleFromPath(classicPackageName(firstPath, fileName));
  const id = safePackId(name);
  const size = pngSize(entries[firstPath]) ?? { w: 128, h: 128 };
  const byNumber = new Map(imagePaths.map((path) => [classicFrameNumber(path), path]));
  const frame = (n: number) => byNumber.get(n) ?? firstPath;
  const existingFrames = (frames: number[]) => frames.filter((n) => byNumber.has(n));
  const sequences: Record<ShimejiAction, number[]> = {
    idle: existingFrames([1, 2, 3]),
    walk: existingFrames([1, 2, 3, 2]),
    climb: existingFrames([13, 14]),
    fall: existingFrames([4]),
    sit: existingFrames([11, 12]),
    drag: existingFrames([5]),
  };
  const files: Record<string, string> = {};
  for (const [action, frames] of Object.entries(sequences) as Array<[ShimejiAction, number[]]>) {
    const src = `${action}.svg`;
    files[src] = await classicSpriteDataUrl(frames.length ? frames.map(frame) : [firstPath], entries, size);
  }
  files['preview.png'] = await bytesToDataUrl(entries[firstPath], 'image/png');

  const manifest: ShimejiPackManifest = {
    schemaVersion: 1,
    id,
    name,
    license: 'Third-party',
    description: 'Imported from a classic Shimeji ZIP package.',
    characters: [{
      id: 'default',
      name,
      preview: 'preview.png',
      frameSize: size,
      scale: 1,
      anchor: { x: Math.round(size.w / 2), y: size.h },
      animations: {
        idle: { src: 'idle.svg', frames: Math.max(1, sequences.idle.length), fps: 4, loop: true },
        walk: { src: 'walk.svg', frames: Math.max(1, sequences.walk.length), fps: 8, loop: true },
        climb: { src: 'climb.svg', frames: Math.max(1, sequences.climb.length), fps: 6, loop: true },
        fall: { src: 'fall.svg', frames: Math.max(1, sequences.fall.length), fps: 1, loop: true },
        sit: { src: 'sit.svg', frames: Math.max(1, sequences.sit.length), fps: 3, loop: true },
        drag: { src: 'drag.svg', frames: Math.max(1, sequences.drag.length), fps: 1, loop: true },
      },
    }],
  };
  const pack: InstalledShimejiPack = { manifest, files, source: 'imported', installedAt: Date.now() };
  await withStore('readwrite', (store) => store.put(pack));
  changed();
  return pack;
}

function classicFrameNumber(path: string): number {
  return Number(path.match(/shime(\d+)\.png$/i)?.[1] ?? 0);
}

function titleFromPath(path: string): string {
  return path.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Imported Shimeji';
}

function classicPackageName(path: string, fileName: string): string {
  const [beforeImg, afterImg = ''] = path.split('/img/');
  const imageParts = afterImg.split('/');
  const characterFolder = imageParts.length > 1 ? imageParts[0] : '';
  const packageFolder = beforeImg.split('/').filter(Boolean).at(-1);
  return characterFolder || packageFolder || fileName.replace(/\.zip$/i, '');
}

function safePackId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return `${slug || 'imported-shimeji'}-${Date.now().toString(36)}`;
}

function pngSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (
    bytes.length < 24
    || bytes[0] !== 0x89
    || bytes[1] !== 0x50
    || bytes[2] !== 0x4e
    || bytes[3] !== 0x47
  ) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { w: dv.getUint32(16, false), h: dv.getUint32(20, false) };
}

async function classicSpriteDataUrl(paths: string[], entries: Record<string, Uint8Array>, size: { w: number; h: number }): Promise<string> {
  const images = await Promise.all(paths.map(async (path, i) => {
    const href = await bytesToDataUrl(entries[path], 'image/png');
    return `<image href="${href}" x="${i * size.w}" y="0" width="${size.w}" height="${size.h}"/>`;
  }));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.w * paths.length}" height="${size.h}" viewBox="0 0 ${size.w * paths.length} ${size.h}">${images.join('')}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export async function fetchShimejiCatalog(): Promise<CatalogPack[]> {
  const res = await fetch(CATALOG_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Catalog ${res.status}`);
  const raw = await res.json() as { packs?: CatalogPack[] };
  return (raw.packs ?? []).map((p) => ({
    manifest: validateManifest(p.manifest),
    baseUrl: p.baseUrl.endsWith('/') ? p.baseUrl : `${p.baseUrl}/`,
  }));
}

export function getShimejiMarketplaceUrl(): string {
  return MARKETPLACE_URL;
}

export async function installCatalogPack(pack: CatalogPack): Promise<InstalledShimejiPack> {
  const installed: InstalledShimejiPack = {
    manifest: pack.manifest,
    baseUrl: pack.baseUrl,
    source: 'catalog',
    installedAt: Date.now(),
  };
  await withStore('readwrite', (store) => store.put(installed));
  changed();
  return installed;
}

export async function removeShimejiPack(id: string): Promise<void> {
  if (id === bundledPack.manifest.id) return;
  await withStore('readwrite', (store) => store.delete(id));
  changed();
}

export function subscribeShimejiPacks(cb: () => void): () => void {
  window.addEventListener(PACK_EVENT, cb);
  return () => window.removeEventListener(PACK_EVENT, cb);
}
