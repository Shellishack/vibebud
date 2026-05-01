'use client';

import type { AvatarAdapter } from '../types';
import Model3DAvatarView, { MODEL_3D_AVATARS } from './Model3DAvatar';

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
  Picker: ({ state, update, close }) => (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-2xl bg-zinc-50 px-2.5 py-2 dark:bg-zinc-800/60">
      {MODEL_3D_AVATARS.map((model) => {
        const selected = state.avatar?.kind === 'model3d' && state.avatar.id === model.id;
        return (
          <button
            key={model.id}
            onClick={() => {
              update({ avatar: model });
              close();
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
  ),
};
