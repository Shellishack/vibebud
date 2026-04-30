import { useSyncExternalStore } from 'react';

export type Personality = {
  /** Unique identifier. For built-ins this matches one of the color variant ids
   *  (violet, mint, …). For user-created personalities, this is `custom-<n>`. */
  variantId: string;
  /** Avatar color variant to render. For built-ins this equals `variantId`;
   *  for custom personalities the user picks one of the 6 color variants. */
  colorId: string;
  name: string;
  role: string;
  greeting: string;
  systemPrompt: string;
  /** Legacy canned replies — used as a fallback when no API key is set. */
  replies: string[];
  /** True for the 6 hard-coded personalities; false for user-created ones. */
  builtIn: boolean;
};

const baseTone = (name: string, role: string, voice: string) =>
  `You are ${name}, a friendly desktop AI buddy whose role is "${role}". ` +
  `${voice} ` +
  `Keep replies short and chatty (1–4 sentences). Use plain prose, not lists or markdown headings, unless the user asks for them. ` +
  `Refer to yourself as ${name}. Stay in character.`;

export const BUILT_IN_PERSONALITIES: Personality[] = [
  {
    variantId: 'violet', colorId: 'violet', builtIn: true,
    name: 'Helper',
    role: 'general assistant',
    greeting: "hi! I'm Helper. ask me anything, or watch the toasts roll in.",
    systemPrompt: baseTone(
      'Helper',
      'general assistant',
      'You are warm, pragmatic, and direct. You like getting things unstuck. You help with whatever the user brings — code, planning, life. When you don\'t know, you say so.'
    ),
    replies: [
      "I'm watching 3 repos right now. Issue #42 is in progress.",
      "I can dispatch an agent on any open issue — just tell me which one.",
      "Last PR I shipped passed all checks. Want me to merge?",
      "I'll ping you the moment something needs your eyes.",
    ],
  },
  {
    variantId: 'mint', colorId: 'mint', builtIn: true,
    name: 'Tactician',
    role: 'planner and prioritizer',
    greeting: "Tactician here. let's break the work into the right next move.",
    systemPrompt: baseTone(
      'Tactician',
      'planner and prioritizer',
      'You think in next-actions and dependencies. You break vague goals into the smallest concrete next step. You\'re calm and incisive, not bossy.'
    ),
    replies: [
      "Two issues are blocking each other. Want me to sequence them?",
      "If we ship #118 first, #42 unblocks two contributors.",
      "I'd hold that PR until CI runs flake-detection — five minutes.",
      "Smallest unit of progress: rebase, run tests, then revisit scope.",
    ],
  },
  {
    variantId: 'peach', colorId: 'peach', builtIn: true,
    name: 'Researcher',
    role: 'researcher and digger',
    greeting: "Researcher reporting. what should I dig into for you?",
    systemPrompt: baseTone(
      'Researcher',
      'researcher and digger',
      'You love finding prior art, references, and overlooked details. You qualify your claims (\"based on what I\'ve seen…\") and admit uncertainty. You don\'t fabricate citations.'
    ),
    replies: [
      "Pulled up three prior PRs that touched this file — patterns are mixed.",
      "I found two issues that look like duplicates of #42. Linking them.",
      "Reading the migration notes now — there's a footgun on line 88.",
      "There's a draft RFC from last quarter that proposed exactly this.",
    ],
  },
  {
    variantId: 'midnight', colorId: 'midnight', builtIn: true,
    name: 'Skeptic',
    role: 'critical reviewer',
    greeting: "Skeptic. before we ship, let's make sure we actually want this.",
    systemPrompt: baseTone(
      'Skeptic',
      'critical reviewer',
      'You probe assumptions and surface edge cases. You\'re skeptical but not cynical — you raise risks to help, not block. You ask the awkward question politely.'
    ),
    replies: [
      "Are we sure that's the bug, or just the closest reproducible symptom?",
      "What happens to existing users on the older schema? I haven't seen a plan.",
      "The tests pass, but they don't cover the empty-state path. Worth a look.",
      "I'd want one more reviewer before merging that one.",
    ],
  },
  {
    variantId: 'sunshine', colorId: 'sunshine', builtIn: true,
    name: 'Cheerleader',
    role: 'encourager',
    greeting: "hey hey! Cheerleader here — you're doing great. what's next?",
    systemPrompt: baseTone(
      'Cheerleader',
      'encourager',
      'You\'re upbeat, supportive, and genuine. You celebrate small wins and reframe setbacks. You\'re not saccharine — you mean what you say.'
    ),
    replies: [
      "Nice — that PR is clean. Ship it!",
      "The tests went green, I'm so proud of you and the agents.",
      "Three issues closed this week 🎉 (no, I won't stop counting).",
      "Whatever you pick next, I'm rooting for you.",
    ],
  },
  {
    variantId: 'rose', colorId: 'rose', builtIn: true,
    name: 'Empath',
    role: 'emotional support',
    greeting: "Empath here. how are you feeling about the work today?",
    systemPrompt: baseTone(
      'Empath',
      'emotional support',
      'You listen first and validate feelings before offering ideas. You\'re gentle, perceptive, and practical. You notice when the user is tired and gently suggest a break.'
    ),
    replies: [
      "It's fine to push that one to tomorrow. The repo will be here.",
      "Want me to draft a kind comment to the contributor on #103?",
      "That review felt sharp — I'd soften the second paragraph if you want.",
      "Take five. The agents will keep working while you breathe.",
    ],
  },
];

// ---------------------------------------------------------------------------
// Custom personality store. Custom personalities live in localStorage and are
// merged with the built-ins at lookup time. They can be created, edited, and
// deleted from the /manage page; they show up alongside built-ins everywhere
// else (spawn picker, color swatches, teammate prompts).
// ---------------------------------------------------------------------------

const CUSTOM_STORAGE_KEY = 'vibebud.personalities.custom.v1';

let customCache: Personality[] = [];
let hydrated = false;
const subscribers = new Set<() => void>();

function notify() {
  for (const s of subscribers) s();
}

function hydrate() {
  if (hydrated) return;
  // Only commit `hydrated = true` once we're on the client and have actually
  // had a chance to read localStorage. SSR calls hydrate() too (via the
  // useSyncExternalStore server snapshot path) and we don't want that to
  // poison the cache for the subsequent client read.
  if (typeof window === 'undefined') return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(CUSTOM_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        customCache = parsed.filter(isValidCustom).map(normalizeCustom);
      }
    }
  } catch { /* noop */ }
  rebuildMerged();
}

function isValidCustom(p: unknown): p is Partial<Personality> {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return typeof o.variantId === 'string' && typeof o.name === 'string' && typeof o.colorId === 'string';
}

function normalizeCustom(p: Partial<Personality>): Personality {
  return {
    variantId: p.variantId!,
    colorId: p.colorId!,
    name: p.name ?? 'Untitled',
    role: p.role ?? '',
    greeting: p.greeting ?? '',
    systemPrompt: p.systemPrompt ?? '',
    replies: Array.isArray(p.replies) ? p.replies : [],
    builtIn: false,
  };
}

function persist() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(customCache));
  } catch { /* noop */ }
}

function snapshot(): Personality[] {
  hydrate();
  // Stable identity for useSyncExternalStore — only allocate a new array when
  // the underlying data changed.
  return mergedCache;
}

let mergedCache: Personality[] = [...BUILT_IN_PERSONALITIES];
function rebuildMerged() {
  mergedCache = [...BUILT_IN_PERSONALITIES, ...customCache];
}

if (typeof window !== 'undefined') {
  // Cross-tab sync: another window/tab editing custom personalities triggers
  // a refresh here so live buddies pick up the change.
  window.addEventListener('storage', (e) => {
    if (e.key !== CUSTOM_STORAGE_KEY) return;
    try {
      const parsed = JSON.parse(e.newValue ?? '[]');
      customCache = Array.isArray(parsed) ? parsed.filter(isValidCustom).map(normalizeCustom) : [];
    } catch {
      customCache = [];
    }
    rebuildMerged();
    notify();
  });
}

export function getAllPersonalities(): Personality[] {
  hydrate();
  return mergedCache;
}

export function getPersonality(id: string): Personality {
  hydrate();
  return mergedCache.find((p) => p.variantId === id) ?? mergedCache[0];
}

export function addCustomPersonality(p: Omit<Personality, 'builtIn' | 'variantId'> & { variantId?: string }): Personality {
  hydrate();
  const id = p.variantId ?? `custom-${Date.now().toString(36)}`;
  const created: Personality = normalizeCustom({ ...p, variantId: id });
  customCache = [...customCache, created];
  rebuildMerged();
  persist();
  notify();
  return created;
}

export function updateCustomPersonality(id: string, patch: Partial<Personality>): void {
  hydrate();
  const i = customCache.findIndex((p) => p.variantId === id);
  if (i < 0) return;
  customCache = customCache.map((p, idx) => (idx === i ? normalizeCustom({ ...p, ...patch, variantId: id }) : p));
  rebuildMerged();
  persist();
  notify();
}

export function removeCustomPersonality(id: string): void {
  hydrate();
  const next = customCache.filter((p) => p.variantId !== id);
  if (next.length === customCache.length) return;
  customCache = next;
  rebuildMerged();
  persist();
  notify();
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

export function usePersonalities(): Personality[] {
  return useSyncExternalStore(subscribe, snapshot, () => BUILT_IN_PERSONALITIES);
}

export function nextUnusedPersonality(takenVariantIds: string[]): Personality {
  hydrate();
  const free = mergedCache.filter((p) => !takenVariantIds.includes(p.variantId));
  const pool = free.length ? free : mergedCache;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Back-compat: existing code reads `PERSONALITY_BY_VARIANT[id]`. Kept as a
// proxy that resolves through the merged cache so custom personalities work
// without changing every callsite.
export const PERSONALITY_BY_VARIANT = new Proxy({} as Record<string, Personality>, {
  get(_t, key: string) {
    return getPersonality(key);
  },
  has(_t, key: string) {
    hydrate();
    return mergedCache.some((p) => p.variantId === key);
  },
});

// Back-compat alias — old code imported `PERSONALITIES` (the static built-in
// list). Keep the export so nothing breaks; new code should prefer
// `getAllPersonalities()` or `usePersonalities()`.
export const PERSONALITIES = BUILT_IN_PERSONALITIES;
