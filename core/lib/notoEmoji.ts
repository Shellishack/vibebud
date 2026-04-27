// Lazy-loads Google Noto Animated Emoji Lottie JSON at runtime. No assets
// are bundled — per-emoji JSON is fetched from the official CDN
// (Apache-2.0, CORS-enabled) and cached LRU in localStorage.
//
//   Lottie: https://fonts.gstatic.com/s/e/notoemoji/latest/{cp}/lottie.json

const LOTTIE_URL = (cp: string) => `https://fonts.gstatic.com/s/e/notoemoji/latest/${cp}/lottie.json`;

const LOTTIE_CACHE_KEY = 'vibemoji.notoLottieCache.v1';
const LOTTIE_CACHE_MAX = 50;

const lsGet = (k: string): string | null => {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(k); } catch { return null; }
};
const lsSet = (k: string, v: string): void => {
  try { localStorage.setItem(k, v); } catch { /* quota / private mode */ }
};

type LottieRecord = { cp: string; data: unknown; usedAt: number };
const lottieMem = new Map<string, LottieRecord>();
let lottieDiskLoaded = false;

const loadLottieDisk = (): void => {
  if (lottieDiskLoaded) return;
  lottieDiskLoaded = true;
  const raw = lsGet(LOTTIE_CACHE_KEY);
  if (!raw) return;
  try {
    const arr = JSON.parse(raw) as LottieRecord[];
    for (const r of arr) lottieMem.set(r.cp, r);
  } catch { /* ignore */ }
};

const persistLottieDisk = (): void => {
  const arr = Array.from(lottieMem.values())
    .sort((a, b) => b.usedAt - a.usedAt)
    .slice(0, LOTTIE_CACHE_MAX);
  lottieMem.clear();
  for (const r of arr) lottieMem.set(r.cp, r);
  try { lsSet(LOTTIE_CACHE_KEY, JSON.stringify(arr)); } catch { /* quota */ }
};

export async function loadLottie(cp: string): Promise<unknown> {
  loadLottieDisk();
  const hit = lottieMem.get(cp);
  if (hit) {
    hit.usedAt = Date.now();
    return hit.data;
  }
  const res = await fetch(LOTTIE_URL(cp));
  if (!res.ok) throw new Error(`Noto lottie ${cp} ${res.status}`);
  const data = await res.json();
  lottieMem.set(cp, { cp, data, usedAt: Date.now() });
  try { persistLottieDisk(); } catch { /* noop */ }
  return data;
}

export function getCachedLottie(cp: string): unknown | null {
  loadLottieDisk();
  const hit = lottieMem.get(cp);
  return hit ? hit.data : null;
}
