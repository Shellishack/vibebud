'use client';

import { useEffect, useRef } from 'react';
import { usePlatform } from './hooks/usePlatform';

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
  background?: string;
  onGroupDragMove: (id: string, pos: { x: number; y: number }) => void;
};

export default function BuddyGroup({
  groupId, pos, memberCount, stride, avatarSize, padX, padTop, padBottom, anchor,
  visible, magnetActive, background, onGroupDragMove,
}: Props) {
  const adapter = usePlatform();
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
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* noop */ }
    const dragSet: Set<string> = ((window as any).__vibemojiDragging ||= new Set<string>());
    const key = `group:${groupId}`;
    dragSet.add(key);
    adapter.notifyDragStart(key);

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

    const cursorPromise = adapter.getCursorPoint();
    if (cursorPromise) {
      cursorPromise.then((origin) => {
        if (cancelled) return;
        dragRef.current = {
          startX: origin.x, startY: origin.y,
          baseX: posRef.current.x, baseY: posRef.current.y,
        };
        const tick = () => {
          if (!dragRef.current) return;
          const p = adapter.getCursorPoint();
          if (!p) return;
          p.then((pt) => {
            if (!dragRef.current) return;
            apply(pt.x - dragRef.current.startX, pt.y - dragRef.current.startY);
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
      adapter.notifyDragEnd(key);
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
      className={`pointer-events-auto fixed cursor-grab rounded-full border border-white/50 active:cursor-grabbing ${
        visible || magnetActive ? 'shadow-xl backdrop-blur-md opacity-100' : 'opacity-0 border-transparent'
      } ${magnetActive ? 'ring-4 ring-violet-400/80 shadow-[0_0_36px_8px_rgba(167,139,250,0.55)]' : ''}`}
      style={{
        right: rightCss,
        bottom: bottomCss,
        width,
        height,
        zIndex: 30,
        background: (visible || magnetActive) ? background : 'transparent',
        transition:
          'opacity 180ms ease-out, ' +
          'width 280ms cubic-bezier(0.22, 1, 0.36, 1), ' +
          'right 280ms cubic-bezier(0.22, 1, 0.36, 1), ' +
          'bottom 280ms cubic-bezier(0.22, 1, 0.36, 1), ' +
          'background 220ms ease-out',
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
