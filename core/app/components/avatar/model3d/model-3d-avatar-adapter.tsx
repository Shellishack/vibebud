'use client';

import { useEffect, useState } from 'react';
import {
  fetchModel3DCatalog,
  getModel3DCommunityLibraries,
  importModel3D,
  installCatalogModel,
  listModel3D,
  removeModel3D,
  subscribeModel3D,
} from '@/lib/avatar/model3d';
import { usePlatform } from '@/lib/hooks/use-platform';
import type { InstalledModel3D, Model3DAvatar } from '@/lib/avatar/types';
import type { AvatarAdapter } from '../types';
import Model3DAvatarView from './model-3d-avatar';

const MOVING_ACTIONS = new Set(['walk', 'climb', 'fall', 'drag']);

export const model3dAvatarAdapter: AvatarAdapter = {
  category: 'model3d',
  label: '3D',
  matches: (state) => state.avatar?.kind === 'model3d',
  useRuntime: ({ state, action, direction }) => {
    const avatar = state.avatar?.kind === 'model3d' ? state.avatar : null;
    return {
      visual: avatar ? <Model3DAvatarView avatar={avatar} action={action} direction={direction} /> : null,
      isMoving: !!avatar && MOVING_ACTIONS.has(action),
    };
  },
  Picker: (props) => <Model3DPicker {...props} />,
};

type CatalogModel = {
  avatar: Model3DAvatar;
  license?: string;
  author?: string;
  description?: string;
};

function Model3DPicker({ state, update, close }: Parameters<AvatarAdapter['Picker']>[0]) {
  const platform = usePlatform();
  const [models, setModels] = useState<InstalledModel3D[]>([]);
  const [catalog, setCatalog] = useState<CatalogModel[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogChecked, setCatalogChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      listModel3D().then((next) => { if (!cancelled) setModels(next); });
    };
    refresh();
    const unsub = subscribeModel3D(refresh);
    return () => { cancelled = true; unsub(); };
  }, []);

  useEffect(() => {
    if (catalogChecked || catalogLoading) return;
    setError(null);
    setCatalogLoading(true);
    fetchModel3DCatalog()
      .then((next) => {
        setCatalog(next);
        setCatalogChecked(true);
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e);
        if (!message.includes('404')) setError(message);
        setCatalogChecked(true);
      })
      .finally(() => setCatalogLoading(false));
  }, [catalogChecked, catalogLoading]);

  const useModel = (model: InstalledModel3D) => {
    update({ avatar: model.avatar });
    close();
  };

  const importModel = async (file: File | null) => {
    if (!file) return;
    setError(null);
    try {
      useModel(await importModel3D(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteModel = async (model: InstalledModel3D) => {
    setError(null);
    try {
      await removeModel3D(model.avatar.id);
      if (state.avatar?.kind === 'model3d' && state.avatar.id === model.avatar.id) update({ avatar: undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const installAndUse = async (model: CatalogModel) => {
    setError(null);
    try {
      useModel(await installCatalogModel(model));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const installedIds = new Set(models.map((model) => model.avatar.id));

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-2xl bg-zinc-50 px-2.5 py-2 dark:bg-zinc-800/60">
      <label className="cursor-pointer rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-violet-700 ring-1 ring-violet-200 hover:bg-violet-50 dark:bg-zinc-900 dark:text-violet-200 dark:ring-violet-500/40 dark:hover:bg-violet-500/10">
        import model
        <input
          type="file"
          accept=".zip,.glb,.gltf,.fbx,.obj,application/zip,model/gltf-binary,model/gltf+json"
          className="hidden"
          onChange={(e) => {
            void importModel(e.currentTarget.files?.[0] ?? null);
            e.currentTarget.value = '';
          }}
        />
      </label>
      {error && <p className="basis-full rounded-xl bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      {models.map((model) => {
        const selected = state.avatar?.kind === 'model3d' && state.avatar.id === model.avatar.id;
        return (
          <div
            key={model.avatar.id}
            className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium transition-colors ${
              selected
                ? 'bg-violet-600 text-white'
                : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-800'
            }`}
          >
            <button
              onClick={() => useModel(model)}
              title={`${model.avatar.name} · ${model.source}`}
              aria-label={`Use ${model.avatar.name} 3D avatar`}
              className="flex min-w-0 items-center gap-1.5"
            >
              <span className="grid h-5 w-5 place-items-center rounded-full bg-zinc-900 text-[9px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900" aria-hidden>
                3D
              </span>
              <span className="truncate">{model.avatar.name}</span>
            </button>
            {model.source !== 'bundled' && (
              <button
                data-buddy-interactive
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteModel(model);
                }}
                title={`Delete ${model.avatar.name}`}
                aria-label={`Delete ${model.avatar.name} 3D avatar`}
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
      {catalog.filter((model) => !installedIds.has(model.avatar.id)).map((model) => (
        <button
          key={model.avatar.id}
          onClick={() => void installAndUse(model)}
          className="basis-full rounded-xl bg-white px-2.5 py-1.5 text-left text-[11px] ring-1 ring-zinc-200 hover:bg-zinc-100 dark:bg-zinc-900 dark:ring-zinc-700 dark:hover:bg-zinc-800"
        >
          <span className="block font-semibold text-zinc-900 dark:text-zinc-50">{model.avatar.name}</span>
          <span className="block text-zinc-500 dark:text-zinc-400">{model.license ?? 'GLB/GLTF'} · install and use</span>
        </button>
      ))}
      <p className="basis-full px-1 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        GLB is recommended. ZIP imports can include GLTF sidecar bin and texture files. Loose FBX and OBJ imports should be self-contained.
      </p>
      <div className="basis-full rounded-xl bg-white px-2.5 py-2 text-[11px] ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700">
        <p className="mb-1 font-semibold text-zinc-700 dark:text-zinc-200">Community libraries</p>
        <div className="flex flex-wrap gap-1.5">
          {getModel3DCommunityLibraries().map((library) => (
            <button
              key={library.href}
              data-buddy-interactive
              type="button"
              onClick={() => platform.openExternal(library.href)}
              className="rounded-full px-2.5 py-1 font-medium text-violet-700 ring-1 ring-violet-200 hover:bg-violet-50 dark:text-violet-200 dark:ring-violet-500/40 dark:hover:bg-violet-500/10"
            >
              {library.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
