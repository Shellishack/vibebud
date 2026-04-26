'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { VARIANTS, buildAnimation, cssColor, type Emotion } from './avatars';
import { PERSONALITY_BY_VARIANT, type Personality } from './personalities';

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
};

type Props = {
  state: BuddyInstanceState;
  anchor: { right: number; bottom: number };
  canRemove: boolean;
  onChange: (next: BuddyInstanceState) => void;
  onSpawn: () => void;
  onRemove: () => void;
};

export default function BuddyInstance({ state, anchor, canRemove, onChange, onSpawn, onRemove }: Props) {
  const personality: Personality =
    PERSONALITY_BY_VARIANT[state.variantId] ?? PERSONALITY_BY_VARIANT.violet;

  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [input, setInput] = useState('');
  const [emotion, setEmotion] = useState<Emotion>('idle');

  const variant = VARIANTS.find((v) => v.id === state.variantId) ?? VARIANTS[0];
  const animation = useMemo(() => buildAnimation(variant, emotion), [variant, emotion]);

  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const draggingRef = useRef(false);
  const toastIdRef = useRef(100);
  const msgIdRef = useRef(state.messages.reduce((m, x) => Math.max(m, x.id), 0) + 1);
  const emotionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const update = (patch: Partial<BuddyInstanceState>) => onChange({ ...stateRef.current, ...patch });

  const feel = (next: Emotion, ms = 1600) => {
    if (emotionTimerRef.current) clearTimeout(emotionTimerRef.current);
    setEmotion(next);
    emotionTimerRef.current = setTimeout(() => setEmotion('idle'), ms);
  };

  const pushToast = (t: Omit<Toast, 'id'>) => {
    const id = toastIdRef.current++;
    setToasts((cur) => [...cur, { ...t, id }]);
    feel(t.tone === 'action' ? 'surprised' : t.tone === 'success' ? 'happy' : 'surprised', 1800);
    setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), 5200);
  };

  const triggerScriptedToast = () => {
    pushToast(SCRIPTED_TOASTS[Math.floor(Math.random() * SCRIPTED_TOASTS.length)]);
  };

  const send = () => {
    const text = input.trim();
    if (!text) return;
    const userMsg: ChatMsg = { id: msgIdRef.current++, from: 'you', text };
    update({ messages: [...stateRef.current.messages, userMsg] });
    setInput('');
    feel('thinking', 600);
    setTimeout(() => {
      const reply = personality.replies[Math.floor(Math.random() * personality.replies.length)];
      const buddyMsg: ChatMsg = { id: msgIdRef.current++, from: 'buddy', text: reply };
      update({ messages: [...stateRef.current.messages, buddyMsg] });
      feel('happy', 1500);
    }, 600);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: state.pos.x, baseY: state.pos.y };
    draggingRef.current = true;
    const dragSet: Set<string> = ((window as any).__vibemojiDragging ||= new Set<string>());
    dragSet.add(state.id);
    (window as any).vibemoji?.setInteractive?.(true);

    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      update({ pos: { x: dragRef.current.baseX + dx, y: dragRef.current.baseY + dy } });
    };
    const stop = () => {
      dragRef.current = null;
      draggingRef.current = false;
      dragSet.delete(state.id);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', stop);
      document.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', stop);
    document.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
  };

  return (
    <div
      className="fixed z-50"
      style={{
        right: anchor.right,
        bottom: anchor.bottom,
        transform: `translate(${state.pos.x}px, ${state.pos.y}px)`,
      }}
    >
      {/* Toast stack — anchored above this buddy. */}
      <div className="pointer-events-none absolute bottom-full right-0 mb-3 flex w-80 flex-col gap-2">
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
        {open && (
          <div
            data-buddy-interactive
            className="pointer-events-auto mb-2 flex w-80 flex-col rounded-3xl border border-zinc-200 bg-white/95 shadow-2xl backdrop-blur-md dark:border-zinc-700 dark:bg-zinc-900/95"
            style={{ height: 380, animation: 'buddy-bubble-in 220ms ease-out' }}
          >
            <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{personality.name} · {variant.name}</p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">● online · watching 3 repos</p>
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
            <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
              {state.messages.length === 0 && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-2xl bg-zinc-100 px-3 py-2 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
                    {personality.greeting}
                  </div>
                </div>
              )}
              {state.messages.map((m) => (
                <div key={m.id} className={`flex ${m.from === 'you' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                    m.from === 'you'
                      ? 'bg-violet-600 text-white'
                      : 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                  }`}>
                    {m.text}
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-zinc-200 p-2 dark:border-zinc-700">
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send()}
                  placeholder={`talk to ${personality.name}…`}
                  className="flex-1 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
                <button
                  onClick={send}
                  className="rounded-full bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
                >
                  send
                </button>
              </div>
            </div>
          </div>
        )}

        <button
          data-buddy-interactive
          onPointerDown={onPointerDown}
          onClick={() => {
            if (Math.abs(state.pos.x - (dragRef.current?.baseX ?? state.pos.x)) < 4 && !open) {
              setOpen(true);
              feel('love', 1400);
            }
          }}
          onPointerEnter={() => feel('happy', 1200)}
          className="pointer-events-auto h-28 w-28 cursor-grab rounded-full transition-transform hover:scale-105 active:cursor-grabbing active:scale-95"
          aria-label={`open ${personality.name}`}
        >
          <Lottie animationData={animation} loop autoplay />
        </button>
      </div>
    </div>
  );
}
