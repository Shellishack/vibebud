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
  const manifestEntry = entries['manifest.json'];
  if (!manifestEntry) throw new Error('ZIP must contain manifest.json at the root.');
  const manifest = validateManifest(JSON.parse(textDecoder.decode(manifestEntry)));
  const files: Record<string, string> = {};
  const needed = new Set<string>();
  for (const c of manifest.characters) {
    needed.add(c.preview);
    for (const anim of Object.values(c.animations)) if (anim?.src) needed.add(anim.src);
  }
  for (const path of needed) {
    const bytes = entries[path];
    if (!bytes) throw new Error(`Missing asset: ${path}`);
    const type = path.endsWith('.svg') ? 'image/svg+xml'
      : path.endsWith('.png') ? 'image/png'
      : path.endsWith('.jpg') || path.endsWith('.jpeg') ? 'image/jpeg'
      : path.endsWith('.webp') ? 'image/webp'
      : '';
    if (!type) throw new Error(`Unsupported asset type: ${path}`);
    files[path] = await bytesToDataUrl(bytes, type);
  }
  const pack: InstalledShimejiPack = { manifest, files, source: 'imported', installedAt: Date.now() };
  await withStore('readwrite', (store) => store.put(pack));
  changed();
  return pack;
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
