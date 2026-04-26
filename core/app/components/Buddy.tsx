'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { VARIANTS, buildAnimation, cssColor, type Emotion } from './avatars';

const Lottie = dynamic(() => import('lottie-react'), { ssr: false });

type Toast = { id: number; title: string; body: string; tone: 'info' | 'action' | 'success' };
type ChatMsg = { id: number; from: 'buddy' | 'you'; text: string };

const SCRIPTED_TOASTS: Omit<Toast, 'id'>[] = [
  { title: 'Agent dispatched', body: 'Started work on issue #42 — "Add dark mode toggle"', tone: 'info' },
  { title: 'PR ready for review', body: '#118 — refactor: extract toast queue', tone: 'action' },
  { title: 'Tests green', body: '142 / 142 passing on agent-branch/issue-42', tone: 'success' },
  { title: 'Needs your input', body: 'Agent is unsure: should empty state link to /docs or /onboarding?', tone: 'action' },
];

const SCRIPTED_REPLIES = [
  "I'm watching 3 repos right now. Issue #42 is in progress.",
  "I can dispatch an agent on any open issue — just tell me which one.",
  "Last PR I shipped passed all checks. Want me to merge?",
  "I'll ping you with a toast the moment something needs your eyes.",
];

export default function Buddy() {
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([
    { id: 1, from: 'buddy', text: "hi! I'm your vibemoji buddy. ask me anything, or watch the toasts roll in." },
  ]);
  const [input, setInput] = useState('');
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [variantId, setVariantId] = useState('violet');
  const [emotion, setEmotion] = useState<Emotion>('idle');
  const variant = VARIANTS.find((v) => v.id === variantId) ?? VARIANTS[0];
  const animation = useMemo(() => buildAnimation(variant, emotion), [variant, emotion]);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const toastIdRef = useRef(100);
  const msgIdRef = useRef(2);
  const emotionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interactiveRef = useRef(false);
  const openRef = useRef(false);
  openRef.current = open;
  const draggingRef = useRef(false);

  const setInteractive = (on: boolean) => {
    if (interactiveRef.current === on) return;
    interactiveRef.current = on;
    const api = (typeof window !== 'undefined' && (window as any).vibemoji) || null;
    api?.setInteractive?.(on);
  };

  // Click-through is toggled by a global pointer-tracker: if the element
  // under the cursor is inside an [data-buddy-interactive] region, the OS
  // window accepts clicks; otherwise clicks pass to apps behind. We rely on
  // document-level mousemove (forwarded by Electron with `forward: true`)
  // because per-element React handlers don't fire reliably while the window
  // is click-through.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMove = (e: MouseEvent) => {
      if (draggingRef.current) { setInteractive(true); return; }
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const overInteractive = !!el?.closest('[data-buddy-interactive]');
      setInteractive(overInteractive);
    };
    document.addEventListener('mousemove', onMove);
    return () => document.removeEventListener('mousemove', onMove);
  }, []);


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

  useEffect(() => {
    const t = setTimeout(() => pushToast(SCRIPTED_TOASTS[0]), 1800);
    return () => clearTimeout(t);
  }, []);

  const triggerScriptedToast = () => {
    const next = SCRIPTED_TOASTS[Math.floor(Math.random() * SCRIPTED_TOASTS.length)];
    pushToast(next);
  };

  const send = () => {
    const text = input.trim();
    if (!text) return;
    setMessages((m) => [...m, { id: msgIdRef.current++, from: 'you', text }]);
    setInput('');
    feel('thinking', 600);
    setTimeout(() => {
      const reply = SCRIPTED_REPLIES[Math.floor(Math.random() * SCRIPTED_REPLIES.length)];
      setMessages((m) => [...m, { id: msgIdRef.current++, from: 'buddy', text: reply }]);
      feel('happy', 1500);
    }, 600);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: pos.x, baseY: pos.y };
    draggingRef.current = true;
    setInteractive(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPos({ x: dragRef.current.baseX + dx, y: dragRef.current.baseY + dy });
  };
  const onPointerUp = () => {
    dragRef.current = null;
    draggingRef.current = false;
  };

  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-40 flex flex-col items-end gap-3 p-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            data-buddy-interactive
            className={`pointer-events-auto w-80 rounded-2xl border bg-white/95 p-4 shadow-xl backdrop-blur-md transition-all dark:bg-zinc-900/95 ${
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

      <div
        className="fixed bottom-6 right-6 z-50 flex items-end gap-3"
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      >
        {open && (
          <div
            data-buddy-interactive
            className="pointer-events-auto mb-2 flex w-80 flex-col rounded-3xl border border-zinc-200 bg-white/95 shadow-2xl backdrop-blur-md dark:border-zinc-700 dark:bg-zinc-900/95"
            style={{ height: 380, animation: 'buddy-bubble-in 220ms ease-out' }}
          >
            <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">buddy · {variant.name}</p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">● online · watching 3 repos</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={triggerScriptedToast}
                    className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-200 dark:bg-violet-500/20 dark:text-violet-300"
                  >
                    ping
                  </button>
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
                      onClick={() => setVariantId(v.id)}
                      title={v.name}
                      aria-label={`Use ${v.name} avatar`}
                      className={`h-5 w-5 rounded-full ring-2 ring-offset-1 transition-transform hover:scale-110 dark:ring-offset-zinc-900 ${
                        v.id === variantId ? 'ring-zinc-900 dark:ring-white' : 'ring-transparent'
                      }`}
                      style={{ background: cssColor(v.body) }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
              {messages.map((m) => (
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
                  placeholder="say hi to your buddy…"
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
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onClick={(e) => {
            if (Math.abs(pos.x - (dragRef.current?.baseX ?? pos.x)) < 4 && !open) {
              setOpen(true);
              feel('love', 1400);
            }
          }}
          onPointerEnter={() => feel('happy', 1200)}
          className="pointer-events-auto h-28 w-28 cursor-grab rounded-full transition-transform hover:scale-105 active:cursor-grabbing active:scale-95"
          aria-label="open buddy"
        >
          <Lottie animationData={animation} loop autoplay />
        </button>
      </div>

      <style jsx global>{`
        @keyframes buddy-toast-in {
          from { opacity: 0; transform: translateY(-8px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes buddy-bubble-in {
          from { opacity: 0; transform: translateY(8px) scale(0.96); transform-origin: bottom right; }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </>
  );
}
