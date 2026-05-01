'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import { VARIANTS, buildAnimation, cssColor } from '../../avatars';
import type { AvatarAdapter } from '../types';

const Lottie = dynamic(() => import('lottie-react'), { ssr: false });

export const buddyAvatarAdapter: AvatarAdapter = {
  category: 'buddy',
  label: 'Buddy',
  matches: (state) => !state.avatar,
  useRuntime: ({ personality, emotion }) => {
    const variant = VARIANTS.find((v) => v.id === personality.colorId) ?? VARIANTS[0];
    const animation = useMemo(() => buildAnimation(variant, emotion), [variant, emotion]);
    return {
      visual: <Lottie animationData={animation} loop autoplay />,
      isMoving: false,
    };
  },
  Picker: ({ state, update, close }) => (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-2xl bg-zinc-50 px-2.5 py-2 dark:bg-zinc-800/60">
      {VARIANTS.map((v) => (
        <button
          key={v.id}
          onClick={() => {
            update({ variantId: v.id, avatar: undefined });
            close();
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
  ),
};
