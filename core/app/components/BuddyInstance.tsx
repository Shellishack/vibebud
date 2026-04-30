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
  type BuddyStats,
} from './gamification';
import { routePing } from './notify';
import { getCachedLottie, loadLottie } from '../../lib/notoEmoji';
import ShimejiAvatarView from './ShimejiAvatar';
import Model3DAvatarView, { MODEL_3D_AVATARS } from './Model3DAvatar';
import {
  fetchShimejiCatalog,
  getShimejiCharacter,
  importShimejiZip,
  installCatalogPack,
  listShimejiPacks,
  removeShimejiPack,
  resolveShimejiAsset,
  subscribeShimejiPacks,
} from '../../lib/avatar/shimeji';
import type { InstalledShimejiPack, Model3DAvatar, ShimejiAction, ShimejiAvatar, ShimejiPackManifest } from '../../lib/avatar/types';

const Lottie = dynamic(() => import('lottie-react'), { ssr: false });

export type Toast = { id: number; title: string; body: string; tone: 'info' | 'action' | 'success' };
export type ChatMsg = { id: number; from: 'buddy' | 'you'; text: string };
type CodeAgent = 'claude' | 'codex';

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
  avatar?: { kind: 'noto'; group: NotoGroup; composition?: FacesWithHandsComposition } | ShimejiAvatar | Model3DAvatar;
  xp?: number;
  level?: number;
  stats?: BuddyStats;
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
  groupMemberIds?: string[];
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
  // Bouncy-drag physics: increments per collision so we can react with a
  // brief shake + 'bumped' emotion. groupBumpTick fires when the buddy's
  // containing group gets bumped.
  bumpTick?: number;
  groupBumpTick?: number;
  // Current avatar rotation in degrees (driven by the parent's flight
  // integrator + drag-time torque accumulation).
  rotation?: number;
  // True while the parent's physics is actively driving this body's
  // rotation (drag pendulum or flight). When false, the rotation wrapper
  // animates the transform with a CSS transition so settling back to 0
  // glides smoothly.
  rotationActive?: boolean;
  // Cursor offset (CSS px) captured at drag start. Used as the rotation
  // wrapper's transform-origin so rotation pivots around the grab pin —
  // the spot the user grabbed stays under the cursor instead of swinging
  // out from the avatar's geometric center.
  grabPivot?: { x: number; y: number };
  // Fired on pointer-down with the cursor's offset (in CSS px) from the
  // avatar's center, so the parent can derive torque from a flick.
  onDragStart?: (id: string, grabOffset: { x: number; y: number }) => void;
  // Open the app-wide settings modal (notifications, physics mode, pairing).
  // Used by the right-click menu on Electron, where there's no gear icon.
  onOpenAppSettings?: () => void;
  shimejiAction?: ShimejiAction;
  shimejiDirection?: -1 | 1;
  showLlmOnboarding?: boolean;
  onDismissLlmOnboarding?: () => void;
  onWonderPauseChange?: (id: string, paused: boolean) => void;
};

export default function BuddyInstance({ state, anchor, canRemove, onChange, onSpawn, onRemove, onOpenChange, onDragMove, onDragEnd, magnetState, edgeMagnet, teammates, groupMemberIds, isGroupExpanded, isGroupMinimized, onGroupTap, onRestore, onGroupRestore, dockPeeked, groupDockPeeked, onDockPeek, onDockUnpeek, onGroupDockPeek, onGroupDockUnpeek, bumpTick, groupBumpTick, rotation, rotationActive, grabPivot, onDragStart, onOpenAppSettings, shimejiAction, shimejiDirection, showLlmOnboarding, onDismissLlmOnboarding, onWonderPauseChange }: Props) {
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
  const [chatDetailsOpen, setChatDetailsOpen] = useState(false);
  const [notoFetched, setNotoFetched] = useState<Record<string, unknown>>({});
  const [familyMenu, setFamilyMenu] = useState<'buddy' | 'noto' | 'shimeji' | 'model3d' | null>(null);
  const [shimejiPacks, setShimejiPacks] = useState<InstalledShimejiPack[]>([]);
  const [shimejiCatalog, setShimejiCatalog] = useState<Array<{ manifest: ShimejiPackManifest; baseUrl: string }>>([]);
  const [shimejiCatalogLoading, setShimejiCatalogLoading] = useState(false);
  const [shimejiPackError, setShimejiPackError] = useState<string | null>(null);
  // Per-buddy Claude Code session: when active, chat sends route through the
  // local `claude` subprocess (spawned by Electron main) instead of the LLM
  // HTTP provider. claudeBusy mirrors `busy` for the bridge path.
  const [claudeBridgeTick, setClaudeBridgeTick] = useState(0);
  const claudeBridge = useMemo(() => adapter.claudeCode(), [adapter, claudeBridgeTick]);
  const codexBridge = useMemo(() => adapter.codexCode(), [adapter, claudeBridgeTick]);
  useEffect(() => {
    const onPaired = () => setClaudeBridgeTick((n) => n + 1);
    window.addEventListener('vibebud:paired', onPaired);
    return () => window.removeEventListener('vibebud:paired', onPaired);
  }, []);
  const [claudeActive, setClaudeActive] = useState(false);
  const [claudeBusy, setClaudeBusy] = useState(false);
  const [activeCodeAgent, setActiveCodeAgent] = useState<CodeAgent | null>(null);
  const claudeReplyIdRef = useRef<number | null>(null);
  const activeCodeBridge = useMemo(
    () => activeCodeAgent === 'codex' ? codexBridge : activeCodeAgent === 'claude' ? claudeBridge : null,
    [activeCodeAgent, codexBridge, claudeBridge],
  );
  const activeCodeLabel = activeCodeAgent === 'codex' ? 'Codex' : 'Claude Code';
  const [providerDraft, setProviderDraft] = useState<ProviderId>('openai');
  const [keyDraft, setKeyDraft] = useState('');
  const [modelDraft, setModelDraft] = useState('');
  const [modelList, setModelList] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [gamificationTick, setGamificationTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      listShimejiPacks().then((packs) => { if (!cancelled) setShimejiPacks(packs); });
    };
    refresh();
    const unsub = subscribeShimejiPacks(refresh);
    return () => { cancelled = true; unsub(); };
  }, []);
  const refreshShimejiCatalog = () => {
    setShimejiPackError(null);
    setShimejiCatalogLoading(true);
    fetchShimejiCatalog()
      .then(setShimejiCatalog)
      .catch((e) => setShimejiPackError(e instanceof Error ? e.message : String(e)))
      .finally(() => setShimejiCatalogLoading(false));
  };
  const useShimejiPack = (pack: InstalledShimejiPack) => {
    const character = getShimejiCharacter(pack, state.avatar?.kind === 'shimeji' ? state.avatar.characterId : undefined);
    update({
      avatar: {
        kind: 'shimeji',
        packId: pack.manifest.id,
        characterId: character.id,
      },
    });
    setFamilyMenu(null);
  };
  const importShimejiPack = async (file: File | null) => {
    if (!file) return;
    setShimejiPackError(null);
    try {
      const pack = await importShimejiZip(file);
      useShimejiPack(pack);
    } catch (e) {
      setShimejiPackError(e instanceof Error ? e.message : String(e));
    }
  };
  const deleteShimejiPack = async (pack: InstalledShimejiPack) => {
    setShimejiPackError(null);
    try {
      await removeShimejiPack(pack.manifest.id);
      if (state.avatar?.kind === 'shimeji' && state.avatar.packId === pack.manifest.id) {
        update({ avatar: undefined });
      }
    } catch (e) {
      setShimejiPackError(e instanceof Error ? e.message : String(e));
    }
  };
  const installAndUseShimejiPack = async (pack: { manifest: ShimejiPackManifest; baseUrl: string }) => {
    setShimejiPackError(null);
    try {
      const installed = await installCatalogPack(pack);
      useShimejiPack(installed);
    } catch (e) {
      setShimejiPackError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    if (familyMenu === 'shimeji' && shimejiCatalog.length === 0 && !shimejiCatalogLoading) refreshShimejiCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyMenu]);

  // Right-click context menu (desktop / web). Coords are viewport-relative;
  // the menu is portal'd to document.body so positioning isn't affected by the
  // buddy's transform'd containing block.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const modelsAbortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToLatestRef = useRef(true);
  const rootRef = useRef<HTMLDivElement | null>(null);
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
    onDismissLlmOnboarding?.();
  };

  useEffect(() => {
    if (!showLlmOnboarding) return;
    setOpen(true);
    setChatDetailsOpen(true);
    openSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLlmOnboarding]);

  // Color comes from the personality's colorId, not the variantId directly —
  // a custom personality has its own variantId (e.g. `custom-abc`) but reuses
  // one of the 6 built-in color variants for rendering.
  const variant = VARIANTS.find((v) => v.id === personality.colorId) ?? VARIANTS[0];
  const variantAnim = useMemo(() => buildAnimation(variant, emotion), [variant, emotion]);
  const progress = levelProgress(state);
  const bond = useMemo(() => getBuddyBond(state.id), [state.id, gamificationTick]);
  const unlockedMilestones = useMemo(() => unlockedMilestonesFor(state.id), [state.id, gamificationTick]);
  const dailyTasks = useMemo(() => loadGamificationStore().dailyTasks, [gamificationTick]);
  const activeTeamBonus = useMemo(() => getActiveTeamBonus(groupMemberIds), [groupMemberIds]);
  const isShimeji = state.avatar?.kind === 'shimeji';
  const notoAvatar = state.avatar?.kind === 'noto' ? state.avatar : null;
  const shimejiAvatar = state.avatar?.kind === 'shimeji' ? state.avatar : null;
  const model3dAvatar = state.avatar?.kind === 'model3d' ? state.avatar : null;
  const isComposite = notoAvatar?.group === 'facesWithHands';
  const composition = isComposite ? notoAvatar?.composition : undefined;
  const notoCp = notoAvatar && !isComposite
    ? getNotoCodepoint(notoAvatar.group, emotion) : null;
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
  }, [emotion, notoAvatar?.group, state.avatar?.kind]);

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
  const shimejiIsMoving = !!shimejiAvatar && ['walk', 'climb', 'fall', 'drag'].includes(activeShimejiAction);
  const model3dIsMoving = !!model3dAvatar && ['walk', 'climb', 'fall', 'drag'].includes(activeShimejiAction);
  const avatarIsMoving = shimejiIsMoving || model3dIsMoving;
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
  const update = (patch: Partial<BuddyInstanceState>) => onChange({ ...stateRef.current, ...patch });
  const withXp = (
    base: BuddyInstanceState,
    amount: number,
    stat?: 'chats' | 'tasksCompleted' | 'pings',
  ) => applyBuddyXp(normalizeGamification(base), amount, stat);

  const showProgressRewards = (buddy: BuddyInstanceState, leveledUp: boolean) => {
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

  // Subscribe to active code-agent stream events for this buddy. We extract
  // user-visible text from assistant/delta events and
  // append it to the current reply bubble; tool-use blocks are surfaced as
  // bracketed status lines so the user can see what the agent is doing.
  useEffect(() => {
    if (!activeCodeBridge || !activeCodeAgent) return;
    const off = activeCodeBridge.onEvent((bid, evt) => {
      if (bid !== state.id) return;
      const replyId = claudeReplyIdRef.current;
      const t = evt && typeof evt === 'object' ? (evt as { type?: string }).type : undefined;

      const appendToReply = (chunk: string) => {
        if (replyId == null || !chunk) return;
        const cur = stateRef.current.messages;
        const idx = cur.findIndex((m) => m.id === replyId);
        if (idx < 0) return;
        const next = cur.slice();
        next[idx] = { ...next[idx], text: next[idx].text + chunk };
        update({ messages: next });
      };
      const appendStatus = (text: string) => {
        const note: ChatMsg = { id: msgIdRef.current++, from: 'buddy', text };
        update({ messages: [...stateRef.current.messages, note] });
      };

      if (t === 'system') {
        // init/system info — kept silent; surfaced only if needed for debugging.
      } else if (t === 'assistant' || t === 'stream_event') {
        const msg = (evt as { message?: { content?: Array<{ type?: string; text?: string; name?: string }> } }).message;
        const blocks = msg?.content;
        if (Array.isArray(blocks)) {
          for (const b of blocks) {
            if (b.type === 'text' && b.text) appendToReply(b.text);
            else if (b.type === 'tool_use' && b.name) appendToReply(`\n[tool: ${b.name}]\n`);
          }
        }
        // Partial-message variant carries deltas at the top level
        const delta = (evt as { delta?: { type?: string; text?: string } }).delta;
        if (delta?.type === 'text_delta' && delta.text) appendToReply(delta.text);
      } else if (t === 'assistant_delta') {
        const delta = (evt as { delta?: { text?: string } }).delta;
        if (delta?.text) appendToReply(delta.text);
      } else if (t === 'tool_use') {
        const name = (evt as { name?: string }).name || 'tool';
        appendToReply(`\n[tool: ${name}]\n`);
      } else if (t === 'result') {
        setClaudeBusy(false);
        claudeReplyIdRef.current = null;
        const teamIds = groupMemberIds?.length ? groupMemberIds : [state.id];
        const teamBonus = getActiveTeamBonus(groupMemberIds);
        const teamXp = Math.round(XP_REWARDS.taskComplete * (teamBonus?.multiplier ?? 1));
        const dailyXp = dailyRewardFor('task-complete', [state.id])
          + (teamBonus ? dailyRewardFor('team-use', teamIds) : 0);
        if (teamBonus) recordFavoriteTeam(teamIds);
        awardXp(teamXp + dailyXp, 'tasksCompleted');
        feel('happy', 1500);
      } else if (t === 'error' || t === 'stderr' || t === 'raw') {
        const text = (evt as { text?: string }).text || `${activeCodeLabel} error`;
        // Always surface to chat — even if no reply is in flight (covers the
        // common "binary not found" / "auth missing" case where the process
        // dies before any user turn is sent).
        if (replyId != null) appendToReply(`\n(${text.trim()})`);
        else appendStatus(`(${activeCodeLabel}: ${text.trim()})`);
      } else if (t === 'closed') {
        const code = (evt as { code?: number }).code;
        const stderr = (evt as { stderr?: string }).stderr;
        const bin = (evt as { bin?: string }).bin;
        const cwd = (evt as { cwd?: string }).cwd;
        if (code !== 0) {
          const detail = stderr
            ? stderr.trim()
            : `no stderr - likely '${bin || (activeCodeAgent === 'codex' ? 'codex' : 'claude')}' is not on PATH or not authenticated (cwd: ${cwd || '?'}). Try authenticating in a terminal, or set ${activeCodeAgent === 'codex' ? 'VIBEBUD_CODEX_BIN' : 'VIBEBUD_CLAUDE_BIN'} to the full path.`;
          appendStatus(`(${activeCodeLabel} exited with code ${code ?? '?'}: ${detail})`);
        }
        setClaudeBusy(false);
        setClaudeActive(false);
        claudeReplyIdRef.current = null;
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCodeBridge, activeCodeAgent, state.id]);

  // Tear down the subprocess if the buddy is removed mid-session.
  useEffect(() => {
    return () => {
      if (claudeBridge && claudeActive) void claudeBridge.stop(state.id).catch(() => {});
      if (codexBridge && claudeActive) void codexBridge.stop(state.id).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const toggleCodeAgent = async (agent: CodeAgent) => {
    const bridge = agent === 'codex' ? codexBridge : claudeBridge;
    if (!bridge) return;
    const label = agent === 'codex' ? 'Codex' : 'Claude Code';
    if (claudeActive && activeCodeAgent === agent) {
      await bridge.stop(state.id).catch(() => {});
      setClaudeActive(false);
      setActiveCodeAgent(null);
      setClaudeBusy(false);
      claudeReplyIdRef.current = null;
      return;
    }
    if (claudeActive && activeCodeBridge) {
      await activeCodeBridge.stop(state.id).catch(() => {});
    }
    const r = await bridge.start(state.id).catch((e) => ({ ok: false, error: String(e) } as const));
    if (r.ok) {
      setActiveCodeAgent(agent);
      setClaudeActive(true);
      setClaudeBusy(false);
      claudeReplyIdRef.current = null;
    } else {
      pushToast({ title: `${label} unavailable`, body: r.error || 'unknown error', tone: 'action' });
    }
  };

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
    if (!text || busy || claudeBusy) return;
    shouldStickToLatestRef.current = true;

    // Code-agent branch: pipe the user turn into the local/paired CLI
    // process via the platform bridge. The event subscription above
    // handles streaming the assistant reply back into the chat bubble.
    if (claudeActive && activeCodeBridge) {
      const userMsg: ChatMsg = { id: msgIdRef.current++, from: 'you', text };
      const replyId = msgIdRef.current++;
      const baseMessages = [...stateRef.current.messages, userMsg];
      const dailyXp = dailyRewardFor('chat', [state.id]);
      writeMessages([...baseMessages, { id: replyId, from: 'buddy', text: '' }], { amount: XP_REWARDS.chat + dailyXp, stat: 'chats' });
      setInput('');
      setClaudeBusy(true);
      claudeReplyIdRef.current = replyId;
      feel('thinking', 1400);
      const r = await activeCodeBridge.send(state.id, text);
      if (!r.ok) {
        const errText = r.error || 'send failed';
        const cur = stateRef.current.messages;
        const idx = cur.findIndex((m) => m.id === replyId);
        if (idx >= 0) {
          const next = cur.slice();
          next[idx] = { ...next[idx], text: `(error: ${errText})` };
          update({ messages: next });
        }
        setClaudeBusy(false);
        claudeReplyIdRef.current = null;
      }
      return;
    }

    if (!getApiKey()) {
      openSettings();
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
      {/* Toast stack — anchored above this buddy on desktop, full-width
          bottom-anchored on mobile (the buddy lives at the bottom-right edge
          of a phone screen so the desktop right-anchored 320 px stack would
          overflow off-screen). */}
      {contextMenu && typeof document !== 'undefined' && createPortal(
        <>
          <div
            data-buddy-interactive
            className="fixed inset-0 z-[70]"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
          />
          <div
            data-buddy-interactive
            className="fixed z-[71] min-w-[180px] overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            style={{
              left: Math.min(contextMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 9999) - 200),
              top: Math.min(contextMenu.y, (typeof window !== 'undefined' ? window.innerHeight : 9999) - 240),
            }}
          >
            {[
              { label: open ? 'Close chat' : 'Open chat', onClick: () => setOpen(!open) },
              ...(adapter.showPairingWindow
                ? [{ label: 'Pair phone…', onClick: () => adapter.showPairingWindow?.() }]
                : []),
              { label: 'Sign in', onClick: () => onOpenAppSettings?.() },
              { label: 'App settings…', onClick: () => onOpenAppSettings?.() },
              { label: 'Buddy details…', onClick: () => { setOpen(true); setChatDetailsOpen(true); } },
              { label: 'Add buddy', onClick: () => onSpawn() },
              ...(canRemove ? [{ label: 'Remove buddy', onClick: () => onRemove(), danger: true }] : []),
            ].map((item, i) => (
              <button
                key={i}
                onClick={() => { setContextMenu(null); item.onClick(); }}
                className={`block w-full px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                  (item as { danger?: boolean }).danger ? 'text-red-600 dark:text-red-400' : 'text-zinc-700 dark:text-zinc-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
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
                      if (v) setSettingsOpen(false);
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
              <>
              <div className="mt-2 max-h-[40vh] overflow-y-auto pr-1">
                <div className="mb-1 flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  <span>Level {progress.level}</span>
                  <span>{progress.xp} / {progress.next} XP</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-violet-500 transition-[width] duration-500"
                    style={{ width: `${progress.pct}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                  {progress.stats.chats} chats · {progress.stats.tasksCompleted} tasks · {progress.stats.pings} pings
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-zinc-600 dark:text-zinc-300">
                  <div className="rounded-xl bg-zinc-50 px-2 py-1.5 dark:bg-zinc-800/70">
                    <p className="font-semibold uppercase tracking-wider text-zinc-400">Bond</p>
                    <p className="mt-0.5">Lv {bond.bondLevel} · {bond.mood}</p>
                  </div>
                  <div className="rounded-xl bg-zinc-50 px-2 py-1.5 dark:bg-zinc-800/70">
                    <p className="font-semibold uppercase tracking-wider text-zinc-400">Team</p>
                    <p className="mt-0.5">{activeTeamBonus?.label ?? 'No active bonus'}</p>
                  </div>
                </div>
                {(unlockedMilestones.length > 0 || bond.memories.length > 0) && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {unlockedMilestones.slice(-3).map((m) => (
                      <span key={m.level} className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
                        {m.title}
                      </span>
                    ))}
                    {bond.memories.slice(-1).map((memory) => (
                      <span key={memory} className="max-w-full truncate rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">
                        {memory}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-2 space-y-1">
                  {dailyTasks.map((task) => (
                    <div key={task.id} className="flex items-center justify-between gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                      <span className={task.completedAt ? 'line-through opacity-60' : ''}>{task.title}</span>
                      <span className="shrink-0">{task.progress}/{task.target}</span>
                    </div>
                  ))}
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
                    <FamilyPill
                      label="Shimeji"
                      active={state.avatar?.kind === 'shimeji'}
                      open={familyMenu === 'shimeji'}
                      onClick={() => setFamilyMenu((m) => (m === 'shimeji' ? null : 'shimeji'))}
                    />
                    <FamilyPill
                      label="3D"
                      active={state.avatar?.kind === 'model3d'}
                      open={familyMenu === 'model3d'}
                      onClick={() => setFamilyMenu((m) => (m === 'model3d' ? null : 'model3d'))}
                    />
                  </div>
                  {(claudeBridge || codexBridge) && (
                  <div className="ml-auto flex gap-1">
                    </div>
                  )}
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
                {familyMenu === 'shimeji' && (
                  <div className="mt-2 space-y-2 rounded-2xl bg-zinc-50 px-2.5 py-2 dark:bg-zinc-800/60">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <label className="cursor-pointer rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-violet-700 ring-1 ring-violet-200 hover:bg-violet-50 dark:bg-zinc-900 dark:text-violet-200 dark:ring-violet-500/40 dark:hover:bg-violet-500/10">
                        import and use zip
                        <input
                          type="file"
                          accept=".zip,application/zip"
                          className="hidden"
                          onChange={(e) => {
                            void importShimejiPack(e.currentTarget.files?.[0] ?? null);
                            e.currentTarget.value = '';
                          }}
                        />
                      </label>
                    </div>
                    {shimejiPackError && (
                      <p className="rounded-xl bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:bg-red-500/10 dark:text-red-300">{shimejiPackError}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {shimejiPacks.map((pack) => {
                        const character = getShimejiCharacter(pack, state.avatar?.kind === 'shimeji' ? state.avatar.characterId : undefined);
                        const selected = state.avatar?.kind === 'shimeji' && state.avatar.packId === pack.manifest.id;
                        return (
                          <div
                            key={pack.manifest.id}
                            className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium transition-colors ${
                              selected
                                ? 'bg-violet-600 text-white'
                                : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-800'
                            }`}
                          >
                            <button
                              onClick={() => {
                                update({
                                  avatar: {
                                    kind: 'shimeji',
                                    packId: pack.manifest.id,
                                    characterId: character.id,
                                  },
                                });
                                setFamilyMenu(null);
                              }}
                              title={`${pack.manifest.name} · ${pack.manifest.license}`}
                              aria-label={`Use ${pack.manifest.name} Shimeji avatar`}
                              className="flex min-w-0 items-center gap-1.5"
                            >
                              <span
                                className="block h-5 w-5 overflow-hidden rounded-full bg-zinc-100"
                                style={{
                                  backgroundImage: `url("${resolveShimejiAsset(pack, character.preview)}")`,
                                  backgroundSize: 'cover',
                                  backgroundPosition: 'center',
                                }}
                                aria-hidden
                              />
                              <span className="truncate">{pack.manifest.name}</span>
                            </button>
                            {pack.source === 'imported' && (
                              <button
                                data-buddy-interactive
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void deleteShimejiPack(pack);
                                }}
                                title={`Delete ${pack.manifest.name}`}
                                aria-label={`Delete ${pack.manifest.name} Shimeji avatar`}
                                className={`ml-0.5 rounded-full px-1 text-[12px] leading-4 ${
                                  selected
                                    ? 'text-white/90 hover:bg-white/15'
                                    : 'text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10'
                                }`}
                              >
                                x
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {shimejiCatalog.length > 0 && (
                      <div className="space-y-1.5">
                        {shimejiCatalog.some((pack) => !shimejiPacks.some((p) => p.manifest.id === pack.manifest.id)) && (
                          <div className="grid gap-1.5">
                            {shimejiCatalog
                              .filter((pack) => !shimejiPacks.some((p) => p.manifest.id === pack.manifest.id))
                              .map((pack) => (
                                <button
                                  key={pack.manifest.id}
                                  onClick={() => void installAndUseShimejiPack(pack)}
                                  className="rounded-xl bg-white px-2.5 py-1.5 text-left text-[11px] ring-1 ring-zinc-200 hover:bg-zinc-100 dark:bg-zinc-900 dark:ring-zinc-700 dark:hover:bg-zinc-800"
                                >
                                  <span className="block font-semibold text-zinc-900 dark:text-zinc-50">{pack.manifest.name}</span>
                                  <span className="block text-zinc-500 dark:text-zinc-400">{pack.manifest.license} · install and use</span>
                                </button>
                              ))}
                          </div>
                        )}
                        <div className="rounded-xl bg-white px-2.5 py-2 text-[11px] ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700">
                          <p className="mb-1 font-semibold text-zinc-700 dark:text-zinc-200">Third-party libraries</p>
                          <div className="flex flex-wrap gap-1.5">
                            <a
                              data-buddy-interactive
                              href="https://shimeji.org/"
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-full px-2.5 py-1 font-medium text-violet-700 ring-1 ring-violet-200 hover:bg-violet-50 dark:text-violet-200 dark:ring-violet-500/40 dark:hover:bg-violet-500/10"
                            >
                              shimeji.org
                            </a>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {familyMenu === 'model3d' && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-2xl bg-zinc-50 px-2.5 py-2 dark:bg-zinc-800/60">
                    {MODEL_3D_AVATARS.map((model) => {
                      const selected = state.avatar?.kind === 'model3d' && state.avatar.id === model.id;
                      return (
                        <button
                          key={model.id}
                          onClick={() => {
                            update({ avatar: model });
                            setFamilyMenu(null);
                          }}
                          title={`${model.name} · GLB`}
                          aria-label={`Use ${model.name} 3D avatar`}
                          className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium transition-colors ${
                            selected
                              ? 'bg-violet-600 text-white'
                              : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-800'
                          }`}
                        >
                          <span className="grid h-5 w-5 place-items-center rounded-full bg-zinc-900 text-[9px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900" aria-hidden>
                            3D
                          </span>
                          <span>{model.name}</span>
                        </button>
                      );
                    })}
                    <p className="basis-full px-1 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                      GLB avatars use bundled animation clips when present and fall back to idle.
                    </p>
                  </div>
                )}
              </div>
              <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50/80 dark:border-zinc-700 dark:bg-zinc-800/50">
                <button
                  data-buddy-interactive
                  onClick={() => (settingsOpen ? setSettingsOpen(false) : openSettings())}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-semibold text-zinc-700 dark:text-zinc-200"
                >
                  <span>LLM settings</span>
                  <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                    {settingsOpen ? 'hide' : 'show'}
                  </span>
                </button>
                {settingsOpen && (
                  <div className="border-t border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
                    {showLlmOnboarding && (
                      <div className="mb-2 rounded-xl bg-violet-50 px-3 py-2 text-[11px] text-violet-800 dark:bg-violet-500/10 dark:text-violet-200">
                        Add an API key and model so this buddy can answer with your preferred provider.
                        <button
                          onClick={onDismissLlmOnboarding}
                          className="ml-2 font-semibold underline"
                        >
                          dismiss
                        </button>
                      </div>
                    )}
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
                    {(claudeBridge || codexBridge) && (
                      <div className="mb-2">
                        <p className="mb-1 text-[11px] text-zinc-600 dark:text-zinc-400">Local code agent</p>
                        <div className="flex flex-wrap gap-1">
                          {claudeBridge && (
                            <button
                              data-buddy-interactive
                              onClick={() => void toggleCodeAgent('claude')}
                              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                claudeActive && activeCodeAgent === 'claude'
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-800'
                              }`}
                              title={claudeActive && activeCodeAgent === 'claude' ? 'Claude Code session running - click to stop' : 'Start a local Claude Code session for this buddy'}
                            >
                              {claudeActive && activeCodeAgent === 'claude' ? '● Claude Code' : 'Claude Code'}
                            </button>
                          )}
                          {codexBridge && (
                            <button
                              data-buddy-interactive
                              onClick={() => void toggleCodeAgent('codex')}
                              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                claudeActive && activeCodeAgent === 'codex'
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-800'
                              }`}
                              title={claudeActive && activeCodeAgent === 'codex' ? 'Codex session running - click to stop' : 'Start a local Codex CLI session for this buddy'}
                            >
                              {claudeActive && activeCodeAgent === 'codex' ? '● Codex' : 'Codex'}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
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
                        {loadingModels ? 'loading...' : 'refresh'}
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
                        onClick={() => { setSettingsOpen(false); onDismissLlmOnboarding?.(); }}
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
              </div>
              </>
              )}
            </div>
            <div
              ref={messagesRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                shouldStickToLatestRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
              }}
              className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 py-3"
            >
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
                  disabled={busy || claudeBusy}
                  placeholder={busy || claudeBusy ? `${personality.name} is typing…` : `talk to ${personality.name}…`}
                  className="flex-1 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-violet-400 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
                {busy || claudeBusy ? (
                  <button
                    onClick={() => {
                      abortRef.current?.abort();
                      if (claudeActive && activeCodeBridge) void activeCodeBridge.stop(state.id).catch(() => {});
                      setClaudeBusy(false);
                      claudeReplyIdRef.current = null;
                    }}
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
              {shimejiAvatar ? (
                <ShimejiAvatarView avatar={shimejiAvatar} action={activeShimejiAction} direction={shimejiDirection} />
              ) : model3dAvatar ? (
                <Model3DAvatarView avatar={model3dAvatar} action={activeShimejiAction} direction={shimejiDirection} />
              ) : isComposite && composition ? (
                <CompositeFace composition={composition} fetched={notoFetched} />
              ) : (
                <Lottie animationData={animation} loop autoplay />
              )}
            </div>
          </button>
          {!isShimeji && !model3dAvatar && isComposite && composition && (
            <CompositeHands composition={composition} fetched={notoFetched} />
          )}
          </div>
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

// Composite layout for facesWithHands: the face fills the button (the actual
// tap region); hands and items render as decorative siblings positioned
// outside the button, with pointer-events-none so they don't expand the hit
// area. This keeps hands/items visually large without competing with the face
// for the limited interactive-region budget.
function CompositeFace({
  composition,
  fetched,
}: {
  composition: FacesWithHandsComposition;
  fetched: Record<string, unknown>;
}) {
  const data = composition.face
    ? ((fetched[composition.face] ?? getCachedLottie(composition.face)) as object | null)
    : null;
  if (!data) return null;
  return <Lottie animationData={data} loop autoplay />;
}

function CompositeHands({
  composition,
  fetched,
}: {
  composition: FacesWithHandsComposition;
  fetched: Record<string, unknown>;
}) {
  const dataFor = (cp: string | undefined) =>
    cp ? ((fetched[cp] ?? getCachedLottie(cp)) as object | null) : null;
  const lhData = dataFor(composition.lh);
  const lhItemData = dataFor(composition.lhItem);
  const rhData = dataFor(composition.rh);
  const rhItemData = dataFor(composition.rhItem);
  // Each prop is sized as a fraction of the 7rem (112px) button. Hands and
  // items live outside the button bounds via negative offsets.
  // Button is h-28 (7rem / 112px). Hands ~4.25rem, items ~3.5rem.
  const handSize = '4.25rem';
  const itemSize = '3.5rem';
  const Slot = ({ data, size }: { data: object | null; size: string }) =>
    data ? (
      <div style={{ width: size, height: size }} className="aspect-square shrink-0">
        <Lottie animationData={data} loop autoplay />
      </div>
    ) : null;
  return (
    <>
      {(composition.lh || composition.lhItem) && (
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 flex items-center"
          style={{ right: '100%', gap: '4px', paddingRight: '2px' }}
        >
          <Slot data={lhItemData} size={itemSize} />
          <Slot data={lhData} size={handSize} />
        </div>
      )}
      {(composition.rh || composition.rhItem) && (
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 flex items-center"
          style={{ left: '100%', gap: '4px', paddingLeft: '2px' }}
        >
          <Slot data={rhData} size={handSize} />
          <Slot data={rhItemData} size={itemSize} />
        </div>
      )}
    </>
  );
}

function cpToGlyph(cp: string): string {
  try {
    return cp.split('_').map((p) => String.fromCodePoint(parseInt(p, 16))).join('');
  } catch { return ''; }
}
