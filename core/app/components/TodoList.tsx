'use client';

import dynamic from 'next/dynamic';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { buildAnimation, getNotoCodepoint, VARIANTS, type FacesWithHandsComposition, type NotoGroup } from './avatars';
import { getPersonality } from './personalities';
import { getCachedLottie, loadLottie } from '../../lib/notoEmoji';

const Lottie = dynamic(() => import('lottie-react'), { ssr: false });

type BuddyTodo = {
  id: string;
  title: string;
  buddyId: string;
  completed: boolean;
  createdAt: string;
};

type BuddyTodoStore = {
  todos: BuddyTodo[];
};

type BuddySnapshot = {
  id: string;
  variantId: string;
  avatar?: { kind: 'noto'; group: NotoGroup; composition?: FacesWithHandsComposition };
};

const TODO_STORAGE_KEY = 'vibemoji.todos.v1';
const BUDDY_STORAGE_KEY = 'vibemoji.buddies.v2';

export default function TodoList() {
  const [buddies, setBuddies] = useState<BuddySnapshot[]>([]);
  const [todos, setTodos] = useState<BuddyTodo[]>(() => loadTodos());
  const [title, setTitle] = useState('');
  const [selectedBuddyId, setSelectedBuddyId] = useState('');

  useEffect(() => {
    const refreshBuddies = () => setBuddies(loadBuddySnapshots());
    refreshBuddies();
    const interval = window.setInterval(refreshBuddies, 1500);
    window.addEventListener('storage', refreshBuddies);
    window.addEventListener('focus', refreshBuddies);
    document.addEventListener('visibilitychange', refreshBuddies);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('storage', refreshBuddies);
      window.removeEventListener('focus', refreshBuddies);
      document.removeEventListener('visibilitychange', refreshBuddies);
    };
  }, []);

  const buddyById = useMemo(() => new Map(buddies.map((buddy) => [buddy.id, buddy])), [buddies]);
  const activeBuddyId = selectedBuddyId && buddyById.has(selectedBuddyId) ? selectedBuddyId : (buddies[0]?.id ?? '');
  const openTodos = todos.filter((todo) => !todo.completed);
  const doneTodos = todos.filter((todo) => todo.completed);

  const saveTodos = (next: BuddyTodo[]) => {
    setTodos(next);
    persistTodos(next);
  };

  const addTodo = (event: FormEvent) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle || !activeBuddyId) return;
    saveTodos([
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        title: cleanTitle,
        buddyId: activeBuddyId,
        completed: false,
        createdAt: new Date().toISOString(),
      },
      ...todos,
    ]);
    setTitle('');
  };

  const toggleTodo = (id: string) => {
    saveTodos(todos.map((todo) => todo.id === id ? { ...todo, completed: !todo.completed } : todo));
  };

  const removeTodo = (id: string) => {
    saveTodos(todos.filter((todo) => todo.id !== id));
  };

  return (
    <section className="w-full max-w-2xl">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">todo board</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">assign work to a buddy by choosing their avatar.</p>
        </div>
        <span className="shrink-0 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs font-medium text-zinc-600 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">
          {openTodos.length} open
        </span>
      </div>

      <form onSubmit={addTodo} className="rounded-2xl border border-zinc-200 bg-white/75 p-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/65">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="add a task"
            className="min-h-11 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-950/60 dark:text-zinc-50 dark:placeholder:text-zinc-500"
          />
          <button
            type="submit"
            disabled={!title.trim() || !activeBuddyId}
            className="min-h-11 rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400"
          >
            add
          </button>
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {buddies.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">create a buddy first to assign tasks.</p>
          ) : buddies.map((buddy) => {
            const personality = getPersonality(buddy.variantId);
            const selected = activeBuddyId === buddy.id;
            return (
              <button
                key={buddy.id}
                type="button"
                onClick={() => setSelectedBuddyId(buddy.id)}
                aria-label={`Assign to ${personality.name}`}
                title={personality.name}
                className={`grid h-14 w-14 shrink-0 place-items-center rounded-full border bg-white transition-all dark:bg-zinc-950 ${
                  selected
                    ? 'border-violet-500 ring-2 ring-violet-300 dark:border-violet-300 dark:ring-violet-500/60'
                    : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-500'
                }`}
              >
                <AvatarPfp buddy={buddy} size="md" />
              </button>
            );
          })}
        </div>
      </form>

      <div className="mt-3 space-y-2">
        {[...openTodos, ...doneTodos].map((todo) => {
          const buddy = buddyById.get(todo.buddyId) ?? buddies[0];
          const personality = buddy ? getPersonality(buddy.variantId) : null;
          return (
            <div
              key={todo.id}
              className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white/75 px-3 py-2.5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/65"
            >
              <button
                type="button"
                onClick={() => toggleTodo(todo.id)}
                aria-label={todo.completed ? 'Mark todo incomplete' : 'Mark todo complete'}
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                  todo.completed
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : 'border-zinc-300 text-transparent hover:border-zinc-500 dark:border-zinc-600'
                }`}
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12l4 4L19 6" />
                </svg>
              </button>
              {buddy && <AvatarPfp buddy={buddy} size="sm" />}
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-medium text-zinc-900 dark:text-zinc-50 ${todo.completed ? 'line-through opacity-55' : ''}`}>
                  {todo.title}
                </p>
                {personality && <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{personality.name}</p>}
              </div>
              <button
                type="button"
                onClick={() => removeTodo(todo.id)}
                aria-label="Delete todo"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15" />
                </svg>
              </button>
            </div>
          );
        })}
        {todos.length === 0 && (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/45 px-4 py-6 text-center text-sm text-zinc-500 backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/35 dark:text-zinc-400">
            no tasks yet
          </div>
        )}
      </div>
    </section>
  );
}

function AvatarPfp({ buddy, size }: { buddy: BuddySnapshot; size: 'sm' | 'md' }) {
  const variant = VARIANTS.find((item) => item.id === buddy.variantId) ?? VARIANTS[0];
  const fallbackAnimation = useMemo(() => buildAnimation(variant, 'idle'), [variant]);
  const notoCodepoint = buddy.avatar?.kind === 'noto'
    ? buddy.avatar.group === 'facesWithHands'
      ? buddy.avatar.composition?.face
      : getNotoCodepoint(buddy.avatar.group, 'idle')
    : null;
  const [fetchedNoto, setFetchedNoto] = useState<Record<string, object>>({});
  const notoData = notoCodepoint ? ((fetchedNoto[notoCodepoint] ?? getCachedLottie(notoCodepoint)) as object | null) : null;

  useEffect(() => {
    let cancelled = false;
    if (!notoCodepoint || fetchedNoto[notoCodepoint] || getCachedLottie(notoCodepoint)) return;
    loadLottie(notoCodepoint)
      .then((data) => {
        if (!cancelled) setFetchedNoto((current) => ({ ...current, [notoCodepoint]: data as object }));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [fetchedNoto, notoCodepoint]);

  return (
    <span
      className={`block overflow-hidden rounded-full ${size === 'sm' ? 'h-9 w-9' : 'h-12 w-12'}`}
      style={{ backgroundColor: `rgba(${Math.round(variant.body[0] * 255)}, ${Math.round(variant.body[1] * 255)}, ${Math.round(variant.body[2] * 255)}, 0.14)` }}
    >
      <Lottie animationData={notoData ?? fallbackAnimation} loop autoplay />
    </span>
  );
}

function loadBuddySnapshots(): BuddySnapshot[] {
  const fallback = [{ id: 'buddy-1', variantId: 'violet' }];
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(BUDDY_STORAGE_KEY) || 'null') as { buddies?: BuddySnapshot[] } | null;
    return Array.isArray(parsed?.buddies) && parsed.buddies.length > 0 ? parsed.buddies : fallback;
  } catch {
    return fallback;
  }
}

function loadTodos(): BuddyTodo[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(TODO_STORAGE_KEY) || 'null') as BuddyTodoStore | null;
    return Array.isArray(parsed?.todos) ? parsed.todos : [];
  } catch {
    return [];
  }
}

function persistTodos(todos: BuddyTodo[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify({ todos }));
}
