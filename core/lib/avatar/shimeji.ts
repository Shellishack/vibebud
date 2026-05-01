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

type ExportedShimejiManifest = {
  schemaVersion?: number;
  name?: string;
  nameSlug?: string;
  description?: string;
  animationSchema?: { path?: string };
  sprites?: {
    basePath?: string;
    filePattern?: string;
    spriteCount?: number;
    size?: [number, number];
  };
  preview?: { thumbnail?: string };
  author?: { name?: string };
  license?: { text?: string; attribution?: string };
};

type ExportedShimejiAnimation = {
  key?: string;
  subtype?: string;
  loop?: string;
  frames?: Array<{ sprite?: number; durationTicks?: number }>;
};

type ExportedShimejiAnimationFile = {
  animations?: ExportedShimejiAnimation[];
};

function isExportedShimejiManifest(input: unknown): input is ExportedShimejiManifest {
  const m = input as ExportedShimejiManifest;
  return !!m?.animationSchema?.path && !!m.sprites?.basePath && !!m.sprites?.filePattern && Array.isArray(m.sprites?.size);
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
  const rawManifest = JSON.parse(textDecoder.decode(manifestEntry));
  if (isExportedShimejiManifest(rawManifest)) {
    return importExportedShimeji(entries, rawManifest, assetPrefix, file.name);
  }
  const manifest = validateManifest(rawManifest);
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

async function importExportedShimeji(
  entries: Record<string, Uint8Array>,
  raw: ExportedShimejiManifest,
  assetPrefix: string,
  fileName: string,
): Promise<InstalledShimejiPack> {
  const animationPath = cleanPath(raw.animationSchema?.path ?? 'animation.json');
  const animationBytes = entries[animationPath] ?? entries[joinZipPath(assetPrefix, animationPath)];
  if (!animationBytes) throw new Error(`Missing animation schema: ${animationPath}`);
  const animationFile = JSON.parse(textDecoder.decode(animationBytes)) as ExportedShimejiAnimationFile;
  const animations = Array.isArray(animationFile.animations) ? animationFile.animations : [];
  if (!animations.length) throw new Error('Animation schema does not include animations.');

  const name = titleFromPath(raw.name || fileName.replace(/\.zip$/i, ''));
  const id = safePackId(raw.nameSlug || name);
  const spriteBase = cleanPath(raw.sprites?.basePath ?? 'sprites/');
  const spritePattern = raw.sprites?.filePattern || '%04d.webp';
  const [w, h] = raw.sprites?.size ?? [512, 512];
  const size = { w, h };
  const files: Record<string, string> = {};

  const selected: Record<ShimejiAction, ExportedShimejiAnimation | undefined> = {
    idle: findExportedAnimation(animations, ['stand_left', 'stand', 'idle'], ['STAND']),
    walk: findExportedAnimation(animations, ['walk_left', 'walk'], ['WALK']),
    climb: findExportedAnimation(animations, ['climb_left', 'climb'], ['CLIMB']),
    fall: findExportedAnimation(animations, ['fall'], ['FALL']),
    sit: findExportedAnimation(animations, ['sit_left', 'sit'], ['SIT']),
    drag: findExportedAnimation(animations, ['drag'], ['DRAG', 'FALL']),
  };
  const fallback = selected.fall ?? selected.idle ?? animations[0];

  for (const action of REQUIRED_ACTIONS) {
    const anim = selected[action] ?? fallback;
    const frames = exportedFrameSprites(anim);
    const paths = frames.length ? frames.map((sprite) => exportedSpritePath(spriteBase, spritePattern, sprite)) : [exportedSpritePath(spriteBase, spritePattern, 0)];
    const src = `${action}.svg`;
    files[src] = await exportedSpriteDataUrl(paths, entries, assetPrefix, size);
  }

  const preview = cleanPath(raw.preview?.thumbnail ?? exportedSpritePath(spriteBase, spritePattern, 0));
  const previewBytes = entries[preview] ?? entries[joinZipPath(assetPrefix, preview)];
  if (!previewBytes) throw new Error(`Missing preview asset: ${preview}`);
  files['preview.webp'] = await bytesToDataUrl(previewBytes, mimeForPath(preview));

  const manifest: ShimejiPackManifest = {
    schemaVersion: 1,
    id,
    name,
    license: raw.license?.text || 'Third-party',
    author: raw.author?.name || raw.license?.attribution,
    description: raw.description || 'Imported from a Shimeji export package.',
    characters: [{
      id: 'default',
      name,
      preview: 'preview.webp',
      frameSize: size,
      scale: 1,
      anchor: { x: Math.round(size.w / 2), y: size.h },
      animations: {
        idle: exportedActionManifest('idle', selected.idle ?? fallback),
        walk: exportedActionManifest('walk', selected.walk ?? fallback),
        climb: exportedActionManifest('climb', selected.climb ?? fallback),
        fall: exportedActionManifest('fall', selected.fall ?? fallback),
        sit: exportedActionManifest('sit', selected.sit ?? fallback),
        drag: exportedActionManifest('drag', selected.drag ?? fallback),
      },
    }],
  };
  const pack: InstalledShimejiPack = { manifest, files, source: 'imported', installedAt: Date.now() };
  await withStore('readwrite', (store) => store.put(pack));
  changed();
  return pack;
}

function findExportedAnimation(
  animations: ExportedShimejiAnimation[],
  keyNeedles: string[],
  subtypeNeedles: string[],
): ExportedShimejiAnimation | undefined {
  const lowerKeys = keyNeedles.map((key) => key.toLowerCase());
  const upperSubtypes = subtypeNeedles.map((subtype) => subtype.toUpperCase());
  return animations.find((animation) => {
    const key = animation.key?.toLowerCase() ?? '';
    return lowerKeys.some((needle) => key === needle || key.includes(needle));
  }) ?? animations.find((animation) => {
    const subtype = animation.subtype?.toUpperCase() ?? '';
    return upperSubtypes.some((needle) => subtype === needle || subtype.includes(needle));
  });
}

function exportedFrameSprites(animation: ExportedShimejiAnimation | undefined): number[] {
  return (animation?.frames ?? [])
    .map((frame) => frame.sprite)
    .filter((sprite): sprite is number => typeof sprite === 'number' && Number.isInteger(sprite) && sprite >= 0);
}

function exportedActionManifest(action: ShimejiAction, animation: ExportedShimejiAnimation) {
  const frames = Math.max(1, exportedFrameSprites(animation).length);
  const durations = (animation.frames ?? [])
    .map((frame) => frame.durationTicks)
    .filter((duration): duration is number => typeof duration === 'number' && duration > 0);
  const avgTicks = durations.length
    ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length
    : 12;
  const fps = Math.max(1, Math.min(24, Math.round(60 / avgTicks)));
  return { src: `${action}.svg`, frames, fps, loop: animation.loop !== 'ONESHOT' };
}

function exportedSpritePath(basePath: string, pattern: string, index: number): string {
  const fileName = pattern.includes('%04d')
    ? pattern.replace('%04d', index.toString().padStart(4, '0'))
    : pattern.includes('%d')
      ? pattern.replace('%d', String(index))
      : index.toString().padStart(4, '0');
  return joinZipPath(basePath.endsWith('/') ? basePath : `${basePath}/`, fileName);
}

function mimeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return '';
}

async function exportedSpriteDataUrl(
  paths: string[],
  entries: Record<string, Uint8Array>,
  assetPrefix: string,
  size: { w: number; h: number },
): Promise<string> {
  const images = await Promise.all(paths.map(async (path, i) => {
    const clean = cleanPath(path);
    const bytes = entries[clean] ?? entries[joinZipPath(assetPrefix, clean)];
    if (!bytes) throw new Error(`Missing sprite asset: ${path}`);
    const href = await bytesToDataUrl(bytes, mimeForPath(path));
    return `<image href="${href}" x="${i * size.w}" y="0" width="${size.w}" height="${size.h}"/>`;
  }));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.w * paths.length}" height="${size.h}" viewBox="0 0 ${size.w * paths.length} ${size.h}">${images.join('')}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
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
