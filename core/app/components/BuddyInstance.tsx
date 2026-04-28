'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { usePlatform, useLayout } from './hooks/usePlatform';
import { VARIANTS, buildAnimation, cssColor, getNotoCodepoint, NOTO_GROUPS, sampleFacesWithHands, type Emotion, type NotoGroup, type FacesWithHandsComposition } from './avatars';
import { PERSONALITY_BY_VARIANT, type Personality } from './personalities';
import {
  buildSystemPrompt, streamChat, trimHistory, fetchModels,
  getProvider, setProvider, getApiKey, setApiKey, getModel, setModel,
  PROVIDERS,
  type ChatTurn, type Teammate, type ProviderId,
} from './llm';
import { routePing } from './notify';
import { getCachedLottie, loadLottie } from '../../lib/notoEmoji';

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
  // When set, the buddy is docked to a screen edge with only its visible
  // half on-screen. lastFreePos remembers where to slide back on restore.
  minimized?: { edge: 'left' | 'right' | 'top' | 'bottom' };
  lastFreePos?: { x: number; y: number };
  // Custom avatar family. When set to `noto`, the procedurally-built
  // color-variant Lottie is replaced by a Noto Animated Emoji from the
  // chosen group; codepoint within the group is picked per current
  // emotion. The variantId is still used for personality/persona
  // resolution and the group hull color.
  // For 'facesWithHands', `composition` is the resolved 5-emoji composite.
  // It's resampled on emotion change (or set by the LLM) and persisted with
  // the rest of the buddy state.
  avatar?: { kind: 'noto'; group: NotoGroup; composition?: FacesWithHandsComposition };
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
  // Live edge-magnet hint while dragging — set to the edge the buddy will
  // snap to on release. Used to render a glow as a "you're in the snap
  // zone" cue.
  edgeMagnet?: 'left' | 'right' | 'top' | 'bottom' | null;
  teammates?: Teammate[];
  isGroupExpanded?: boolean;
  isGroupMinimized?: boolean;
  onGroupTap?: (gid: string) => void;
  onRestore?: () => void;
  onGroupRestore?: (gid: string) => void;
  // Hover-peek-out (desktop / web). While true, the buddy/group renders at
  // its peeked position (fully visible at the docking edge) but state stays
  // minimized — cursor leaving without a drag re-docks. Drag from peek
  // commits the restore.
  dockPeeked?: boolean;
  groupDockPeeked?: boolean;
  onDockPeek?: () => void;
  onDockUnpeek?: () => void;
  onGroupDockPeek?: (gid: string) => void;
  onGroupDockUnpeek?: (gid: string) => void;
};

export default function BuddyInstance({ state, anchor, canRemove, onChange, onSpawn, onRemove, onOpenChange, onDragMove, onDragEnd, magnetState, edgeMagnet, teammates, isGroupExpanded, isGroupMinimized, onGroupTap, onRestore, onGroupRestore, dockPeeked, groupDockPeeked, onDockPeek, onDockUnpeek, onGroupDockPeek, onGroupDockUnpeek }: Props) {
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
  const [notoFetched, setNotoFetched] = useState<Record<string, unknown>>({});
  const [familyMenu, setFamilyMenu] = useState<'buddy' | 'noto' | null>(null);
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

  // Color comes from the personality's colorId, not the variantId directly —
  // a custom personality has its own variantId (e.g. `custom-abc`) but reuses
  // one of the 6 built-in color variants for rendering.
  const variant = VARIANTS.find((v) => v.id === personality.colorId) ?? VARIANTS[0];
  const variantAnim = useMemo(() => buildAnimation(variant, emotion), [variant, emotion]);
  const isComposite = state.avatar?.kind === 'noto' && state.avatar.group === 'facesWithHands';
  const composition = isComposite ? state.avatar?.composition : undefined;
  const notoCp = state.avatar?.kind === 'noto' && !isComposite
    ? getNotoCodepoint(state.avatar.group, emotion) : null;
  const notoData = notoCp ? (notoFetched[notoCp] ?? getCachedLottie(notoCp)) : null;
  const animation = notoData ? (notoData as object) : variantAnim;

  // Lazy-load Noto Lottie JSON when the buddy uses an emoji avatar but neither
  // the in-memory disk cache nor the per-buddy fetched map has it yet (cold
  // reload, picker pre-warm failed, etc.).
  useEffect(() => {
    if (!notoCp || notoData) return;
    let cancelled = false;
    loadLottie(notoCp)
      .then((d) => { if (!cancelled) setNotoFetched((cur) => ({ ...cur, [notoCp]: d })); })
      .catch(() => { /* fall back to variant */ });
    return () => { cancelled = true; };
  }, [notoCp, notoData]);

  // Resample the composite on emotion change (and once on first render if a
  // facesWithHands buddy is missing its composition — covers buddies migrated
  // from the previous schema). Pre-warms each codepoint's Lottie.
  useEffect(() => {
    if (state.avatar?.kind !== 'noto' || state.avatar.group !== 'facesWithHands') return;
    const next = sampleFacesWithHands(emotion);
    onChange({ ...state, avatar: { ...state.avatar, composition: next } });
    for (const cp of [next.face, next.lh, next.lhItem, next.rh, next.rhItem]) {
      if (cp) void loadLottie(cp).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emotion, state.avatar?.kind, state.avatar?.group]);

  // Lazy-load any composite codepoints not in cache. We track them in the
  // same notoFetched map so the Lottie components below get a fresh ref.
  useEffect(() => {
    if (!composition) return;
    const cps = [composition.face, composition.lh, composition.lhItem, composition.rh, composition.rhItem]
      .filter((cp): cp is string => !!cp);
    let cancelled = false;
    for (const cp of cps) {
      if (notoFetched[cp] || getCachedLottie(cp)) continue;
      loadLottie(cp)
        .then((d) => { if (!cancelled) setNotoFetched((cur) => ({ ...cur, [cp]: d })); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [composition, notoFetched]);

  const dragRef = useRef<{ startScreenX: number; startScreenY: number; baseX: number; baseY: number; moved: boolean } | null>(null);
  const draggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const justDraggedRef = useRef(false);
  const toastIdRef = useRef(100);
  const msgIdRef = useRef(state.messages.reduce((m, x) => Math.max(m, x.id), 0) + 1);
  const emotionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // Capacitor drag plumbing: keep callbacks and the drag base in refs so the
  // event-listener effect doesn't re-subscribe on every parent re-render
  // (which would happen on each onChange fired mid-drag, resetting the base
  // to 0 and snapping the avatar to its anchor).
  const dragBaseRef = useRef<{ x: number; y: number } | null>(null);
  const callbacksRef = useRef({ onChange, onDragMove, onDragEnd, onGroupTap, onRestore, onGroupRestore });
  useEffect(() => { callbacksRef.current = { onChange, onDragMove, onDragEnd, onGroupTap, onRestore, onGroupRestore }; });
  const groupMinimizedRef = useRef(!!isGroupMinimized);
  useEffect(() => { groupMinimizedRef.current = !!isGroupMinimized; }, [isGroupMinimized]);
  const groupExpandedRef = useRef(!!isGroupExpanded);
  useEffect(() => { groupExpandedRef.current = !!isGroupExpanded; }, [isGroupExpanded]);
  useEffect(() => { onOpenChange?.(state.id, open); }, [open, state.id, onOpenChange]);

  // On Android the main WebView window is FLAG_NOT_TOUCHABLE by default so it
  // doesn't block touches to background apps. While the chat panel is open we
  // flip it to interactive (and disable the native tap-zone window so it
  // doesn't shadow popup hits over the avatar's visual area). On close we
  // restore the passthrough state.
  useEffect(() => {
    if (adapter.id !== 'capacitor-android') return;
    adapter.setOverlayExpanded(open);
  }, [open, adapter]);

  // Native tap-zone window dispatches `vibemoji:avatarTap` when the user taps
  // the avatar's visual area. The avatar element itself can't receive pointer
  // events on Capacitor (its window is FLAG_NOT_TOUCHABLE), so we open the
  // panel from the window event instead.
  useEffect(() => {
    if (adapter.id !== 'capacitor-android') return;
    if (typeof window === 'undefined') return;
    // Persist drag base across re-renders. If we used a `let` here, every
    // parent re-render (which happens on each onChange we fire) would
    // resubscribe and reset the base to 0, snapping the avatar to anchor
    // plus the cumulative delta — i.e. the bottom-right corner.
    type Detail = { id?: string; dx?: number; dy?: number };
    const matches = (e: Event) => {
      const id = (e as CustomEvent<Detail>).detail?.id;
      return !id || id === state.id;
    };
    const onTap = (e: Event) => {
      if (!matches(e)) return;
      if (justDraggedRef.current) { justDraggedRef.current = false; return; }
      // Minimized: tap restores instead of opening chat.
      if (stateRef.current.minimized) {
        callbacksRef.current.onRestore?.();
        return;
      }
      // Tap on a member of a minimized group restores the whole group.
      if (groupMinimizedRef.current && stateRef.current.groupId) {
        callbacksRef.current.onGroupRestore?.(stateRef.current.groupId);
        return;
      }
      // If this buddy is part of a collapsed group, the first tap should
      // pop the group open (so the user can see and reach individual
      // members) rather than opening this buddy's chat panel. The next tap
      // — now on an already-expanded group member — falls through to the
      // popup-toggle path.
      if (stateRef.current.groupId && !groupExpandedRef.current && callbacksRef.current.onGroupTap) {
        callbacksRef.current.onGroupTap(stateRef.current.groupId);
        return;
      }
      setOpen((cur) => !cur);
    };
    const onDragStart = (e: Event) => {
      if (!matches(e)) return;
      dragBaseRef.current = { x: stateRef.current.pos.x, y: stateRef.current.pos.y };
      draggingRef.current = true;
      setIsDragging(true);
      adapter.notifyDragStart(state.id);
      callbacksRef.current.onDragMove?.(state.id, dragBaseRef.current);
    };
    const onDragMoveEvt = (e: Event) => {
      if (!matches(e) || !draggingRef.current || !dragBaseRef.current) return;
      const detail = (e as CustomEvent<Detail>).detail || {};
      const next = { x: dragBaseRef.current.x + (detail.dx ?? 0), y: dragBaseRef.current.y + (detail.dy ?? 0) };
      callbacksRef.current.onChange({ ...stateRef.current, pos: next });
      callbacksRef.current.onDragMove?.(state.id, next);
    };
    const onDragEndEvt = (e: Event) => {
      if (!matches(e) || !draggingRef.current) return;
      const base = dragBaseRef.current;
      const moved = !!base && (stateRef.current.pos.x !== base.x || stateRef.current.pos.y !== base.y);
      justDraggedRef.current = moved;
      draggingRef.current = false;
      setIsDragging(false);
      callbacksRef.current.onDragEnd?.(state.id, stateRef.current.pos, moved);
      adapter.notifyDragEnd(state.id);
      dragBaseRef.current = null;
    };
    window.addEventListener('vibemoji:avatarTap', onTap);
    window.addEventListener('vibemoji:avatarDragStart', onDragStart);
    window.addEventListener('vibemoji:avatarDragMove', onDragMoveEvt);
    window.addEventListener('vibemoji:avatarDragEnd', onDragEndEvt);
    return () => {
      window.removeEventListener('vibemoji:avatarTap', onTap);
      window.removeEventListener('vibemoji:avatarDragStart', onDragStart);
      window.removeEventListener('vibemoji:avatarDragMove', onDragMoveEvt);
      window.removeEventListener('vibemoji:avatarDragEnd', onDragEndEvt);
    };
  }, [adapter, state.id]);
  useEffect(() => {
    if (!open) return;
    messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [open, state.messages]);

  // Android system BACK while the chat popup is open: close the popup.
  // Native overlay only forwards this event while it has focus (popup open),
  // so any open buddy is the right thing to dismiss.
  useEffect(() => {
    if (!open) return;
    const onBack = () => setOpen(false);
    window.addEventListener('vibemoji:back', onBack);
    return () => window.removeEventListener('vibemoji:back', onBack);
  }, [open]);
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
      'celebrating', 'working', 'nervous', 'frustrated', 'curious', 'smug',
      'bored', 'determined', 'mischievous', 'relieved', 'shocked', 'embarrassed',
      'eureka', 'laughing', 'crying', 'dizzy', 'evil', 'peaceful',
      'hopeful', 'disappointed', 'suspicious', 'panicked', 'awestruck', 'flirty',
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
    const t = SCRIPTED_TOASTS[Math.floor(Math.random() * SCRIPTED_TOASTS.length)];
    routePing(adapter, { title: t.title, body: t.body, tone: t.tone }, () => pushToast(t));
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
    // Drag-from-peek commits the restore: clear minimized so subsequent
    // applyDelta updates can move freely, and start the drag from the
    // currently-rendered (peeked) position rather than the off-screen
    // minimized pos still held in stateRef.
    const startedFromMinimized = !!state.minimized;
    const startPos = startedFromMinimized ? renderedPos : stateRef.current.pos;
    if (startedFromMinimized) {
      onChange({ ...stateRef.current, minimized: undefined, lastFreePos: undefined, pos: startPos });
    }
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
          baseX: startPos.x, baseY: startPos.y,
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

  // Minimized buddies are rendered with their pos computed from the current
  // viewport (so rotation / IME open won't leave them off-screen). We use
  // the same math as Buddy.tsx's minimizedBuddyPos, inlined to avoid an
  // import cycle. Free buddies render with state.pos directly.
  const renderedPos = (() => {
    if (!state.minimized) return state.pos;
    const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
    const w = vv?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 0);
    const h = vv?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 0);
    const half = 56; // AVATAR_SIZE / 2 (112 / 2)
    const lf = state.lastFreePos;
    // While the user is hover-peeking the dock, render fully visible at
    // the edge (uses same negative-pad gap as clampBuddyPos).
    if (dockPeeked) {
      const PAD = -16;
      switch (state.minimized.edge) {
        case 'left':   return { x: -(w - anchor.right - 112 - PAD), y: lf?.y ?? 0 };
        case 'right':  return { x: anchor.right - PAD, y: lf?.y ?? 0 };
        case 'top':    return { x: lf?.x ?? 0, y: -(h - anchor.bottom - 112 - PAD) };
        case 'bottom': return { x: lf?.x ?? 0, y: anchor.bottom - PAD };
      }
    }
    switch (state.minimized.edge) {
      case 'left':   return { x: anchor.right + 112 - w - half, y: lf?.y ?? 0 };
      case 'right':  return { x: anchor.right + half,            y: lf?.y ?? 0 };
      case 'top':    return { x: lf?.x ?? 0, y: anchor.bottom + 112 - h - half };
      case 'bottom': return { x: lf?.x ?? 0, y: anchor.bottom + half };
    }
  })();

  return (
    <div
      data-buddy-member
      data-group={state.groupId || undefined}
      data-buddy-minimized={state.minimized?.edge || undefined}
      className="fixed z-50"
      style={{
        right: anchor.right,
        bottom: anchor.bottom,
        transform: `translate(${renderedPos.x}px, ${renderedPos.y}px)`,
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
                  {adapter.id === 'capacitor-android' && (
                    <button
                      onClick={() => adapter.stopOverlay()}
                      title="Close the floating overlay"
                      className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-200 dark:bg-rose-500/20 dark:text-rose-300"
                    >
                      close overlay
                    </button>
                  )}
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
                    onClick={() => { onSpawn(); setOpen(false); }}
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
              <div className="mt-3">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">avatar</span>
                  <div className="flex gap-1">
                    <FamilyPill
                      label="Buddy"
                      active={!state.avatar}
                      open={familyMenu === 'buddy'}
                      onClick={() => setFamilyMenu((m) => (m === 'buddy' ? null : 'buddy'))}
                    />
                    <FamilyPill
                      label="Noto"
                      active={state.avatar?.kind === 'noto'}
                      open={familyMenu === 'noto'}
                      onClick={() => setFamilyMenu((m) => (m === 'noto' ? null : 'noto'))}
                    />
                  </div>
                </div>
                {familyMenu === 'buddy' && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-2xl bg-zinc-50 px-2.5 py-2 dark:bg-zinc-800/60">
                    {VARIANTS.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => {
                          update({ variantId: v.id, avatar: undefined });
                          setFamilyMenu(null);
                        }}
                        title={v.name}
                        aria-label={`Use ${v.name} buddy avatar`}
                        className={`h-6 w-6 rounded-full ring-2 ring-offset-1 transition-transform hover:scale-110 dark:ring-offset-zinc-800 ${
                          v.id === state.variantId && !state.avatar ? 'ring-zinc-900 dark:ring-white' : 'ring-transparent'
                        }`}
                        style={{ background: cssColor(v.body) }}
                      />
                    ))}
                  </div>
                )}
                {familyMenu === 'noto' && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-2xl bg-zinc-50 px-2.5 py-2 dark:bg-zinc-800/60">
                    {(Object.keys(NOTO_GROUPS) as NotoGroup[]).map((g) => {
                      const cfg = NOTO_GROUPS[g];
                      const selected = state.avatar?.kind === 'noto' && state.avatar.group === g;
                      return (
                        <button
                          key={g}
                          onClick={() => {
                            void loadLottie(cfg.default).catch(() => {});
                            if (g === 'facesWithHands') {
                              const composition = sampleFacesWithHands(emotion);
                              update({ avatar: { kind: 'noto', group: g, composition } });
                            } else {
                              update({ avatar: { kind: 'noto', group: g } });
                            }
                            setFamilyMenu(null);
                          }}
                          title={cfg.label}
                          aria-label={`Use ${cfg.label} emoji family`}
                          className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium transition-colors ${
                            selected
                              ? 'bg-violet-600 text-white'
                              : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-800'
                          }`}
                        >
                          <span className="text-base leading-none" aria-hidden>{cpToGlyph(cfg.preview)}</span>
                          <span>{cfg.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
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
          {edgeMagnet && !magnetState && (
            // Edge-snap magnetic-zone cue: a soft sky-blue glow + pulsing
            // ring tells the user "release here to dock". Distinct color
            // from merge-magnet (violet/emerald) so the two cues don't
            // confuse each other.
            <>
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-full ring-4 ring-sky-400/80 shadow-[0_0_30px_8px_rgba(56,189,248,0.55)]"
                style={{ animation: 'buddy-magnet-pulse 900ms ease-in-out infinite' }}
              />
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-sky-300/70"
                style={{ animation: 'buddy-magnet-ping 900ms ease-out infinite' }}
              />
            </>
          )}
          <button
            data-buddy-interactive
            data-buddy-avatar
            data-buddy-id={state.id}
            onPointerDown={state.minimized && !dockPeeked ? undefined : onPointerDown}
            onClick={() => {
              if (justDraggedRef.current) {
                justDraggedRef.current = false;
                return;
              }
              // Minimized: tap restores instead of opening chat (mobile primary path).
              if (state.minimized) {
                onRestore?.();
                return;
              }
              if (isGroupMinimized && state.groupId) {
                onGroupRestore?.(state.groupId);
                return;
              }
              if (open) {
                setOpen(false);
              } else {
                setOpen(true);
                feel('love', 1400);
              }
            }}
            onPointerEnter={() => {
              feel('happy', 1200);
              // Desktop / web: hover on the visible half peeks the buddy
              // (or its group) out of the dock without committing the
              // restore. A drag commits; cursor leaving re-docks. Mobile
              // doesn't fire pointerenter from a touch tap, so this is
              // effectively desktop/web-only behavior.
              if (!isMobile) {
                if (state.minimized) onDockPeek?.();
                else if (isGroupMinimized && state.groupId) onGroupDockPeek?.(state.groupId);
              }
            }}
            className={`pointer-events-auto relative h-28 w-28 cursor-grab touch-none rounded-full transition-transform hover:scale-105 active:cursor-grabbing active:scale-95 ${
              magnetState === 'target' ? 'scale-110' : magnetState === 'attractor' ? 'scale-105' : ''
            }`}
            aria-label={`open ${personality.name}`}
          >
            <div className="h-full w-full" style={{ animation: 'buddy-bob 3s ease-in-out infinite' }}>
              {isComposite && composition ? (
                <CompositeAvatar composition={composition} fetched={notoFetched} />
              ) : (
                <Lottie animationData={animation} loop autoplay />
              )}
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

function FamilyPill({ label, active, open, onClick }: { label: string; active: boolean; open: boolean; onClick: () => void }) {
  const base = 'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors';
  const cls = active
    ? 'bg-violet-600 text-white'
    : open
      ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50'
      : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700';
  return (
    <button onClick={onClick} aria-pressed={active} className={`${base} ${cls}`}>
      {label}
    </button>
  );
}

// Renders the [lhItem][lh][face][rh][rhItem] composite. Each side cluster
// (item+hand) sits in its own flex group with a tight inner gap so the gap
// between hand and item is smaller than the gap between hand and face. Slot
// sizes are proportional to the avatar box; missing slots are skipped.
function CompositeAvatar({
  composition,
  fetched,
}: {
  composition: FacesWithHandsComposition;
  fetched: Record<string, unknown>;
}) {
  const dataFor = (cp: string | undefined) =>
    cp ? ((fetched[cp] ?? getCachedLottie(cp)) as object | null) : null;
  const faceData = dataFor(composition.face);
  const lhData = dataFor(composition.lh);
  const lhItemData = dataFor(composition.lhItem);
  const rhData = dataFor(composition.rh);
  const rhItemData = dataFor(composition.rhItem);
  // Sizes as flex-basis percent of the inner row width. Values were tuned so
  // the cluster fits in the 7rem (h-28 w-28) buddy button without overflow.
  const faceSize = '52%';
  const handSize = '22%';
  const itemSize = '18%';
  const Slot = ({ data, basis }: { data: object | null; basis: string }) =>
    data ? (
      <div style={{ flexBasis: basis, height: basis }} className="aspect-square shrink-0">
        <Lottie animationData={data} loop autoplay />
      </div>
    ) : null;
  return (
    <div className="flex h-full w-full items-center justify-center" style={{ gap: '6%' }}>
      {(composition.lhItem || composition.lh) && (
        <div className="flex items-center" style={{ gap: '2%' }}>
          <Slot data={lhItemData} basis={itemSize} />
          <Slot data={lhData} basis={handSize} />
        </div>
      )}
      <Slot data={faceData} basis={faceSize} />
      {(composition.rh || composition.rhItem) && (
        <div className="flex items-center" style={{ gap: '2%' }}>
          <Slot data={rhData} basis={handSize} />
          <Slot data={rhItemData} basis={itemSize} />
        </div>
      )}
    </div>
  );
}

function cpToGlyph(cp: string): string {
  try {
    return cp.split('_').map((p) => String.fromCodePoint(parseInt(p, 16))).join('');
  } catch { return ''; }
}
