'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { usePlatform, useLayout } from './hooks/usePlatform';
import { VARIANTS, buildAnimation, cssColor, type Emotion } from './avatars';
import { PERSONALITY_BY_VARIANT, type Personality } from './personalities';
import {
  buildSystemPrompt, streamChat, trimHistory, fetchModels,
  getProvider, setProvider, getApiKey, setApiKey, getModel, setModel,
  PROVIDERS,
  type ChatTurn, type Teammate, type ProviderId,
} from './llm';

const Lottie = dynamic(() => import('lottie-react'), { ssr: false });

export type Toast = { id: number; title: string; body: string; tone: 'info' | 'action' | 'success' };
export type ChatMsg = { id: number; from: 'buddy' | 'you'; text: string };

const SCRIPTED_TOASTS: Omit<Toast, 'id'>[] = [
  { title: 'Agent dispatched', body: 'Started work on issue #42 — "Add dark mode toggle"', tone: 'info' },
  { title: 'PR ready for review', body: '#118 — refactor: extract toast queue', tone: 'action' },
  { title: 'Tests green', body: '142 / 142 passing on agent-branch/issue-42', tone: 'success' },
  { title: 'Needs your input', body: 'Agent is unsure: should empty state link to /docs or /onboarding?', tone: 'action' },
];

export type BuddyInstanceState = {
  id: string;
  variantId: string;
  pos: { x: number; y: number };
  messages: ChatMsg[];
  groupId?: string;
};

type Props = {
  state: BuddyInstanceState;
  anchor: { right: number; bottom: number };
  canRemove: boolean;
  onChange: (next: BuddyInstanceState) => void;
  onSpawn: () => void;
  onRemove: () => void;
  onOpenChange?: (id: string, open: boolean) => void;
  onDragMove?: (id: string, pos: { x: number; y: number }) => void;
  onDragEnd?: (id: string, pos: { x: number; y: number }, moved: boolean) => void;
  magnetState?: 'attractor' | 'target' | null;
  teammates?: Teammate[];
};

export default function BuddyInstance({ state, anchor, canRemove, onChange, onSpawn, onRemove, onOpenChange, onDragMove, onDragEnd, magnetState, teammates }: Props) {
  const personality: Personality =
    PERSONALITY_BY_VARIANT[state.variantId] ?? PERSONALITY_BY_VARIANT.violet;

  const adapter = usePlatform();
  const layout = useLayout();
  const isMobile = layout.chatPanelMode === 'sheet';

  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [input, setInput] = useState('');
  const [emotion, setEmotion] = useState<Emotion>('idle');
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providerDraft, setProviderDraft] = useState<ProviderId>('openai');
  const [keyDraft, setKeyDraft] = useState('');
  const [modelDraft, setModelDraft] = useState('');
  const [modelList, setModelList] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const modelsAbortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const teammatesRef = useRef<Teammate[]>(teammates ?? []);
  useEffect(() => { teammatesRef.current = teammates ?? []; }, [teammates]);

  const loadModelsFor = (p: ProviderId, key: string) => {
    modelsAbortRef.current?.abort();
    const ac = new AbortController();
    modelsAbortRef.current = ac;
    setLoadingModels(true);
    setModelList([]);
    fetchModels(p, key, ac.signal)
      .then((list) => { if (!ac.signal.aborted) setModelList(list); })
      .finally(() => { if (!ac.signal.aborted) setLoadingModels(false); });
  };

  const openSettings = () => {
    const cur = getProvider();
    const k = getApiKey(cur);
    const m = getModel(cur);
    setProviderDraft(cur);
    setKeyDraft(k);
    setModelDraft(m);
    setSettingsOpen(true);
    loadModelsFor(cur, k);
  };

  const switchProvider = (p: ProviderId) => {
    const k = getApiKey(p);
    const m = getModel(p);
    setProviderDraft(p);
    setKeyDraft(k);
    setModelDraft(m);
    loadModelsFor(p, k);
  };

  const saveSettings = () => {
    const k = keyDraft.trim();
    const m = modelDraft.trim() || PROVIDERS[providerDraft].defaultModel;
    setProvider(providerDraft);
    setApiKey(providerDraft, k);
    setModel(providerDraft, m);
    setSettingsOpen(false);
  };

  const variant = VARIANTS.find((v) => v.id === state.variantId) ?? VARIANTS[0];
  const animation = useMemo(() => buildAnimation(variant, emotion), [variant, emotion]);

  const dragRef = useRef<{ startScreenX: number; startScreenY: number; baseX: number; baseY: number; moved: boolean } | null>(null);
  const draggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const justDraggedRef = useRef(false);
  const toastIdRef = useRef(100);
  const msgIdRef = useRef(state.messages.reduce((m, x) => Math.max(m, x.id), 0) + 1);
  const emotionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { onOpenChange?.(state.id, open); }, [open, state.id, onOpenChange]);
  useEffect(() => {
    if (!open) return;
    messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [open, state.messages]);
  const update = (patch: Partial<BuddyInstanceState>) => onChange({ ...stateRef.current, ...patch });

  const feel = (next: Emotion, ms = 1600) => {
    if (emotionTimerRef.current) clearTimeout(emotionTimerRef.current);
    setEmotion(next);
    emotionTimerRef.current = setTimeout(() => setEmotion('idle'), ms);
  };

  useEffect(() => {
    if (emotion !== 'idle') return;
    const pool: Emotion[] = [
      'happy', 'surprised', 'thinking', 'love', 'sad', 'sleepy',
      'angry', 'excited', 'shy', 'cool', 'wink', 'confused', 'proud', 'sick',
    ];
    const delay = 2200 + Math.random() * 2800;
    const t = setTimeout(() => {
      const pick = pool[Math.floor(Math.random() * pool.length)];
      feel(pick, 1400 + Math.random() * 1200);
    }, delay);
    return () => clearTimeout(t);
  }, [emotion]);

  const pushToast = (t: Omit<Toast, 'id'>) => {
    const id = toastIdRef.current++;
    setToasts((cur) => [...cur, { ...t, id }]);
    feel(t.tone === 'action' ? 'surprised' : t.tone === 'success' ? 'excited' : 'surprised', 1800);
    setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), 5200);
  };

  const triggerScriptedToast = () => {
    pushToast(SCRIPTED_TOASTS[Math.floor(Math.random() * SCRIPTED_TOASTS.length)]);
  };

  const writeMessages = (msgs: ChatMsg[]) => {
    update({ messages: msgs });
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    if (!getApiKey()) {
      openSettings();
      return;
    }
    const userMsg: ChatMsg = { id: msgIdRef.current++, from: 'you', text };
    const replyId = msgIdRef.current++;
    const baseMessages = [...stateRef.current.messages, userMsg];
    writeMessages([...baseMessages, { id: replyId, from: 'buddy', text: '' }]);
    setInput('');
    setBusy(true);
    feel('thinking', 1400);

    const turns: ChatTurn[] = baseMessages.map((m) => ({
      role: m.from === 'you' ? 'user' : 'assistant',
      content: m.text,
    }));
    const sys = buildSystemPrompt(personality, teammatesRef.current);

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    let acc = '';
    try {
      for await (const chunk of streamChat({
        system: sys, messages: trimHistory(turns), signal: ac.signal,
      })) {
        acc += chunk;
        writeMessages([...baseMessages, { id: replyId, from: 'buddy', text: acc }]);
      }
      feel('happy', 1500);
    } catch (e: unknown) {
      if (ac.signal.aborted) return;
      const msg = e instanceof Error ? e.message : String(e);
      writeMessages([
        ...baseMessages,
        { id: replyId, from: 'buddy', text: acc ? `${acc}\n\n(error: ${msg})` : `(error: ${msg})` },
      ]);
      feel('sad', 1500);
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setBusy(false);
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    // Defensive: if a previous drag never received pointerup/pointercancel
    // (can happen on Android when a finger leaves the touchable region on a
    // hardened OEM ROM), the buddy gets stuck with draggingRef + the click
    // suppressor justDraggedRef set, making it look unresponsive. Reset both
    // before starting a fresh gesture.
    if (dragRef.current || draggingRef.current) {
      dragRef.current = null;
      draggingRef.current = false;
      justDraggedRef.current = false;
      setIsDragging(false);
      ((window as any).__vibemojiDragging as Set<string> | undefined)?.delete(state.id);
    }
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* noop */ }
    draggingRef.current = true;
    setIsDragging(true);
    adapter.notifyDragStart(state.id);
    const dragSet: Set<string> = ((window as any).__vibemojiDragging ||= new Set<string>());
    dragSet.add(state.id);

    let raf = 0;
    let cancelled = false;
    let onPointerMove: ((ev: PointerEvent) => void) | null = null;

    const applyDelta = (dx: number, dy: number) => {
      if (!dragRef.current) return;
      if (!dragRef.current.moved && Math.abs(dx) + Math.abs(dy) > 4) {
        dragRef.current.moved = true;
      }
      const nextPos = { x: dragRef.current.baseX + dx, y: dragRef.current.baseY + dy };
      update({ pos: nextPos });
      onDragMove?.(state.id, nextPos);
    };

    const cursorPromise = adapter.getCursorPoint();
    if (cursorPromise) {
      // Electron path: poll OS cursor each frame so we don't expand the
      // click-through window (which would evict Chromium's video overlay).
      cursorPromise.then((origin) => {
        if (cancelled) return;
        dragRef.current = {
          startScreenX: origin.x, startScreenY: origin.y,
          baseX: stateRef.current.pos.x, baseY: stateRef.current.pos.y,
          moved: false,
        };
        const tick = () => {
          if (!dragRef.current) return;
          const p = adapter.getCursorPoint();
          if (!p) return;
          p.then((pt) => {
            if (!dragRef.current) return;
            applyDelta(pt.x - dragRef.current.startScreenX, pt.y - dragRef.current.startScreenY);
            raf = requestAnimationFrame(tick);
          });
        };
        raf = requestAnimationFrame(tick);
      });
    } else {
      // Browser path: standard pointermove tracking.
      dragRef.current = {
        startScreenX: e.clientX, startScreenY: e.clientY,
        baseX: stateRef.current.pos.x, baseY: stateRef.current.pos.y,
        moved: false,
      };
      onPointerMove = (ev: PointerEvent) => {
        if (!dragRef.current) return;
        applyDelta(ev.clientX - dragRef.current.startScreenX, ev.clientY - dragRef.current.startScreenY);
      };
      document.addEventListener('pointermove', onPointerMove);
    }

    const stop = () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      const moved = !!dragRef.current?.moved;
      justDraggedRef.current = moved;
      onDragEnd?.(state.id, stateRef.current.pos, moved);
      dragRef.current = null;
      draggingRef.current = false;
      setIsDragging(false);
      adapter.notifyDragEnd(state.id);
      dragSet.delete(state.id);
      if (onPointerMove) document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', stop);
      document.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
    };
    document.addEventListener('pointerup', stop);
    document.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
  };

  return (
    <div
      data-buddy-member
      data-group={state.groupId || undefined}
      className="fixed z-50"
      style={{
        right: anchor.right,
        bottom: anchor.bottom,
        transform: `translate(${state.pos.x}px, ${state.pos.y}px)`,
        transition: isDragging ? 'none' : 'transform 360ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      {/* Toast stack — anchored above this buddy on desktop, full-width
          bottom-anchored on mobile (the buddy lives at the bottom-right edge
          of a phone screen so the desktop right-anchored 320 px stack would
          overflow off-screen). */}
      {isMobile && toasts.length > 0 && typeof document !== 'undefined' && createPortal(
        <div className="pointer-events-none fixed left-3 right-3 bottom-36 z-[60] flex flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              data-buddy-interactive
              className={`pointer-events-auto rounded-2xl border bg-white/95 p-4 shadow-xl backdrop-blur-md transition-all dark:bg-zinc-900/95 ${
                t.tone === 'action' ? 'border-violet-300 dark:border-violet-500/50'
                : t.tone === 'success' ? 'border-emerald-300 dark:border-emerald-500/50'
                : 'border-zinc-200 dark:border-zinc-700'
              }`}
              style={{ animation: 'buddy-toast-in 240ms ease-out' }}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                  t.tone === 'action' ? 'bg-violet-500' : t.tone === 'success' ? 'bg-emerald-500' : 'bg-zinc-400'
                }`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{t.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{t.body}</p>
                </div>
              </div>
            </div>
          ))}
        </div>,
        document.body,
      )}
      <div className={`pointer-events-none absolute bottom-full right-0 mb-3 flex w-80 flex-col gap-2 ${isMobile ? 'hidden' : ''}`}>
        {toasts.map((t) => (
          <div
            key={t.id}
            data-buddy-interactive
            className={`pointer-events-auto rounded-2xl border bg-white/95 p-4 shadow-xl backdrop-blur-md transition-all dark:bg-zinc-900/95 ${
              t.tone === 'action' ? 'border-violet-300 dark:border-violet-500/50'
              : t.tone === 'success' ? 'border-emerald-300 dark:border-emerald-500/50'
              : 'border-zinc-200 dark:border-zinc-700'
            }`}
            style={{ animation: 'buddy-toast-in 240ms ease-out' }}
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                t.tone === 'action' ? 'bg-violet-500' : t.tone === 'success' ? 'bg-emerald-500' : 'bg-zinc-400'
              }`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{t.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{t.body}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-end gap-3">
        {open && (() => {
          const panel = (
          <div
            data-buddy-interactive
            className={isMobile
              ? "pointer-events-auto fixed left-3 right-3 bottom-3 z-[60] flex flex-col rounded-3xl border border-zinc-200 bg-white/95 shadow-2xl backdrop-blur-md dark:border-zinc-700 dark:bg-zinc-900/95"
              : "pointer-events-auto mb-2 flex w-80 flex-col rounded-3xl border border-zinc-200 bg-white/95 shadow-2xl backdrop-blur-md dark:border-zinc-700 dark:bg-zinc-900/95"
            }
            style={isMobile
              ? { maxHeight: '85vh', animation: 'buddy-bubble-in 220ms ease-out' }
              : { height: 380, animation: 'buddy-bubble-in 220ms ease-out' }
            }
          >
            <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{personality.name} · {variant.name}</p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">● {personality.role}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={triggerScriptedToast}
                    title="Fire a sample toast"
                    className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-200 dark:bg-violet-500/20 dark:text-violet-300"
                  >
                    ping
                  </button>
                  <button
                    onClick={() => (settingsOpen ? setSettingsOpen(false) : openSettings())}
                    title="LLM settings"
                    aria-label="LLM settings"
                    className="grid h-7 w-7 place-items-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.36.16.66.42.87.74A1.65 1.65 0 0 0 21 10h.09a2 2 0 1 1 0 4H21a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                  </button>
                  <button
                    onClick={onSpawn}
                    title="Add a new buddy"
                    aria-label="Add a new buddy"
                    className="grid h-7 w-7 place-items-center rounded-full text-zinc-500 hover:bg-emerald-100 hover:text-emerald-700 dark:text-zinc-400 dark:hover:bg-emerald-500/20 dark:hover:text-emerald-300"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                  {canRemove && (
                    <button
                      onClick={onRemove}
                      title="Dismiss this buddy"
                      aria-label="Dismiss this buddy"
                      className="grid h-7 w-7 place-items-center rounded-full text-zinc-500 hover:bg-rose-100 hover:text-rose-700 dark:text-zinc-400 dark:hover:bg-rose-500/20 dark:hover:text-rose-300"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                        <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={() => setOpen(false)}
                    aria-label="Close chat"
                    className="grid h-7 w-7 place-items-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">avatar</span>
                <div className="flex gap-1.5">
                  {VARIANTS.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => update({ variantId: v.id })}
                      title={v.name}
                      aria-label={`Use ${v.name} avatar`}
                      className={`h-5 w-5 rounded-full ring-2 ring-offset-1 transition-transform hover:scale-110 dark:ring-offset-zinc-900 ${
                        v.id === state.variantId ? 'ring-zinc-900 dark:ring-white' : 'ring-transparent'
                      }`}
                      style={{ background: cssColor(v.body) }}
                    />
                  ))}
                </div>
              </div>
            </div>
            {settingsOpen && (
              <div className="max-h-64 shrink-0 overflow-y-auto border-b border-zinc-200 bg-zinc-50/80 px-4 py-3 text-xs dark:border-zinc-700 dark:bg-zinc-800/50">
                <p className="mb-2 font-semibold text-zinc-700 dark:text-zinc-200">LLM settings</p>

                <label className="mb-1 block text-zinc-600 dark:text-zinc-400">Provider</label>
                <div className="mb-2 flex gap-1">
                  {(Object.keys(PROVIDERS) as ProviderId[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => switchProvider(p)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        providerDraft === p
                          ? 'bg-violet-600 text-white'
                          : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {PROVIDERS[p].label}
                    </button>
                  ))}
                </div>

                <label className="mb-1 block text-zinc-600 dark:text-zinc-400">{PROVIDERS[providerDraft].label} API key</label>
                <input
                  type="password"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  onBlur={() => loadModelsFor(providerDraft, keyDraft.trim())}
                  placeholder={PROVIDERS[providerDraft].keyPlaceholder}
                  className="mb-2 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1 outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />

                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-zinc-600 dark:text-zinc-400">Model</label>
                  <button
                    onClick={() => loadModelsFor(providerDraft, keyDraft.trim())}
                    className="text-[10px] text-violet-600 hover:underline disabled:opacity-50 dark:text-violet-400"
                    disabled={loadingModels}
                  >
                    {loadingModels ? 'loading…' : 'refresh'}
                  </button>
                </div>
                <input
                  type="text"
                  list={`buddy-models-${state.id}`}
                  value={modelDraft}
                  onChange={(e) => setModelDraft(e.target.value)}
                  placeholder={PROVIDERS[providerDraft].defaultModel}
                  className="mb-2 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1 outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
                <datalist id={`buddy-models-${state.id}`}>
                  {(modelList.length ? modelList : PROVIDERS[providerDraft].knownModels).map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setSettingsOpen(false)}
                    className="rounded-full px-2.5 py-1 text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  >
                    cancel
                  </button>
                  <button
                    onClick={saveSettings}
                    className="rounded-full bg-violet-600 px-2.5 py-1 font-medium text-white hover:bg-violet-700"
                  >
                    save
                  </button>
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                  Stored locally in this browser only. Calls go direct from your browser to {PROVIDERS[providerDraft].label}.
                </p>
              </div>
            )}
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 py-3">
              {state.messages.length === 0 && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl bg-zinc-100 px-3 py-2 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
                    {personality.greeting}
                  </div>
                </div>
              )}
              {state.messages.map((m) => (
                <div key={m.id} className={`flex ${m.from === 'you' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                    m.from === 'you'
                      ? 'bg-violet-600 text-white'
                      : 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                  }`}>
                    {m.text || (busy && m.from === 'buddy' ? '…' : '')}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <div className="border-t border-zinc-200 p-2 dark:border-zinc-700">
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
                  disabled={busy}
                  placeholder={busy ? `${personality.name} is typing…` : `talk to ${personality.name}…`}
                  className="flex-1 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-violet-400 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
                {busy ? (
                  <button
                    onClick={() => abortRef.current?.abort()}
                    className="rounded-full bg-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
                  >
                    stop
                  </button>
                ) : (
                  <button
                    onClick={() => void send()}
                    className="rounded-full bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
                  >
                    send
                  </button>
                )}
              </div>
            </div>
          </div>
          );
          if (isMobile && typeof document !== 'undefined') {
            return createPortal(
              <>
                <div
                  data-buddy-interactive
                  onClick={() => setOpen(false)}
                  className="fixed inset-0 z-[55] bg-black/30 backdrop-blur-sm"
                  style={{ animation: 'buddy-bubble-in 180ms ease-out' }}
                />
                {panel}
              </>,
              document.body,
            );
          }
          return panel;
        })()}

        <div className="relative">
          {magnetState && (
            <>
              <span
                aria-hidden
                className={`pointer-events-none absolute inset-0 rounded-full ${
                  magnetState === 'target'
                    ? 'ring-4 ring-violet-400/80 shadow-[0_0_28px_6px_rgba(167,139,250,0.55)]'
                    : 'ring-4 ring-emerald-400/80 shadow-[0_0_28px_6px_rgba(52,211,153,0.55)]'
                }`}
                style={{ animation: 'buddy-magnet-pulse 1100ms ease-in-out infinite' }}
              />
              <span
                aria-hidden
                className={`pointer-events-none absolute inset-0 rounded-full ${
                  magnetState === 'target' ? 'ring-2 ring-violet-300/70' : 'ring-2 ring-emerald-300/70'
                }`}
                style={{ animation: 'buddy-magnet-ping 1100ms ease-out infinite' }}
              />
            </>
          )}
          <button
            data-buddy-interactive
            onPointerDown={onPointerDown}
            onClick={() => {
              if (justDraggedRef.current) {
                justDraggedRef.current = false;
                return;
              }
              if (!open) {
                setOpen(true);
                feel('love', 1400);
              }
            }}
            onPointerEnter={() => feel('happy', 1200)}
            className={`pointer-events-auto relative h-28 w-28 cursor-grab rounded-full transition-transform hover:scale-105 active:cursor-grabbing active:scale-95 ${
              magnetState === 'target' ? 'scale-110' : magnetState === 'attractor' ? 'scale-105' : ''
            }`}
            aria-label={`open ${personality.name}`}
          >
            <div className="h-full w-full" style={{ animation: 'buddy-bob 3s ease-in-out infinite' }}>
              <Lottie animationData={animation} loop autoplay />
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
