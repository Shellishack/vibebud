'use client';

import { useEffect, useRef, type ReactNode } from 'react';

type Props = {
  groupId: string;
  pos: { x: number; y: number };
  memberCount: number;
  stride: number;
  avatarSize: number;
  pad: number;
  anchor: { right: number; bottom: number };
  onExpandChange: (id: string, expanded: boolean) => void;
  onGroupDragMove: (id: string, pos: { x: number; y: number }) => void;
  children: ReactNode;
};

export default function BuddyGroup({
  groupId, pos, memberCount, stride, avatarSize, pad, anchor,
  onExpandChange, onGroupDragMove, children,
}: Props) {
  const width = (memberCount - 1) * stride + avatarSize + pad * 2;
  const height = avatarSize + pad * 2;

  // No transform / filter / backdrop-filter on this wrapper — those would
  // turn it into a containing block for any `position: fixed` descendants
  // (the BuddyInstance members), breaking their viewport-anchored layout.
  // The visual hull lives on an inner sibling div.
  const rightCss = anchor.right - pad - (pos.x + (memberCount - 1) * stride);
  const bottomCss = anchor.bottom - pad - pos.y;

  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const posRef = useRef(pos);
  useEffect(() => { posRef.current = pos; }, [pos]);

  const onEnter = () => {
    if (leaveTimerRef.current) { clearTimeout(leaveTimerRef.current); leaveTimerRef.current = null; }
    onExpandChange(groupId, true);
  };
  const onLeave = () => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = setTimeout(() => {
      const dragging: Set<string> | undefined = (window as any).__vibemojiDragging;
      if (dragging && dragging.size > 0) {
        leaveTimerRef.current = setTimeout(() => onExpandChange(groupId, false), 350);
        return;
      }
      onExpandChange(groupId, false);
    }, 250);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-buddy-member]')) return;
    e.preventDefault();
    const v = (window as any).vibemoji;
    if (!v?.getCursorPoint) return;
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* noop */ }
    const dragSet: Set<string> = ((window as any).__vibemojiDragging ||= new Set<string>());
    const key = `group:${groupId}`;
    dragSet.add(key);

    let raf = 0;
    let cancelled = false;
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
          const next = {
            x: dragRef.current.baseX + (p.x - dragRef.current.startX),
            y: dragRef.current.baseY + (p.y - dragRef.current.startY),
          };
          onGroupDragMove(groupId, next);
          raf = requestAnimationFrame(tick);
        });
      };
      raf = requestAnimationFrame(tick);
    });

    const stop = () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      dragRef.current = null;
      dragSet.delete(key);
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
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onPointerDown={onPointerDown}
      className="pointer-events-auto fixed cursor-grab active:cursor-grabbing"
      style={{
        right: rightCss,
        bottom: bottomCss,
        width,
        height,
        zIndex: 40,
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 rounded-[28px] border border-zinc-200 bg-white/60 shadow-xl backdrop-blur-md dark:border-zinc-700 dark:bg-zinc-900/60"
      />
      {children}
    </div>
  );
}
