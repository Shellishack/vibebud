'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePlatform } from '@/lib/hooks/use-platform';
import { getNotifyMethod, setNotifyMethod, type NotifyMethod } from './llm';
import {
  getRemoteClaudeConfig, setRemoteClaudeConfig, type RemoteClaudeConfig,
} from '../../lib/platform/remote-claude';
import { getPhysicsMode, setPhysicsMode, type PhysicsMode, getRotationEnabled, setRotationEnabled } from './physics';
import AccountPanel from './account-panel';
import {
  bondXpForLevel,
  levelProgress,
  loadGamificationStore,
  subscribeGamification,
  unlockedMilestonesFor,
  type BuddySnapshot,
} from './gamification';
import { getPersonality } from './personalities';
import { useTranslations } from '../../lib/hooks/use-translations';
import {
  fetchShimejiCatalog,
  getShimejiMarketplaceUrl,
  importShimejiZip,
  installCatalogPack,
  listShimejiPacks,
  removeShimejiPack,
  resolveShimejiAsset,
  subscribeShimejiPacks,
} from '../../lib/avatar/shimeji';
import type { InstalledShimejiPack, ShimejiPackManifest } from '../../lib/avatar/types';

type Props = { open: boolean; onClose: () => void };

export default function AppSettings({ open, onClose }: Props) {
  if (!open || typeof document === 'undefined') return null;
  return <AppSettingsBody onClose={onClose} />;
}

function AppSettingsBody({ onClose }: { onClose: () => void }) {
  const { t } = useTranslations();
  const adapter = usePlatform();
  const [method, setMethod] = useState<NotifyMethod>(() => getNotifyMethod());
  const [permGranted, setPermGranted] = useState<boolean>(() => adapter.hasNotificationPermission());
  const [physicsMode, setPhysicsModeState] = useState<PhysicsMode>(() => getPhysicsMode());
  const choosePhysics = (next: PhysicsMode) => {
    setPhysicsModeState(next);
    setPhysicsMode(next);
  };
  const [rotationOn, setRotationOnState] = useState<boolean>(() => getRotationEnabled());
  const [collectionOpen, setCollectionOpen] = useState(false);
  const toggleRotation = () => {
    const next = !rotationOn;
    setRotationOnState(next);
    setRotationEnabled(next);
  };

  // Pair-with-desktop state. Web/Capacitor only — Electron uses the
  // in-process Claude bridge and doesn't need a remote URL.
  const showPairingUi = adapter.id !== 'electron';
  const [pairConfig, setPairConfig] = useState<RemoteClaudeConfig | null>(() => getRemoteClaudeConfig());
  const [scanError, setScanError] = useState<string | null>(null);
  const [manualHost, setManualHost] = useState(() => getRemoteClaudeConfig()?.url ?? '');
  const [manualToken, setManualToken] = useState(() => getRemoteClaudeConfig()?.token ?? '');
  const [manualError, setManualError] = useState<string | null>(null);
  const submitManual = () => {
    setManualError(null);
    const tok = manualToken.trim();
    if (!tok) { setManualError(t('settings.tokenRequired')); return; }
    let raw = manualHost.trim();
    if (!raw) { setManualError(t('settings.hostRequired')); return; }
    // Accept "192.168.1.42", "192.168.1.42:3061", or a full ws://… URL.
    // Default port matches desktop's pairing.js DEFAULT_PORT (3061).
    if (!/^wss?:\/\//i.test(raw)) raw = 'ws://' + raw;
    if (!/:\d+(?:\/|$)/.test(raw)) raw = raw.replace(/\/?$/, '') + ':3061';
    let url: URL;
    try { url = new URL(raw); }
    catch { setManualError(t('settings.invalidHost')); return; }
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      setManualError(t('settings.invalidProtocol')); return;
    }
    const cfg = { url: url.toString().replace(/\/$/, ''), token: tok };
    setRemoteClaudeConfig(cfg);
    setPairConfig(cfg);
    setManualHost(cfg.url);
  };
  useEffect(() => {
    // MainActivity.handlePairingIntent fires this after a deep-link pair —
    // either from the system camera tapping the QR or from QrPairScanActivity
    // (Google ML Kit scanner) routing the decoded URI back through the same
    // intent filter.
    const onPaired = () => setPairConfig(getRemoteClaudeConfig());
    window.addEventListener('vibebud:paired', onPaired);
    return () => window.removeEventListener('vibebud:paired', onPaired);
  }, []);

  const choose = (next: NotifyMethod) => {
    setMethod(next);
    setNotifyMethod(next);
    if (next === 'native') {
      void adapter.requestNotificationPermission().then((ok) => setPermGranted(ok));
    }
  };

  // Re-poll permission state whenever the user returns to the app (e.g.
  // came back from the system Settings activity). Cheap, runs every 1s
  // while the panel is open, plus on visibility/focus.
  useEffect(() => {
    const recheck = () => setPermGranted(adapter.hasNotificationPermission());
    recheck();
    const t = setInterval(recheck, 1000);
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, [adapter]);

  const showPermHint = method === 'native' && !permGranted;

  return createPortal(
    <>
      <div
        data-buddy-interactive
        className="fixed inset-0 z-[80] flex min-h-0 items-center justify-center overflow-hidden bg-black/40 p-3 backdrop-blur-sm sm:p-4"
        onClick={onClose}
      >
        <div
          className="flex max-h-[calc(100dvh-1.5rem)] min-h-0 w-full max-w-md flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white/95 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900/95 sm:max-h-[calc(100dvh-2rem)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-700">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{t('settings.title')}</h2>
            <button
              onClick={onClose}
              aria-label={t('settings.close')}
              className="grid h-7 w-7 place-items-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          <section className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {t('settings.account')}
            </p>
            <AccountPanel />
          </section>

          {showPairingUi && (
            <section className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {t('settings.pairWithDesktop')}
              </p>
              <p className="mt-1 mb-3 text-xs text-zinc-500 dark:text-zinc-400">
                {t('settings.pairDescription')}
              </p>
              {pairConfig && (
                <p className="mb-3 text-xs text-zinc-700 dark:text-zinc-200">
                  {t('settings.pairedWith', { url: pairConfig.url })}
                </p>
              )}
              {adapter.scanQrForPair ? (
                <>
                  <button
                    onClick={async () => {
                      setScanError(t('settings.openingScanner'));
                      const r = await adapter.scanQrForPair?.();
                      // Cancel/empty-result is a normal user gesture, not an
                      // error — stay silent so we don't yell about it.
                      if (r && !r.ok && !/cancel|empty result/i.test(r.reason || '')) {
                        setScanError(r.reason || t('settings.unknownFailure'));
                      } else {
                        setScanError(null);
                      }
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-700"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="7" height="7" rx="1" />
                      <rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" />
                      <path d="M14 14h3v3h-3zM20 14v3M14 20h3M17 20h3M20 17v3" />
                    </svg>
                    {pairConfig ? t('settings.rescanQr') : t('settings.scanQr')}
                  </button>
                  {scanError && (
                    <div className="mt-2 rounded-lg bg-red-50 p-2 text-[11px] text-red-700 dark:bg-red-500/10 dark:text-red-300">
                      {scanError}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t('settings.scanUnavailable')}
                </p>
              )}
              {!pairConfig && (
              <div className="mt-3 rounded-2xl border border-zinc-200 p-3 dark:border-zinc-700">
                <p className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                  {t('settings.manualTitle')}
                </p>
                <label className="mb-1 block text-[11px] text-zinc-600 dark:text-zinc-400">
                  {t('settings.hostLabel')}
                </label>
                <input
                  type="text"
                  inputMode="url"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={manualHost}
                  onChange={(e) => setManualHost(e.target.value)}
                  placeholder={t('settings.hostPlaceholder')}
                  className="mb-2 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 font-mono text-[11px] outline-none focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-900"
                />
                <label className="mb-1 block text-[11px] text-zinc-600 dark:text-zinc-400">
                  {t('settings.tokenLabel')}
                </label>
                <input
                  type="text"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  placeholder={t('settings.tokenPlaceholder')}
                  className="mb-2 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 font-mono text-[11px] outline-none focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-900"
                />
                <button
                  onClick={submitManual}
                  className="w-full rounded-full bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700"
                >
                  {t('settings.pairManual')}
                </button>
                {manualError && (
                  <p className="mt-1 text-[10px] text-red-600 dark:text-red-400">{manualError}</p>
                )}
              </div>
              )}

              {pairConfig && (
                <button
                  onClick={() => { setRemoteClaudeConfig(null); setPairConfig(null); setManualHost(''); setManualToken(''); }}
                  className="mt-2 w-full rounded-2xl px-4 py-2 text-xs text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-100 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-800"
                >
                  {t('settings.unpair')}
                </button>
              )}
            </section>
          )}

          <section className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {t('settings.play')}
            </p>
            <p className="mt-1 mb-3 text-xs text-zinc-500 dark:text-zinc-400">
              {t('settings.playDescription')}
            </p>
            <div className="flex flex-col gap-2">
              <Option
                selected={physicsMode === 'off'}
                label={t('settings.physics.calm')}
                desc={t('settings.physics.calmDesc')}
                onClick={() => choosePhysics('off')}
              />
              <Option
                selected={physicsMode === 'bouncy'}
                label={t('settings.physics.bouncy')}
                desc={t('settings.physics.bouncyDesc')}
                onClick={() => choosePhysics('bouncy')}
              />
              <Option
                selected={physicsMode === 'astronaut'}
                label={t('settings.physics.astronaut')}
                desc={t('settings.physics.astronautDesc')}
                onClick={() => choosePhysics('astronaut')}
              />
              <Option
                selected={physicsMode === 'wonder'}
                label={t('settings.physics.wonder')}
                desc={t('settings.physics.wonderDesc')}
                onClick={() => choosePhysics('wonder')}
              />
            </div>
            <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800">
              <input
                type="checkbox"
                checked={rotationOn}
                onChange={toggleRotation}
                className="mt-0.5 h-4 w-4 accent-violet-600"
              />
              <span className="flex flex-col">
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{t('settings.rotateAvatars')}</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t('settings.rotateDescription')}
                </span>
              </span>
            </label>
            <button
              onClick={() => setCollectionOpen(true)}
              className="mt-3 w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 text-left text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
            >
              {t('settings.collection')}
              <span className="mt-0.5 block text-xs font-normal text-zinc-500 dark:text-zinc-400">
                {t('settings.collectionDescription')}
              </span>
            </button>
          </section>

          <section>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {t('settings.notifications')}
            </p>
            <p className="mt-1 mb-3 text-xs text-zinc-500 dark:text-zinc-400">
              {t('settings.notificationsDescription')}
            </p>
            <div className="flex flex-col gap-2">
              <Option
                selected={method === 'in-app'}
                label={t('settings.inAppToast')}
                desc={t('settings.inAppToastDesc')}
                onClick={() => choose('in-app')}
              />
              <Option
                selected={method === 'native'}
                label={t('settings.nativeNotification')}
                desc={
                  adapter.id === 'electron' ? t('settings.nativeElectronDesc')
                  : adapter.id === 'capacitor-android' ? t('settings.nativeAndroidDesc')
                  : t('settings.nativeBrowserDesc')
                }
                onClick={() => choose('native')}
                status={
                  method === 'native'
                    ? permGranted
                      ? { tone: 'ok', text: t('settings.allowed') }
                      : { tone: 'warn', text: t('settings.permissionNeeded') }
                    : null
                }
              />
            </div>
            {showPermHint && (
              <div className="mt-3 flex flex-col gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                <p>
                  {adapter.id === 'capacitor-android'
                    ? t('settings.androidPermissionHint')
                    : t('settings.browserPermissionHint')}
                </p>
                <button
                  onClick={() => void adapter.requestNotificationPermission().then((ok) => setPermGranted(ok))}
                  className="self-start rounded-full bg-amber-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400"
                >
                  {t('settings.openPermissionSettings')}
                </button>
              </div>
            )}
          </section>
          </div>
        </div>
      </div>
      {collectionOpen && <CollectionModal onClose={() => setCollectionOpen(false)} />}
    </>,
    document.body,
  );
}

function CollectionModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslations();
  const [tick, setTick] = useState(0);
  const [packs, setPacks] = useState<InstalledShimejiPack[]>([]);
  const [catalog, setCatalog] = useState<Array<{ manifest: ShimejiPackManifest; baseUrl: string }>>([]);
  const [packError, setPackError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  void tick;
  useEffect(() => subscribeGamification(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => listShimejiPacks().then((next) => { if (!cancelled) setPacks(next); });
    refresh();
    const unsub = subscribeShimejiPacks(refresh);
    return () => { cancelled = true; unsub(); };
  }, []);
  const loadCatalog = () => {
    setPackError(null);
    setCatalogLoading(true);
    fetchShimejiCatalog()
      .then(setCatalog)
      .catch((e) => setPackError(e instanceof Error ? e.message : String(e)))
      .finally(() => setCatalogLoading(false));
  };
  const onImportZip = async (file: File | null) => {
    if (!file) return;
    setPackError(null);
    try {
      await importShimejiZip(file);
    } catch (e) {
      setPackError(e instanceof Error ? e.message : String(e));
    }
  };
  const installedIds = new Set(packs.map((p) => p.manifest.id));
  const store = loadGamificationStore();
  const buddies = loadBuddySnapshots();
  const favoriteTeams = Object.entries(store.collection.favoriteTeams).sort((a, b) => b[1] - a[1]);

  return (
    <div
      data-buddy-interactive
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-700">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{t('collection.title')}</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('collection.subtitle')}</p>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800" aria-label={t('collection.close')}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <section className="mb-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{t('collection.today')}</h3>
            <div className="grid gap-2">
              {store.dailyTasks.map((task) => (
                <div key={task.id} className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800/70">
                  <div className="flex items-center justify-between gap-3">
                    <p className={`text-sm font-medium text-zinc-900 dark:text-zinc-50 ${task.completedAt ? 'line-through opacity-60' : ''}`}>{task.title}</p>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{task.progress}/{task.target}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, (task.progress / task.target) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="mb-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{t('collection.buddies')}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {buddies.map((buddy) => {
                const p = getPersonality(buddy.variantId);
                const progress = levelProgress(buddy);
                const bond = store.bonds[buddy.id] ?? { bondXp: 0, bondLevel: 1, mood: 'curious', lastInteractionSummary: '', memories: [] };
                const milestones = unlockedMilestonesFor(buddy.id);
                return (
                  <div key={buddy.id} className="rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-950/40">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">{p.name}</p>
                        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{p.role || t('manage.noRole')}</p>
                      </div>
                      <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-bold text-white">{t('collection.level', { level: progress.level })}</span>
                    </div>
                    <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">{t('collection.bond', { level: bond.bondLevel, mood: bond.mood })}</p>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                      <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.min(100, (bond.bondXp / bondXpForLevel(bond.bondLevel)) * 100)}%` }} />
                    </div>
                    <p className="mt-2 text-[10px] text-zinc-500 dark:text-zinc-400">{t('collection.stats', { chats: progress.stats.chats, tasks: progress.stats.tasksCompleted, pings: progress.stats.pings })}</p>
                    {milestones.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {milestones.map((m) => (
                          <span key={m.level} className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">{m.title}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="mb-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Shimeji packs</h3>
              <label className="cursor-pointer rounded-full bg-violet-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-violet-700">
                import ZIP
                <input
                  type="file"
                  accept=".zip,application/zip"
                  className="hidden"
                  onChange={(e) => void onImportZip(e.currentTarget.files?.[0] ?? null)}
                />
              </label>
            </div>
            {packError && (
              <p className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">{packError}</p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {packs.map((pack) => {
                const character = pack.manifest.characters[0];
                return (
                  <div key={pack.manifest.id} className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-950/40">
                    <span
                      className="h-12 w-12 shrink-0 rounded-xl bg-zinc-100"
                      style={{ background: `center / cover no-repeat url("${resolveShimejiAsset(pack, character.preview)}")` }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">{pack.manifest.name}</p>
                      <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{pack.manifest.license} · {pack.source}</p>
                    </div>
                    {pack.source !== 'bundled' && (
                      <button
                        onClick={() => void removeShimejiPack(pack.manifest.id).catch((e) => setPackError(e instanceof Error ? e.message : String(e)))}
                        className="rounded-full px-2 py-1 text-[11px] text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10"
                      >
                        delete
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/70">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Remote catalog</p>
                <button
                  onClick={loadCatalog}
                  disabled={catalogLoading}
                  className="rounded-full px-3 py-1 text-[11px] font-semibold text-violet-700 ring-1 ring-violet-200 hover:bg-violet-50 disabled:opacity-60 dark:text-violet-200 dark:ring-violet-500/40 dark:hover:bg-violet-500/10"
                >
                  {catalogLoading ? 'loading...' : 'refresh'}
                </button>
                <a
                  href={getShimejiMarketplaceUrl()}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full px-3 py-1 text-[11px] font-semibold text-zinc-700 ring-1 ring-zinc-200 hover:bg-white dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-900"
                >
                  marketplace
                </a>
              </div>
              {catalog.length > 0 && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {catalog.filter((pack) => !installedIds.has(pack.manifest.id)).map((pack) => (
                    <button
                      key={pack.manifest.id}
                      onClick={() => void installCatalogPack(pack).catch((e) => setPackError(e instanceof Error ? e.message : String(e)))}
                      className="rounded-xl bg-white px-3 py-2 text-left text-xs ring-1 ring-zinc-200 hover:bg-zinc-100 dark:bg-zinc-950/50 dark:ring-zinc-700 dark:hover:bg-zinc-900"
                    >
                      <span className="block font-semibold text-zinc-900 dark:text-zinc-50">{pack.manifest.name}</span>
                      <span className="block text-zinc-500 dark:text-zinc-400">{pack.manifest.license} · install</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{t('collection.teams')}</h3>
            {favoriteTeams.length === 0 ? (
              <p className="rounded-2xl bg-zinc-50 p-3 text-sm text-zinc-500 dark:bg-zinc-800/70 dark:text-zinc-400">{t('collection.teamsEmpty')}</p>
            ) : (
              <div className="space-y-2">
                {favoriteTeams.slice(0, 5).map(([team, count]) => (
                  <div key={team} className="flex items-center justify-between rounded-2xl bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/70">
                    <span className="truncate text-zinc-700 dark:text-zinc-200">{team.split('+').map((id) => getPersonality(buddies.find((b) => b.id === id)?.variantId ?? 'violet').name).join(' + ')}</span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{t('collection.uses', { count })}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function loadBuddySnapshots(): BuddySnapshot[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem('vibebud.buddies.v2') || 'null') as { buddies?: BuddySnapshot[] } | null;
    return Array.isArray(parsed?.buddies) ? parsed.buddies : [];
  } catch {
    return [];
  }
}

function Option({ selected, label, desc, onClick, status }: {
  selected: boolean;
  label: string;
  desc: string;
  onClick: () => void;
  status?: { tone: 'ok' | 'warn'; text: string } | null;
}) {
  const { t } = useTranslations();
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-start gap-0.5 rounded-2xl border px-3 py-2.5 text-left transition-colors ${
        selected
          ? 'border-violet-500 bg-violet-50 dark:border-violet-400 dark:bg-violet-500/10'
          : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800'
      }`}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{label}</span>
        <span className="flex items-center gap-1.5">
          {status && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
              status.tone === 'ok'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300'
            }`}>
              {status.text}
            </span>
          )}
          {selected && (
            <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
              {t('settings.on')}
            </span>
          )}
        </span>
      </span>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{desc}</span>
    </button>
  );
}
