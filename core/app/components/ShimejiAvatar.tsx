'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  getShimejiCharacter,
  getShimejiPack,
  resolveShimejiAsset,
} from '../../lib/avatar/shimeji';
import type { InstalledShimejiPack, ShimejiAction, ShimejiAvatar } from '../../lib/avatar/types';

type Props = {
  avatar: ShimejiAvatar;
  action?: ShimejiAction;
  sizeClass?: string;
  className?: string;
};

export default function ShimejiAvatarView({ avatar, action = 'idle', sizeClass = 'h-full w-full', className = '' }: Props) {
  const [pack, setPack] = useState<InstalledShimejiPack | null>(null);
  useEffect(() => {
    let cancelled = false;
    getShimejiPack(avatar.packId).then((p) => { if (!cancelled) setPack(p); });
    return () => { cancelled = true; };
  }, [avatar.packId]);

  const resolved = useMemo(() => {
    if (!pack) return null;
    const character = getShimejiCharacter(pack, avatar.characterId);
    const anim = character.animations[action] ?? character.animations.idle;
    if (!anim) return null;
    return {
      character,
      anim,
      src: resolveShimejiAsset(pack, anim.src),
    };
  }, [action, avatar.characterId, pack]);

  if (!resolved) {
    return <span className={`grid place-items-center rounded-full bg-zinc-100 text-xs text-zinc-400 ${sizeClass} ${className}`}>?</span>;
  }

  const { character, anim, src } = resolved;
  const duration = Math.max(0.1, anim.frames / Math.max(1, anim.fps));
  return (
    <span
      aria-hidden
      className={`block overflow-hidden ${sizeClass} ${className}`}
      style={{
        transform: `scale(${character.scale ?? 1})`,
        transformOrigin: '50% 100%',
      }}
    >
      <span
        className="block h-full w-full"
        style={{
          backgroundImage: `url("${src}")`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: `${anim.frames * 100}% 100%`,
          animation: anim.frames > 1
            ? `shimeji-frames ${duration}s steps(${anim.frames}) ${anim.loop === false ? '1' : 'infinite'}`
            : undefined,
        }}
      />
    </span>
  );
}
