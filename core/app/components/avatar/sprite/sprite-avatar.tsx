'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { getSpritePack, resolveSpriteAsset } from '@/lib/avatar/sprite';
import type { InstalledSpritePack, SpriteAction, SpriteAvatar } from '@/lib/avatar/types';

type Props = {
  avatar: SpriteAvatar;
  action?: SpriteAction;
  direction?: -1 | 1;
  sizeClass?: string;
  className?: string;
};

export default function SpriteAvatarView({ avatar, action = 'idle', direction = -1, sizeClass = 'h-full w-full', className = '' }: Props) {
  const [pack, setPack] = useState<InstalledSpritePack | null>(null);
  useEffect(() => {
    let cancelled = false;
    getSpritePack(avatar.packId).then((p) => { if (!cancelled) setPack(p); });
    return () => { cancelled = true; };
  }, [avatar.packId]);

  const resolved = useMemo(() => {
    if (!pack) return null;
    const anim = pack.manifest.animations[action] ?? pack.manifest.animations.idle;
    if (!anim) return null;
    return { anim, src: resolveSpriteAsset(pack, anim.src), scale: pack.manifest.scale ?? 1 };
  }, [action, pack]);

  if (!resolved) {
    return <span className={`grid place-items-center rounded-full bg-zinc-100 text-xs text-zinc-400 ${sizeClass} ${className}`}>?</span>;
  }

  const duration = Math.max(0.1, resolved.anim.frames / Math.max(1, resolved.anim.fps));
  const frameStyle = {
    '--shimeji-frames': resolved.anim.frames,
    width: `${resolved.anim.frames * 100}%`,
    height: '100%',
    maxWidth: 'none',
    animation: resolved.anim.frames > 1
      ? `shimeji-sheet ${duration}s steps(${Math.max(1, resolved.anim.frames - 1)}, end) ${resolved.anim.loop === false ? '1' : 'infinite'}`
      : undefined,
  } as CSSProperties;

  return (
    <span
      aria-hidden
      className={`block overflow-hidden ${sizeClass} ${className}`}
      style={{
        transform: `scale(${direction === 1 ? -resolved.scale : resolved.scale}, ${resolved.scale})`,
        transformOrigin: '50% 100%',
      }}
    >
      <img src={resolved.src} alt="" draggable={false} className="block select-none" style={frameStyle} />
    </span>
  );
}
