import type { InstalledSpritePack, SpriteAction, SpritePackManifest } from './types';
import { readZip } from './zip';

const DB_NAME = 'vibebud-sprites';
const STORE = 'packs';
const PACK_EVENT = 'vibebud:spritePacksChanged';
const MAX_ZIP_BYTES = 16 * 1024 * 1024;
const REQUIRED_ACTIONS: SpriteAction[] = ['idle', 'walk', 'climb', 'fall', 'sit', 'drag'];
const textDecoder = new TextDecoder();

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

const cleanPath = (path: string) => path.replace(/^\.?\//, '').replace(/\\/g, '/');

function changed() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PACK_EVENT));
}

function validateManifest(input: unknown): SpritePackManifest {
  const m = input as SpritePackManifest;
  if (!m || m.schemaVersion !== 1 || typeof m.id !== 'string' || typeof m.name !== 'string') {
    throw new Error('Invalid Sprite manifest.');
  }
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(m.id)) throw new Error('Sprite id must be URL-safe.');
  if (!m.preview || cleanPath(m.preview) !== m.preview || m.preview.includes('..')) throw new Error('Invalid Sprite preview path.');
  if (!m.frameSize?.w || !m.frameSize?.h) throw new Error('Sprite frameSize is required.');
  for (const action of REQUIRED_ACTIONS) {
    const anim = m.animations?.[action];
    if (!anim?.src || !anim.frames || !anim.fps) throw new Error(`Missing ${action} animation.`);
    if (cleanPath(anim.src) !== anim.src || anim.src.includes('..')) throw new Error(`Unsafe asset path: ${anim.src}`);
  }
  return m;
}

function mimeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return '';
}

function bytesToDataUrl(bytes: Uint8Array, type: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read sprite asset.'));
    reader.readAsDataURL(new Blob([new Uint8Array(bytes)], { type }));
  });
}

export async function listSpritePacks(): Promise<InstalledSpritePack[]> {
  if (typeof indexedDB === 'undefined') return [];
  try {
    return await withStore<InstalledSpritePack[]>('readonly', (store) => store.getAll());
  } catch {
    return [];
  }
}

export async function getSpritePack(id: string): Promise<InstalledSpritePack | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    return await withStore<InstalledSpritePack | undefined>('readonly', (store) => store.get(id)) ?? null;
  } catch {
    return null;
  }
}

export function resolveSpriteAsset(pack: InstalledSpritePack, path: string): string {
  const clean = cleanPath(path);
  return pack.files[clean] ?? '';
}

export async function importSpriteZip(file: File, source: InstalledSpritePack['source'] = 'imported'): Promise<InstalledSpritePack> {
  if (file.size > MAX_ZIP_BYTES) throw new Error('ZIP is too large.');
  const entries = await readZip(file);
  const manifestEntry = entries['sprite-manifest.json'] ?? entries['manifest.json'];
  if (!manifestEntry) throw new Error('ZIP must contain sprite-manifest.json.');
  const manifest = validateManifest(JSON.parse(textDecoder.decode(manifestEntry)));
  const needed = new Set<string>([manifest.preview]);
  for (const anim of Object.values(manifest.animations)) needed.add(anim.src);
  const files: Record<string, string> = {};
  for (const path of needed) {
    const clean = cleanPath(path);
    const bytes = entries[clean];
    if (!bytes) throw new Error(`Missing asset: ${path}`);
    const type = mimeForPath(clean);
    if (!type) throw new Error(`Unsupported asset type: ${path}`);
    files[clean] = await bytesToDataUrl(bytes, type);
  }
  const pack: InstalledSpritePack = { manifest, files, source, installedAt: Date.now() };
  await withStore('readwrite', (store) => store.put(pack));
  changed();
  return pack;
}

export async function importSpriteZipBase64(name: string, base64: string, source: InstalledSpritePack['source'] = 'generated'): Promise<InstalledSpritePack> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return importSpriteZip(new File([bytes], name, { type: 'application/zip' }), source);
}

export async function removeSpritePack(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id));
  changed();
}

export function subscribeSpritePacks(cb: () => void): () => void {
  window.addEventListener(PACK_EVENT, cb);
  return () => window.removeEventListener(PACK_EVENT, cb);
}
