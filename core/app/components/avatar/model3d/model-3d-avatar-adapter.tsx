'use client';

import dynamic from 'next/dynamic';
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

const Model3DAvatarView = dynamic(() => import('./model-3d-avatar'), { ssr: false });

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

function Model3DPicker({ state, update }: Parameters<AvatarAdapter['Picker']>[0]) {
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
  const modelScale = selectedAvatar?.scale ?? 1;
  const fpsLimit = selectedAvatar?.fpsLimit ?? 30;
  const xOffset = selectedAvatar?.xOffset ?? 0;
  const yOffset = selectedAvatar?.yOffset ?? -1;
  const zOffset = selectedAvatar?.zOffset ?? 0;

  const updateSelectedModelScale = (scale: number) => {
    if (!selectedAvatar) return;
    update({ avatar: { ...selectedAvatar, scale } });
  };
  const updateSelectedFpsLimit = (fps: number) => {
    if (!selectedAvatar) return;
    update({ avatar: { ...selectedAvatar, fpsLimit: fps } });
  };
  const updateSelectedOffset = (axis: 'xOffset' | 'yOffset' | 'zOffset', value: number) => {
    if (!selectedAvatar) return;
    update({ avatar: { ...selectedAvatar, [axis]: value } });
  };

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
      {selectedAvatar && (
        <div className="basis-full rounded-xl bg-white px-2.5 py-2 text-[11px] ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700">
          <div className="mb-1 flex items-center justify-between gap-2">
            <label htmlFor={`model3d-scale-${state.id}`} className="font-semibold text-zinc-700 dark:text-zinc-200">
              model scale
            </label>
            <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{modelScale.toFixed(2)}x</span>
          </div>
          <input
            id={`model3d-scale-${state.id}`}
            type="range"
            min="0.1"
            max="5"
            step="0.05"
            value={modelScale}
            onChange={(event) => updateSelectedModelScale(Number(event.currentTarget.value))}
            className="block w-full accent-violet-600"
          />
          <div className="mb-1 mt-3 flex items-center justify-between gap-2">
            <label htmlFor={`model3d-fps-${state.id}`} className="font-semibold text-zinc-700 dark:text-zinc-200">
              render fps
            </label>
            <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{fpsLimit}</span>
          </div>
          <input
            id={`model3d-fps-${state.id}`}
            type="range"
            min="1"
            max="60"
            step="1"
            value={fpsLimit}
            onChange={(event) => updateSelectedFpsLimit(Number(event.currentTarget.value))}
            className="block w-full accent-violet-600"
          />
          <ModelAxisSlider id={`model3d-x-${state.id}`} label="x" value={xOffset} onChange={(value) => updateSelectedOffset('xOffset', value)} />
          <ModelAxisSlider id={`model3d-y-${state.id}`} label="y" value={yOffset} onChange={(value) => updateSelectedOffset('yOffset', value)} />
          <ModelAxisSlider id={`model3d-z-${state.id}`} label="z" value={zOffset} onChange={(value) => updateSelectedOffset('zOffset', value)} />
        </div>
      )}
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

function ModelAxisSlider({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (value: number) => void }) {
  return (
    <>
      <div className="mb-1 mt-3 flex items-center justify-between gap-2">
        <label htmlFor={id} className="font-semibold text-zinc-700 dark:text-zinc-200">
          position {label}
        </label>
        <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{value.toFixed(2)}</span>
      </div>
      <input
        id={id}
        type="range"
        min="-3"
        max="3"
        step="0.05"
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className="block w-full accent-violet-600"
      />
    </>
  );
}
