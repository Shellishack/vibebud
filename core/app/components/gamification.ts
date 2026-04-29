export type BuddyStats = {
  chats: number;
  tasksCompleted: number;
  pings: number;
};

export type BuddyGamification = {
  xp?: number;
  level?: number;
  stats?: Partial<BuddyStats>;
};

export type XpStat = keyof BuddyStats;
export type DailyTaskKind = 'agent-task' | 'chat-buddies' | 'team-use';
export type GamificationEvent = 'chat' | 'llm-complete' | 'task-complete' | 'team-use' | 'ping';

export type DailyTask = {
  id: string;
  date: string;
  kind: DailyTaskKind;
  title: string;
  target: number;
  progress: number;
  rewardXp: number;
  rewardBond: number;
  completedAt?: string;
  buddyIds: string[];
};

export type MilestoneReward = {
  level: number;
  title: string;
  badgeFrame?: string;
  aura?: string;
  idleEffect?: string;
};

export type BondProfile = {
  bondXp: number;
  bondLevel: number;
  mood: string;
  lastInteractionSummary: string;
  memories: string[];
};

export type TeamBonus = {
  buddyIds: string[];
  kind: 'task-xp';
  multiplier: number;
  label: string;
};

export type GamificationStore = {
  date: string;
  dailyTasks: DailyTask[];
  completedTaskHistory: string[];
  bonds: Record<string, BondProfile>;
  collection: {
    unlockedMilestones: Record<string, number[]>;
    favoriteTeams: Record<string, number>;
  };
};

export type BuddySnapshot = {
  id: string;
  variantId: string;
  groupId?: string;
  level?: number;
  xp?: number;
  stats?: Partial<BuddyStats>;
};

export type BondLlmResult = {
  mood?: string;
  bondDelta?: number;
  memory?: string;
  summary?: string;
};

const DEFAULT_LEVEL = 1;
const DEFAULT_XP = 0;

export const XP_REWARDS = {
  chat: 5,
  llmComplete: 25,
  taskComplete: 40,
  ping: 2,
} as const;

const STORE_KEY = 'vibemoji.gamification.v1';
const STORE_EVENT = 'vibemoji:gamificationChange';
const DEFAULT_BOND: BondProfile = {
  bondXp: 0,
  bondLevel: 1,
  mood: 'curious',
  lastInteractionSummary: '',
  memories: [],
};

export const MILESTONE_REWARDS: MilestoneReward[] = [
  { level: 5, title: 'Trusted Buddy', badgeFrame: 'silver' },
  { level: 10, title: 'Steady Teammate', badgeFrame: 'gold' },
  { level: 15, title: 'Spark Specialist', aura: 'spark' },
  { level: 20, title: 'Prestige Buddy', badgeFrame: 'prestige', aura: 'prestige', idleEffect: 'shine' },
];

export function xpForLevel(level: number): number {
  return 100 + Math.max(0, level - 1) * 50;
}

export function normalizeGamification<T extends BuddyGamification>(buddy: T): T & Required<Pick<BuddyGamification, 'xp' | 'level'>> & { stats: BuddyStats } {
  const level = Number.isFinite(buddy.level) && (buddy.level ?? 0) > 0
    ? Math.floor(buddy.level as number)
    : DEFAULT_LEVEL;
  const xp = Number.isFinite(buddy.xp) && (buddy.xp ?? 0) >= 0
    ? Math.floor(buddy.xp as number)
    : DEFAULT_XP;
  return {
    ...buddy,
    level,
    xp,
    stats: {
      chats: Math.max(0, Math.floor(buddy.stats?.chats ?? 0)),
      tasksCompleted: Math.max(0, Math.floor(buddy.stats?.tasksCompleted ?? 0)),
      pings: Math.max(0, Math.floor(buddy.stats?.pings ?? 0)),
    },
  };
}

export function applyBuddyXp<T extends BuddyGamification>(
  buddy: T,
  amount: number,
  stat?: XpStat,
): { buddy: T & Required<Pick<BuddyGamification, 'xp' | 'level'>> & { stats: BuddyStats }; leveledUp: boolean; previousLevel: number } {
  const normalized = normalizeGamification(buddy);
  const previousLevel = normalized.level;
  let level = normalized.level;
  let xp = normalized.xp + Math.max(0, Math.floor(amount));

  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level += 1;
  }

  const stats = { ...normalized.stats };
  if (stat) stats[stat] += 1;

  return {
    buddy: { ...normalized, level, xp, stats },
    leveledUp: level > previousLevel,
    previousLevel,
  };
}

export function levelProgress(buddy: BuddyGamification): { level: number; xp: number; next: number; pct: number; stats: BuddyStats } {
  const normalized = normalizeGamification(buddy);
  const next = xpForLevel(normalized.level);
  return {
    level: normalized.level,
    xp: normalized.xp,
    next,
    pct: next > 0 ? Math.min(100, Math.max(0, (normalized.xp / next) * 100)) : 0,
    stats: normalized.stats,
  };
}

export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function bondXpForLevel(level: number): number {
  return 50 + Math.max(0, level - 1) * 25;
}

export function normalizeBondProfile(raw?: Partial<BondProfile>): BondProfile {
  return {
    bondXp: Math.max(0, Math.floor(raw?.bondXp ?? 0)),
    bondLevel: Math.max(1, Math.floor(raw?.bondLevel ?? 1)),
    mood: typeof raw?.mood === 'string' && raw.mood.trim() ? raw.mood.trim().slice(0, 24) : DEFAULT_BOND.mood,
    lastInteractionSummary: typeof raw?.lastInteractionSummary === 'string' ? raw.lastInteractionSummary.slice(0, 120) : '',
    memories: Array.isArray(raw?.memories)
      ? raw.memories.filter((m): m is string => typeof m === 'string' && !!m.trim()).slice(-5)
      : [],
  };
}

export function applyBondXp(profile: BondProfile, amount: number): BondProfile {
  const next = normalizeBondProfile(profile);
  let xp = next.bondXp + Math.max(0, Math.floor(amount));
  let level = next.bondLevel;
  while (xp >= bondXpForLevel(level)) {
    xp -= bondXpForLevel(level);
    level += 1;
  }
  return { ...next, bondXp: xp, bondLevel: level };
}

function defaultStore(date = todayKey()): GamificationStore {
  return {
    date,
    dailyTasks: makeDailyTasks(date),
    completedTaskHistory: [],
    bonds: {},
    collection: { unlockedMilestones: {}, favoriteTeams: {} },
  };
}

function makeDailyTasks(date: string): DailyTask[] {
  return [
    {
      id: `${date}:agent-task`,
      date,
      kind: 'agent-task',
      title: 'Complete 1 agent task',
      target: 1,
      progress: 0,
      rewardXp: 30,
      rewardBond: 8,
      buddyIds: [],
    },
    {
      id: `${date}:chat-buddies`,
      date,
      kind: 'chat-buddies',
      title: 'Chat with 2 buddies',
      target: 2,
      progress: 0,
      rewardXp: 20,
      rewardBond: 10,
      buddyIds: [],
    },
    {
      id: `${date}:team-use`,
      date,
      kind: 'team-use',
      title: 'Use a grouped team once',
      target: 1,
      progress: 0,
      rewardXp: 25,
      rewardBond: 8,
      buddyIds: [],
    },
  ];
}

function normalizeStore(raw: unknown, date = todayKey()): GamificationStore {
  if (!raw || typeof raw !== 'object') return defaultStore(date);
  const o = raw as Partial<GamificationStore>;
  const storeDate = o.date === date ? date : date;
  const base = o.date === date ? o : defaultStore(date);
  const dailyTasks = Array.isArray(base.dailyTasks) && base.dailyTasks.length
    ? base.dailyTasks.map((t) => ({
      ...t,
      date: storeDate,
      progress: Math.max(0, Math.min(t.target, Math.floor(t.progress ?? 0))),
      buddyIds: Array.isArray(t.buddyIds) ? t.buddyIds.filter((id): id is string => typeof id === 'string') : [],
    }))
    : makeDailyTasks(storeDate);
  const bonds: Record<string, BondProfile> = {};
  const rawBonds = base.bonds && typeof base.bonds === 'object' ? base.bonds : {};
  for (const [id, profile] of Object.entries(rawBonds)) bonds[id] = normalizeBondProfile(profile);
  return {
    date: storeDate,
    dailyTasks,
    completedTaskHistory: Array.isArray(base.completedTaskHistory) ? base.completedTaskHistory.filter((x): x is string => typeof x === 'string') : [],
    bonds,
    collection: {
      unlockedMilestones: base.collection?.unlockedMilestones ?? {},
      favoriteTeams: base.collection?.favoriteTeams ?? {},
    },
  };
}

export function loadGamificationStore(): GamificationStore {
  if (typeof window === 'undefined') return defaultStore();
  try {
    return normalizeStore(JSON.parse(localStorage.getItem(STORE_KEY) || 'null'));
  } catch {
    return defaultStore();
  }
}

export function saveGamificationStore(store: GamificationStore): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    window.dispatchEvent(new CustomEvent(STORE_EVENT, { detail: store }));
  } catch { /* noop */ }
}

export function subscribeGamification(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onChange = () => cb();
  window.addEventListener(STORE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(STORE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function getBuddyBond(buddyId: string): BondProfile {
  return normalizeBondProfile(loadGamificationStore().bonds[buddyId]);
}

export function applyBondUpdate(
  buddyId: string,
  fallbackDelta: number,
  llmResult?: BondLlmResult | null,
): BondProfile {
  const store = loadGamificationStore();
  let profile = applyBondXp(normalizeBondProfile(store.bonds[buddyId]), llmResult?.bondDelta ?? fallbackDelta);
  if (llmResult?.mood) profile = { ...profile, mood: llmResult.mood.trim().slice(0, 24) };
  if (llmResult?.summary) profile = { ...profile, lastInteractionSummary: llmResult.summary.trim().slice(0, 120) };
  if (llmResult?.memory) {
    const memory = llmResult.memory.trim().slice(0, 90);
    if (memory) profile = { ...profile, memories: [...profile.memories.filter((m) => m !== memory), memory].slice(-5) };
  }
  store.bonds[buddyId] = profile;
  saveGamificationStore(store);
  return profile;
}

export function advanceDailyTask(
  event: GamificationEvent,
  buddyIds: string[],
): { store: GamificationStore; completed: DailyTask[] } {
  const store = loadGamificationStore();
  const completed: DailyTask[] = [];
  const kindFor = event === 'task-complete' ? 'agent-task' : event === 'team-use' ? 'team-use' : event === 'chat' ? 'chat-buddies' : null;
  if (!kindFor) return { store, completed };
  store.dailyTasks = store.dailyTasks.map((task) => {
    if (task.kind !== kindFor || task.completedAt) return task;
    const nextBuddyIds = Array.from(new Set([...task.buddyIds, ...buddyIds]));
    const progress = task.kind === 'chat-buddies' ? Math.min(task.target, nextBuddyIds.length) : Math.min(task.target, task.progress + 1);
    const next = { ...task, buddyIds: nextBuddyIds, progress };
    if (progress >= task.target) {
      next.completedAt = new Date().toISOString();
      store.completedTaskHistory.push(next.id);
      completed.push(next);
    }
    return next;
  });
  saveGamificationStore(store);
  return { store, completed };
}

export function applyMilestoneUnlocks(buddy: BuddySnapshot): MilestoneReward[] {
  const store = loadGamificationStore();
  const current = new Set(store.collection.unlockedMilestones[buddy.id] ?? []);
  const unlocked = MILESTONE_REWARDS.filter((m) => (buddy.level ?? 1) >= m.level && !current.has(m.level));
  if (!unlocked.length) return [];
  store.collection.unlockedMilestones[buddy.id] = Array.from(new Set([...current, ...unlocked.map((m) => m.level)])).sort((a, b) => a - b);
  saveGamificationStore(store);
  return unlocked;
}

export function unlockedMilestonesFor(buddyId: string): MilestoneReward[] {
  const levels = new Set(loadGamificationStore().collection.unlockedMilestones[buddyId] ?? []);
  return MILESTONE_REWARDS.filter((m) => levels.has(m.level));
}

export function getActiveTeamBonus(groupMemberIds: string[] | undefined): TeamBonus | null {
  const ids = groupMemberIds ?? [];
  if (ids.length < 2) return null;
  const multiplier = ids.length >= 3 ? 1.15 : 1.10;
  return {
    buddyIds: ids,
    kind: 'task-xp',
    multiplier,
    label: ids.length >= 3 ? '+15% team task XP' : '+10% team task XP',
  };
}

export function recordFavoriteTeam(memberIds: string[]): void {
  if (memberIds.length < 2) return;
  const key = [...memberIds].sort().join('+');
  const store = loadGamificationStore();
  store.collection.favoriteTeams[key] = (store.collection.favoriteTeams[key] ?? 0) + 1;
  saveGamificationStore(store);
}

export function parseBondJson(text: string): BondLlmResult | null {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(text.slice(start, end + 1)) as BondLlmResult;
    return {
      mood: typeof parsed.mood === 'string' ? parsed.mood : undefined,
      bondDelta: typeof parsed.bondDelta === 'number' ? Math.max(0, Math.min(12, Math.floor(parsed.bondDelta))) : undefined,
      memory: typeof parsed.memory === 'string' ? parsed.memory : undefined,
      summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
    };
  } catch {
    return null;
  }
}
