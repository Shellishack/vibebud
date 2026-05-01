'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePlatform, useLayout } from '@/lib/hooks/use-platform';
import { useCodeAgents } from '@/lib/hooks/use-code-agents';
import { useBuddyLlmSettings } from '@/lib/hooks/use-buddy-llm-settings';
import { VARIANTS, type Emotion } from '../avatars';
import { PERSONALITY_BY_VARIANT, type Personality } from '../personalities';
import {
  buildSystemPrompt, streamChat, trimHistory, getApiKey,
  type ChatTurn, type Teammate,
} from '../llm';
import {
  XP_REWARDS,
  advanceDailyTask,
  applyBuddyXp,
  applyBondUpdate,
  applyMilestoneUnlocks,
  getActiveTeamBonus,
  getBuddyBond,
  loadGamificationStore,
  levelProgress,
  normalizeGamification,
  parseBondJson,
  recordFavoriteTeam,
  subscribeGamification,
  unlockedMilestonesFor,
  xpForLevel,
} from '../gamification';
import { routePing } from '../notify';
import { useAvatarRuntime } from './adapters';
import type { AvatarCategory } from './types';
import BuddyChatInput from '../popup/BuddyChatInput';
import BuddyChatMessages from '../popup/BuddyChatMessages';
import BuddyContextMenu from '../popup/BuddyContextMenu';
import BuddyDetailsPanel from '../popup/BuddyDetailsPanel';
import ToastStack from '../popup/ToastStack';
import type { ShimejiAction } from '../../../lib/avatar/types';
import type { AvatarInstanceProps, AvatarInstanceState, ChatMsg, Toast } from './avatar-instance.types';

const SCRIPTED_TOASTS: Omit<Toast, 'id'>[] = [
  { title: 'Agent dispatched', body: 'Started work on issue #42 — "Add dark mode toggle"', tone: 'info' },
  { title: 'PR ready for review', body: '#118 — refactor: extract toast queue', tone: 'action' },
  { title: 'Tests green', body: '142 / 142 passing on agent-branch/issue-42', tone: 'success' },
  { title: 'Needs your input', body: 'Agent is unsure: should empty state link to /docs or /onboarding?', tone: 'action' },
];

const DESKTOP_PANEL_W = 384;
const DESKTOP_PANEL_H = 560;
const DESKTOP_PANEL_GAP = 8;
const VIEWPORT_PAD = 12;

export default function AvatarInstance({ state, anchor, canRemove, onChange, onSpawn, onRemove, onOpenChange, onDragMove, onDragEnd, magnetState, edgeMagnet, teammates, groupMemberIds, isGroupExpanded, isGroupMinimized, onGroupTap, onRestore, onGroupRestore, dockPeeked, groupDockPeeked, onDockPeek, onDockUnpeek, onGroupDockPeek, onGroupDockUnpeek, bumpTick, groupBumpTick, rotation, rotationActive, grabPivot, onDragStart, onOpenAppSettings, shimejiAction, shimejiDirection, showLlmOnboarding, onDismissLlmOnboarding, onWonderPauseChange }: AvatarInstanceProps) {
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
  const [chatDetailsOpen, setChatDetailsOpen] = useState(false);
  const [familyMenu, setFamilyMenu] = useState<AvatarCategory | null>(null);
  const llmSettings = useBuddyLlmSettings({
    showLlmOnboarding,
    onDismissLlmOnboarding,
    onShowOnboarding: () => {
      setOpen(true);
      setChatDetailsOpen(true);
    },
  });
  const [gamificationTick, setGamificationTick] = useState(0);
  // Right-click context menu (desktop / web). Coords are viewport-relative;
  // the menu is portal'd to document.body so positioning isn't affected by the
  // buddy's transform'd containing block.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToLatestRef = useRef(true);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const teammatesRef = useRef<Teammate[]>(teammates ?? []);
  useEffect(() => { teammatesRef.current = teammates ?? []; }, [teammates]);

  // Color comes from the personality's colorId, not the variantId directly —
  // a custom personality has its own variantId (e.g. `custom-abc`) but reuses
  // one of the 6 built-in color variants for rendering.
  const variant = VARIANTS.find((v) => v.id === personality.colorId) ?? VARIANTS[0];
  const progress = levelProgress(state);
  const bond = useMemo(() => getBuddyBond(state.id), [state.id, gamificationTick]);
  const unlockedMilestones = useMemo(() => unlockedMilestonesFor(state.id), [state.id, gamificationTick]);
  const dailyTasks = useMemo(() => loadGamificationStore().dailyTasks, [gamificationTick]);
  const activeTeamBonus = useMemo(() => getActiveTeamBonus(groupMemberIds), [groupMemberIds]);

  const dragRef = useRef<{ startScreenX: number; startScreenY: number; baseX: number; baseY: number; moved: boolean } | null>(null);
  const draggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const hoverPauseRef = useRef(false);
  const pressPauseRef = useRef(false);
  const publishWonderPause = (hover: boolean, press: boolean) => {
    onWonderPauseChange?.(state.id, hover || press);
  };
  useEffect(() => {
    return () => onWonderPauseChange?.(state.id, false);
  }, [onWonderPauseChange, state.id]);
  const activeShimejiAction: ShimejiAction = isDragging
    ? 'drag'
    : shimejiAction ?? (open ? 'sit' : 'idle');
  const { runtime: avatarRuntime } = useAvatarRuntime({
    state,
    personality,
    emotion,
    action: activeShimejiAction,
    direction: shimejiDirection,
    onChange,
  });
  const avatarIsMoving = avatarRuntime.isMoving;
  const [desktopPanelPos, setDesktopPanelPos] = useState<{ left: number; top: number } | null>(null);
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

  // Native tap-zone window dispatches `vibebud:avatarTap` when the user taps
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
    window.addEventListener('vibebud:avatarTap', onTap);
    window.addEventListener('vibebud:avatarDragStart', onDragStart);
    window.addEventListener('vibebud:avatarDragMove', onDragMoveEvt);
    window.addEventListener('vibebud:avatarDragEnd', onDragEndEvt);
    return () => {
      window.removeEventListener('vibebud:avatarTap', onTap);
      window.removeEventListener('vibebud:avatarDragStart', onDragStart);
      window.removeEventListener('vibebud:avatarDragMove', onDragMoveEvt);
      window.removeEventListener('vibebud:avatarDragEnd', onDragEndEvt);
    };
  }, [adapter, state.id]);
  useEffect(() => {
    if (!open) return;
    if (!shouldStickToLatestRef.current) return;
    messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [open, state.messages]);
  useEffect(() => subscribeGamification(() => setGamificationTick((n) => n + 1)), []);

  // Android system BACK while the chat popup is open: close the popup.
  // Native overlay only forwards this event while it has focus (popup open),
  // so any open buddy is the right thing to dismiss.
  useEffect(() => {
    if (!open) return;
    const onBack = () => setOpen(false);
    window.addEventListener('vibebud:back', onBack);
    return () => window.removeEventListener('vibebud:back', onBack);
  }, [open]);
  const update = (patch: Partial<AvatarInstanceState>) => onChange({ ...stateRef.current, ...patch });
  const withXp = (
    base: AvatarInstanceState,
    amount: number,
    stat?: 'chats' | 'tasksCompleted' | 'pings',
  ) => applyBuddyXp(normalizeGamification(base), amount, stat);

  const showProgressRewards = (buddy: AvatarInstanceState, leveledUp: boolean) => {
    if (leveledUp) {
      feel('celebrating', 2200);
      pushToast({
        title: `${personality.name} reached level ${buddy.level ?? 1}`,
        body: `${buddy.xp ?? 0} / ${xpForLevel(buddy.level ?? 1)} XP toward the next level`,
        tone: 'success',
      });
    }
    for (const milestone of applyMilestoneUnlocks(buddy)) {
      pushToast({
        title: `${personality.name} unlocked ${milestone.title}`,
        body: milestone.aura ? `${milestone.aura} aura is now available.` : `Level ${milestone.level} milestone reached.`,
        tone: 'success',
      });
    }
  };

  const awardXp = (amount: number, stat?: 'chats' | 'tasksCompleted' | 'pings') => {
    const awarded = withXp(stateRef.current, amount, stat);
    onChange(awarded.buddy);
    showProgressRewards(awarded.buddy, awarded.leveledUp);
  };

  const dailyRewardFor = (event: 'chat' | 'task-complete' | 'team-use', buddyIds: string[]) => {
    const completed = advanceDailyTask(event, buddyIds).completed;
    for (const task of completed) {
      pushToast({ title: 'Daily task complete', body: `${task.title} +${task.rewardXp} XP`, tone: 'success' });
      for (const id of buddyIds) applyBondUpdate(id, task.rewardBond);
    }
    return completed.reduce((sum, task) => sum + task.rewardXp, 0);
  };

  const updateBondFromChat = async (userText: string, assistantText: string) => {
    if (!getApiKey()) {
      applyBondUpdate(state.id, 4, { summary: 'Had a chat with the user.' });
      return;
    }
    try {
      const chunks: string[] = [];
      for await (const chunk of streamChat({
        system: 'Return only compact JSON with keys mood, bondDelta, memory, summary. bondDelta must be 0-12. No markdown.',
        messages: [{
          role: 'user',
          content: `Buddy: ${personality.name}\nRole: ${personality.role}\nUser said: ${userText}\nBuddy replied: ${assistantText}\nSummarize the relationship update.`,
        }],
      })) chunks.push(chunk);
      applyBondUpdate(state.id, 4, parseBondJson(chunks.join('')));
    } catch {
      applyBondUpdate(state.id, 4, { summary: 'Had a chat with the user.' });
    }
  };

  const feel = (next: Emotion, ms = 1600) => {
    if (emotionTimerRef.current) clearTimeout(emotionTimerRef.current);
    setEmotion(next);
    emotionTimerRef.current = setTimeout(() => setEmotion('idle'), ms);
  };

  // Physics collision response: brief CSS-driven shake + 'bumped' emotion.
  const [shaking, setShaking] = useState(false);
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!bumpTick && !groupBumpTick) return;
    if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    setShaking(true);
    feel('bumped', 700);
    shakeTimerRef.current = setTimeout(() => setShaking(false), 420);
    return () => { if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bumpTick, groupBumpTick]);

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

  const codeAgents = useCodeAgents({
    adapter,
    buddyId: state.id,
    getMessages: () => stateRef.current.messages,
    updateMessages: (messages) => update({ messages }),
    nextBuddyMessageId: () => msgIdRef.current++,
    onTaskComplete: () => {
      const teamIds = groupMemberIds?.length ? groupMemberIds : [state.id];
      const teamBonus = getActiveTeamBonus(groupMemberIds);
      const teamXp = Math.round(XP_REWARDS.taskComplete * (teamBonus?.multiplier ?? 1));
      const dailyXp = dailyRewardFor('task-complete', [state.id])
        + (teamBonus ? dailyRewardFor('team-use', teamIds) : 0);
      if (teamBonus) recordFavoriteTeam(teamIds);
      awardXp(teamXp + dailyXp, 'tasksCompleted');
    },
    onUnavailable: (title, body) => pushToast({ title, body, tone: 'action' }),
    onHappy: () => feel('happy', 1500),
  });

  const triggerScriptedToast = () => {
    const t = SCRIPTED_TOASTS[Math.floor(Math.random() * SCRIPTED_TOASTS.length)];
    routePing(adapter, { title: t.title, body: t.body, tone: t.tone }, () => pushToast(t));
    awardXp(XP_REWARDS.ping, 'pings');
  };

  const writeMessages = (
    msgs: ChatMsg[],
    xp?: { amount: number; stat?: 'chats' | 'tasksCompleted' | 'pings' },
  ) => {
    const base = { ...stateRef.current, messages: msgs };
    if (!xp) {
      onChange(base);
      return;
    }
    const awarded = withXp(base, xp.amount, xp.stat);
    onChange(awarded.buddy);
    showProgressRewards(awarded.buddy, awarded.leveledUp);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy || codeAgents.busy) return;
    shouldStickToLatestRef.current = true;

    // Code-agent branch: pipe the user turn into the local/paired CLI
    // process via the platform bridge. The event subscription above
    // handles streaming the assistant reply back into the chat bubble.
    if (codeAgents.active && codeAgents.activeBridge) {
      const userMsg: ChatMsg = { id: msgIdRef.current++, from: 'you', text };
      const replyId = msgIdRef.current++;
      const baseMessages = [...stateRef.current.messages, userMsg];
      const dailyXp = dailyRewardFor('chat', [state.id]);
      writeMessages([...baseMessages, { id: replyId, from: 'buddy', text: '' }], { amount: XP_REWARDS.chat + dailyXp, stat: 'chats' });
      setInput('');
      codeAgents.beginReply(replyId);
      feel('thinking', 1400);
      const r = await codeAgents.activeBridge.send(state.id, text);
      if (!r.ok) {
        const errText = r.error || 'send failed';
        const cur = stateRef.current.messages;
        const idx = cur.findIndex((m) => m.id === replyId);
        if (idx >= 0) {
          const next = cur.slice();
          next[idx] = { ...next[idx], text: `(error: ${errText})` };
          update({ messages: next });
        }
        codeAgents.clearReply();
      }
      return;
    }

    if (!getApiKey()) {
      llmSettings.openSettings();
      return;
    }
    const userMsg: ChatMsg = { id: msgIdRef.current++, from: 'you', text };
    const replyId = msgIdRef.current++;
    const baseMessages = [...stateRef.current.messages, userMsg];
    const dailyXp = dailyRewardFor('chat', [state.id]);
    writeMessages([...baseMessages, { id: replyId, from: 'buddy', text: '' }], { amount: XP_REWARDS.chat + dailyXp, stat: 'chats' });
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
      writeMessages([...baseMessages, { id: replyId, from: 'buddy', text: acc }], { amount: XP_REWARDS.llmComplete });
      void updateBondFromChat(text, acc);
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
    pressPauseRef.current = true;
    publishWonderPause(hoverPauseRef.current, true);
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
      ((window as any).__vibebudDragging as Set<string> | undefined)?.delete(state.id);
    }
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* noop */ }
    // Capture grab offset (cursor relative to the avatar's center, in CSS
    // px) so the parent can derive torque from this drag.
    try {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      onDragStart?.(state.id, {
        x: e.clientX - (r.left + r.width / 2),
        y: e.clientY - (r.top + r.height / 2),
      });
    } catch { /* noop */ }
    draggingRef.current = true;
    setIsDragging(true);
    adapter.notifyDragStart(state.id);
    const dragSet: Set<string> = ((window as any).__vibebudDragging ||= new Set<string>());
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
      pressPauseRef.current = false;
      publishWonderPause(hoverPauseRef.current, false);
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

  useEffect(() => {
    if (!open || isMobile) return;
    const positionPanel = () => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vv = window.visualViewport;
      const vw = vv?.width ?? window.innerWidth;
      const vh = vv?.height ?? window.innerHeight;
      const offsetLeft = vv?.offsetLeft ?? 0;
      const offsetTop = vv?.offsetTop ?? 0;
      const minLeft = offsetLeft + VIEWPORT_PAD;
      const maxLeft = offsetLeft + vw - DESKTOP_PANEL_W - VIEWPORT_PAD;
      const minTop = offsetTop + VIEWPORT_PAD;
      const maxTop = offsetTop + vh - DESKTOP_PANEL_H - VIEWPORT_PAD;
      const preferredLeft = rect.right - DESKTOP_PANEL_W;
      const aboveTop = rect.top - DESKTOP_PANEL_H - DESKTOP_PANEL_GAP;
      const belowTop = rect.bottom + DESKTOP_PANEL_GAP;
      const preferredTop = aboveTop >= minTop || belowTop > maxTop ? aboveTop : belowTop;
      setDesktopPanelPos({
        left: Math.min(Math.max(preferredLeft, minLeft), Math.max(minLeft, maxLeft)),
        top: Math.min(Math.max(preferredTop, minTop), Math.max(minTop, maxTop)),
      });
    };
    positionPanel();
    window.addEventListener('resize', positionPanel);
    window.visualViewport?.addEventListener('resize', positionPanel);
    window.visualViewport?.addEventListener('scroll', positionPanel);
    return () => {
      window.removeEventListener('resize', positionPanel);
      window.visualViewport?.removeEventListener('resize', positionPanel);
      window.visualViewport?.removeEventListener('scroll', positionPanel);
    };
  }, [open, isMobile, renderedPos.x, renderedPos.y]);

  return (
    <div
      ref={rootRef}
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
      <BuddyContextMenu
        position={contextMenu}
        open={open}
        canRemove={canRemove}
        adapter={adapter}
        onClose={() => setContextMenu(null)}
        onToggleChat={() => setOpen(!open)}
        onOpenDetails={() => { setOpen(true); setChatDetailsOpen(true); }}
        onOpenAppSettings={onOpenAppSettings}
        onSpawn={onSpawn}
        onRemove={onRemove}
      />
      <ToastStack toasts={toasts} isMobile={isMobile} />

      <div className="flex items-end gap-3">
        {open && (() => {
          const panel = (
          <div
            data-buddy-interactive
            className={isMobile
              ? "pointer-events-auto fixed left-3 right-3 bottom-3 z-[60] flex flex-col rounded-3xl border border-zinc-200 bg-white/95 shadow-2xl backdrop-blur-md dark:border-zinc-700 dark:bg-zinc-900/95"
              : "pointer-events-auto fixed z-[60] flex w-96 flex-col rounded-3xl border border-zinc-200 bg-white/95 shadow-2xl backdrop-blur-md dark:border-zinc-700 dark:bg-zinc-900/95"
            }
            style={isMobile
              ? { height: 'min(92dvh, 720px)', animation: 'buddy-bubble-in 220ms ease-out' }
              : {
                left: desktopPanelPos?.left ?? -9999,
                top: desktopPanelPos?.top ?? -9999,
                height: DESKTOP_PANEL_H,
                animation: 'buddy-bubble-in 220ms ease-out',
              }
            }
          >
            <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{personality.name} · {variant.name}</p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">Lv {progress.level} · {personality.role}</p>
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
                    className="hidden rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-200 dark:bg-violet-500/20 dark:text-violet-300 sm:block"
                  >
                    ping
                  </button>
                  <button
                    onClick={() => setChatDetailsOpen((v) => {
                      if (v) llmSettings.cancel();
                      return !v;
                    })}
                    title={chatDetailsOpen ? 'Hide buddy details' : 'Show buddy details'}
                    aria-label={chatDetailsOpen ? 'Hide buddy details' : 'Show buddy details'}
                    className={`grid h-7 w-7 place-items-center rounded-full transition-colors ${
                      chatDetailsOpen
                        ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300'
                        : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
                    }`}
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M12 5v2M12 17v2M5 12h2M17 12h2M7.8 7.8l1.4 1.4M14.8 14.8l1.4 1.4M16.2 7.8l-1.4 1.4M9.2 14.8l-1.4 1.4" />
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
              {chatDetailsOpen && (
                <BuddyDetailsPanel
                  state={state}
                  emotion={emotion}
                  familyMenu={familyMenu}
                  settingsOpen={llmSettings.open}
                  progress={progress}
                  bond={bond}
                  unlockedMilestones={unlockedMilestones}
                  dailyTasks={dailyTasks}
                  activeTeamBonus={activeTeamBonus}
                  providerDraft={llmSettings.providerDraft}
                  keyDraft={llmSettings.keyDraft}
                  modelDraft={llmSettings.modelDraft}
                  modelList={llmSettings.modelList}
                  loadingModels={llmSettings.loadingModels}
                  codeAgentOptions={codeAgents.options}
                  codeAgentActive={codeAgents.active}
                  activeCodeAgent={codeAgents.activeAgent}
                  showLlmOnboarding={showLlmOnboarding}
                  onFamilyMenuChange={setFamilyMenu}
                  onUpdate={update}
                  onToggleSettings={llmSettings.toggle}
                  onDismissLlmOnboarding={onDismissLlmOnboarding}
                  onSwitchProvider={llmSettings.switchProvider}
                  onKeyDraftChange={llmSettings.setKeyDraft}
                  onModelDraftChange={llmSettings.setModelDraft}
                  onLoadModels={llmSettings.loadModelsFor}
                  onToggleCodeAgent={(agentId) => void codeAgents.toggle(agentId)}
                  onCancelSettings={llmSettings.cancel}
                  onSaveSettings={llmSettings.save}
                />
              )}
            </div>
            <BuddyChatMessages
              messages={state.messages}
              greeting={personality.greeting}
              busy={busy}
              messagesRef={messagesRef}
              endRef={messagesEndRef}
              onStickinessChange={(stuck) => { shouldStickToLatestRef.current = stuck; }}
            />
            <BuddyChatInput
              value={input}
              onChange={setInput}
              disabled={busy || codeAgents.busy}
              placeholder={busy || codeAgents.busy ? `${personality.name} is typing...` : `talk to ${personality.name}...`}
              onSend={() => void send()}
              onStop={() => {
                abortRef.current?.abort();
                void codeAgents.stopActive();
              }}
            />
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
          return typeof document !== 'undefined' ? createPortal(panel, document.body) : null;
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
          {/* Rotation wrapper for the avatar visual cluster (button face +
              composite hands). transform-origin is the grab pin so rotation
              pivots around the cursor — the user's grip stays anchored
              instead of swinging out from the avatar's geometric center. */}
          <div
            style={{
              transform: !avatarIsMoving && rotation ? `rotate(${rotation}deg)` : undefined,
              transformOrigin: grabPivot
                ? `calc(50% + ${grabPivot.x}px) calc(50% + ${grabPivot.y}px)`
                : '50% 50%',
              willChange: !avatarIsMoving && rotation ? 'transform' : undefined,
              transition: rotationActive || avatarIsMoving ? 'none' : 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
          <button
            data-buddy-interactive
            data-buddy-avatar
            data-buddy-id={state.id}
            onPointerDown={state.minimized && !dockPeeked ? undefined : onPointerDown}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY });
            }}
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
              hoverPauseRef.current = true;
              publishWonderPause(true, pressPauseRef.current);
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
            onPointerLeave={() => {
              hoverPauseRef.current = false;
              publishWonderPause(false, pressPauseRef.current);
              if (!isMobile) {
                if (state.minimized) onDockUnpeek?.();
                else if (isGroupMinimized && state.groupId) onGroupDockUnpeek?.(state.groupId);
              }
            }}
            className={`pointer-events-auto relative h-28 w-28 cursor-grab touch-none rounded-full transition-transform hover:scale-105 active:cursor-grabbing active:scale-95 ${
              magnetState === 'target' ? 'scale-110' : magnetState === 'attractor' ? 'scale-105' : ''
            }`}
            aria-label={`open ${personality.name}`}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute right-0 top-1 z-10 rounded-full bg-zinc-950/85 px-2 py-0.5 text-[10px] font-bold leading-4 text-white shadow-lg ring-1 ring-white/70 dark:bg-white/90 dark:text-zinc-950 dark:ring-zinc-900/30"
            >
              Lv {progress.level}
            </span>
            <div className="h-full w-full" style={{ animation: shaking ? 'buddy-shake 420ms ease-out' : avatarIsMoving ? undefined : 'buddy-bob 3s ease-in-out infinite' }}>
              {avatarRuntime.visual}
            </div>
          </button>
          {avatarRuntime.accessories}
          </div>
        </div>
      </div>
    </div>
  );
}

