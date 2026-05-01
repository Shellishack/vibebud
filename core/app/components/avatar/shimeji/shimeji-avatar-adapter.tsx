'use client';

import { useEffect, useState } from 'react';
import {
  fetchShimejiCatalog,
  getShimejiCharacter,
  importShimejiZip,
  installCatalogPack,
  listShimejiPacks,
  removeShimejiPack,
  resolveShimejiAsset,
  subscribeShimejiPacks,
} from '@/lib/avatar/shimeji';
import type { InstalledShimejiPack, ShimejiPackManifest } from '@/lib/avatar/types';
import type { AvatarAdapter } from '../types';
import ShimejiAvatarView from './shimeji-avatar';

const MOVING_ACTIONS = new Set(['walk', 'climb', 'fall', 'drag']);

export const shimejiAvatarAdapter: AvatarAdapter = {
  category: 'shimeji',
  label: 'Shimeji',
  matches: (state) => state.avatar?.kind === 'shimeji',
  useRuntime: ({ state, action, direction }) => {
    const avatar = state.avatar?.kind === 'shimeji' ? state.avatar : null;
    return {
      visual: avatar ? <ShimejiAvatarView avatar={avatar} action={action} direction={direction} /> : null,
      isMoving: !!avatar && MOVING_ACTIONS.has(action),
    };
  },
  Picker: (props) => <ShimejiPicker {...props} />,
};

function ShimejiPicker({ state, update, close }: Parameters<AvatarAdapter['Picker']>[0]) {
  const [packs, setPacks] = useState<InstalledShimejiPack[]>([]);
  const [catalog, setCatalog] = useState<Array<{ manifest: ShimejiPackManifest; baseUrl: string }>>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      listShimejiPacks().then((next) => { if (!cancelled) setPacks(next); });
    };
    refresh();
    const unsub = subscribeShimejiPacks(refresh);
    return () => { cancelled = true; unsub(); };
  }, []);

  useEffect(() => {
    if (catalog.length > 0 || catalogLoading) return;
    setError(null);
    setCatalogLoading(true);
    fetchShimejiCatalog()
      .then(setCatalog)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setCatalogLoading(false));
  }, [catalog.length, catalogLoading]);

  const usePack = (pack: InstalledShimejiPack) => {
    const character = getShimejiCharacter(pack, state.avatar?.kind === 'shimeji' ? state.avatar.characterId : undefined);
    update({ avatar: { kind: 'shimeji', packId: pack.manifest.id, characterId: character.id } });
    close();
  };

  const importPack = async (file: File | null) => {
    if (!file) return;
    setError(null);
    try {
      usePack(await importShimejiZip(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const deletePack = async (pack: InstalledShimejiPack) => {
    setError(null);
    try {
      await removeShimejiPack(pack.manifest.id);
      if (state.avatar?.kind === 'shimeji' && state.avatar.packId === pack.manifest.id) update({ avatar: undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const installAndUse = async (pack: { manifest: ShimejiPackManifest; baseUrl: string }) => {
    setError(null);
    try {
      usePack(await installCatalogPack(pack));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="mt-2 space-y-2 rounded-2xl bg-zinc-50 px-2.5 py-2 dark:bg-zinc-800/60">
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="cursor-pointer rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-violet-700 ring-1 ring-violet-200 hover:bg-violet-50 dark:bg-zinc-900 dark:text-violet-200 dark:ring-violet-500/40 dark:hover:bg-violet-500/10">
          import and use zip
          <input
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              void importPack(e.currentTarget.files?.[0] ?? null);
              e.currentTarget.value = '';
            }}
          />
        </label>
      </div>
      {error && <p className="rounded-xl bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {packs.map((pack) => {
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
                onClick={() => usePack(pack)}
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
                    void deletePack(pack);
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
      {catalog.length > 0 && (
        <div className="space-y-1.5">
          {catalog.some((pack) => !packs.some((p) => p.manifest.id === pack.manifest.id)) && (
            <div className="grid gap-1.5">
              {catalog
                .filter((pack) => !packs.some((p) => p.manifest.id === pack.manifest.id))
                .map((pack) => (
                  <button
                    key={pack.manifest.id}
                    onClick={() => void installAndUse(pack)}
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
  );
}
