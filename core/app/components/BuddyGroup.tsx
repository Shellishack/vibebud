'use client';

import { useEffect, useRef } from 'react';

type Props = {
  groupId: string;
  pos: { x: number; y: number };
  memberCount: number;
  stride: number;
  avatarSize: number;
  padX: number;
  padTop: number;
  padBottom: number;
  anchor: { right: number; bottom: number };
  visible: boolean;
  magnetActive?: boolean;
  onGroupDragMove: (id: string, pos: { x: number; y: number }) => void;
};

export default function BuddyGroup({
  groupId, pos, memberCount, stride, avatarSize, padX, padTop, padBottom, anchor,
  visible, magnetActive, onGroupDragMove,
}: Props) {
  const width = (memberCount - 1) * stride + avatarSize + padX * 2;
  const height = avatarSize + padTop + padBottom;

  // No transform / filter / backdrop-filter on this wrapper — those would
  // form a containing block for `position: fixed` descendants. We don't nest
  // members anymore, but keep the wrapper "neutral" anyway. The visual hull
  // (with backdrop blur) is an inner sibling.
  const rightCss = anchor.right - padX - (pos.x + (memberCount - 1) * stride);
  const bottomCss = anchor.bottom - padBottom - pos.y;

  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const posRef = useRef(pos);
  useEffect(() => { posRef.current = pos; }, [pos]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const v = (window as any).vibemoji;
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* noop */ }
    const dragSet: Set<string> = ((window as any).__vibemojiDragging ||= new Set<string>());
    const key = `group:${groupId}`;
    dragSet.add(key);

    let raf = 0;
    let cancelled = false;
    let onPointerMove: ((ev: PointerEvent) => void) | null = null;

    const apply = (dx: number, dy: number) => {
      if (!dragRef.current) return;
      onGroupDragMove(groupId, {
        x: dragRef.current.baseX + dx,
        y: dragRef.current.baseY + dy,
      });
    };

    if (v?.getCursorPoint) {
      v.getCursorPoint().then((origin: { x: number; y: number }) => {
        if (cancelled) return;
        dragRef.current = {
          startX: origin.x, startY: origin.y,
          baseX: posRef.current.x, baseY: posRef.current.y,
        };
        const tick = () => {
          if (!dragRef.current) return;
          v.getCursorPoint().then((p: { x: number; y: number }) => {
            if (!dragRef.current) return;
            apply(p.x - dragRef.current.startX, p.y - dragRef.current.startY);
            raf = requestAnimationFrame(tick);
          });
        };
        raf = requestAnimationFrame(tick);
      });
    } else {
      dragRef.current = {
        startX: e.clientX, startY: e.clientY,
        baseX: posRef.current.x, baseY: posRef.current.y,
      };
      onPointerMove = (ev: PointerEvent) => {
        if (!dragRef.current) return;
        apply(ev.clientX - dragRef.current.startX, ev.clientY - dragRef.current.startY);
      };
      document.addEventListener('pointermove', onPointerMove);
    }

    const stop = () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      dragRef.current = null;
      dragSet.delete(key);
      if (onPointerMove) document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', stop);
      document.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
    };
    document.addEventListener('pointerup', stop);
    document.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
  };

  return (
    <div
      data-buddy-interactive
      data-group={groupId}
      onPointerDown={onPointerDown}
      title="Drag to move group"
      className={`pointer-events-auto fixed cursor-grab rounded-full border active:cursor-grabbing transition-opacity duration-150 ${
        visible || magnetActive
          ? 'border-zinc-200 bg-white/55 shadow-xl backdrop-blur-md opacity-100 dark:border-zinc-700 dark:bg-zinc-900/55'
          : 'border-transparent bg-transparent opacity-0'
      } ${magnetActive ? 'ring-4 ring-violet-400/80 shadow-[0_0_36px_8px_rgba(167,139,250,0.55)]' : ''}`}
      style={{
        right: rightCss,
        bottom: bottomCss,
        width,
        height,
        zIndex: 30,
        animation: magnetActive ? 'buddy-magnet-pulse 1100ms ease-in-out infinite' : undefined,
      }}
    >
      {visible && (
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 -translate-x-1/2"
          style={{ top: 8, width: 40, height: 4 }}
        >
          <div className="h-full w-full rounded-full bg-zinc-400/70 dark:bg-zinc-500/70" />
        </div>
      )}
    </div>
  );
}
