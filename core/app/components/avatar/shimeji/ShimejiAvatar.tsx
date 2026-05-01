'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  getShimejiCharacter,
  getShimejiPack,
  resolveShimejiAsset,
} from '@/lib/avatar/shimeji';
import type { InstalledShimejiPack, ShimejiAction, ShimejiAvatar } from '@/lib/avatar/types';

type Props = {
  avatar: ShimejiAvatar;
  action?: ShimejiAction;
  direction?: -1 | 1;
  sizeClass?: string;
  className?: string;
};

export default function ShimejiAvatarView({ avatar, action = 'idle', direction = -1, sizeClass = 'h-full w-full', className = '' }: Props) {
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
  const scale = character.scale ?? 1;
  const duration = Math.max(0.1, anim.frames / Math.max(1, anim.fps));
  const frameStyle = {
    '--shimeji-frames': anim.frames,
    width: `${anim.frames * 100}%`,
    height: '100%',
    maxWidth: 'none',
    animation: anim.frames > 1
      ? `shimeji-sheet ${duration}s steps(${Math.max(1, anim.frames - 1)}, end) ${anim.loop === false ? '1' : 'infinite'}`
      : undefined,
  } as CSSProperties;
  return (
    <span
      aria-hidden
      className={`block overflow-hidden ${sizeClass} ${className}`}
      style={{
        transform: `scale(${direction === 1 ? -scale : scale}, ${scale})`,
        transformOrigin: '50% 100%',
      }}
    >
      <img src={src} alt="" draggable={false} className="block select-none" style={frameStyle} />
    </span>
  );
}
