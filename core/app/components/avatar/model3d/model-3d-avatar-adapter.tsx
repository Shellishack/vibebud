'use client';

import { useEffect, useState } from 'react';
import {
  importModel3D,
  listModel3D,
  model3DAnimationReadiness,
  removeModel3D,
  subscribeModel3D,
} from '@/lib/avatar/model3d';
import type { InstalledModel3D } from '@/lib/avatar/types';
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

function Model3DPicker({ state, update, close }: Parameters<AvatarAdapter['Picker']>[0]) {
  const [models, setModels] = useState<InstalledModel3D[]>([]);
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

  const useModel = async (model: InstalledModel3D) => {
    update({ avatar: model.avatar });
    close();
  };

  const importModel = async (file: File | null) => {
    if (!file) return;
    setError(null);
    try {
      await useModel(await importModel3D(file));
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
  const selectedAvatar = state.avatar?.kind === 'model3d' ? state.avatar : null;
  const selectedReadiness = selectedAvatar ? model3DAnimationReadiness(selectedAvatar) : null;

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
              onClick={() => void useModel(model)}
              title={`${model.avatar.name} · ${model.source}`}
              aria-label={`Use ${model.avatar.name} 3D avatar`}
              className="flex min-w-0 items-center gap-1.5"
            >
              <span className="grid h-5 w-5 place-items-center rounded-full bg-zinc-900 text-[9px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900" aria-hidden>
                3D
              </span>
              <span className="truncate">{model.avatar.name}</span>
            </button>
            {model.avatar.skeleton && !model.avatar.skeleton.humanoid && (
              <span
                title={model.avatar.skeleton.hasSkeleton ? 'Skeleton is not recognized as humanoid.' : 'No skeleton found.'}
                className={`rounded-full px-1 text-[9px] leading-4 ${
                  selected
                    ? 'bg-white/15 text-white'
                    : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200'
                }`}
              >
                no anim
              </span>
            )}
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
      <p className="basis-full px-1 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        GLB or ZIP packages are recommended.
      </p>
      {selectedAvatar && selectedReadiness === 'no-skeleton' && (
        <p className="basis-full rounded-xl bg-red-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-red-700 dark:bg-red-500/10 dark:text-red-200">
          No skeleton was found in this model. Embedded mesh animations may still play, but humanoid action matching will be limited.
        </p>
      )}
      {selectedAvatar && selectedReadiness === 'non-humanoid' && (
        <p className="basis-full rounded-xl bg-red-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-red-700 dark:bg-red-500/10 dark:text-red-200">
          This skeleton is not recognized as humanoid. Embedded animations may still work, but automatic action matching may be limited.
        </p>
      )}
    </div>
  );
}
