'use client';

import { useEffect, useRef, useState } from 'react';
import { usePlatform } from '@/lib/hooks/use-platform';

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
  edgeMagnetActive?: boolean;
  background?: string;
  expanded?: boolean;
  onGroupDragMove: (id: string, pos: { x: number; y: number }) => void;
  onGroupDragEnd?: (id: string, pos: { x: number; y: number }) => void;
  onGroupTap?: (id: string) => void;
  // Bouncy-drag physics: increments per collision so the hull can shake.
  bumpTick?: number;
  // Current hull rotation in degrees (driven by parent flight integrator
  // + drag-time torque accumulation). Members keep their own orientation.
  rotation?: number;
  // True while the parent's physics is driving this hull's rotation.
  // When false, the hull's transform animates with a CSS transition so
  // settling back to 0 glides smoothly.
  rotationActive?: boolean;
  // Cursor offset (CSS px) from the hull center captured at drag start —
  // used as the rotation transform-origin so the grab pin stays anchored.
  grabPivot?: { x: number; y: number };
  // Fired on pointer-down with the cursor's offset (CSS px) from the hull
  // center, so the parent can derive torque from a flick.
  onDragStartPhysics?: (gid: string, grabOffset: { x: number; y: number }) => void;
};

export default function BuddyGroup({
  groupId, pos, memberCount, stride, avatarSize, padX, padTop, padBottom, anchor,
  visible, magnetActive, edgeMagnetActive, background, expanded, onGroupDragMove, onGroupDragEnd, onGroupTap, bumpTick, rotation, rotationActive, grabPivot, onDragStartPhysics,
}: Props) {
  const adapter = usePlatform();
  const width = (memberCount - 1) * stride + avatarSize + padX * 2;
  const height = avatarSize + padTop + padBottom;

  // No transform / filter / backdrop-filter on this wrapper — those would
  // form a containing block for `position: fixed` descendants. We don't nest
  // members anymore, but keep the wrapper "neutral" anyway. The visual hull
  // (with backdrop blur) is an inner sibling.
  // Native-overlay drag events (vibebud:groupDragStart/...) are only
  // dispatched by OverlayService, which injects window.vibebudNative. The
  // regular Capacitor app (BridgeActivity WebView) gets adapter.id ===
  // 'capacitor-android' too, but no overlay — so it must fall back to the
  // pointer-drag path or the group becomes undraggable in-app.
  const hasNativeOverlay = adapter.id === 'capacitor-android'
    && typeof window !== 'undefined'
    && !!(window as unknown as { vibebudNative?: unknown }).vibebudNative;
  const isCapacitor = hasNativeOverlay;

  const rightCss = anchor.right - padX - (pos.x + (memberCount - 1) * stride);
  const bottomCss = anchor.bottom - padBottom - pos.y;

  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const posRef = useRef(pos);
  useEffect(() => { posRef.current = pos; }, [pos]);
  const draggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [shaking, setShaking] = useState(false);
  useEffect(() => {
    if (!bumpTick) return;
    setShaking(true);
    const t = setTimeout(() => setShaking(false), 420);
    return () => clearTimeout(t);
  }, [bumpTick]);

  // Capacitor drag plumbing — same shape as the per-buddy drag wiring in
  // AvatarInstance. dragBaseRef + callbacksRef must be refs because the
  // parent re-renders on each onGroupDragMove (it does setGroups), and a
  // `let` would be reset every time the listener-binding effect re-ran.
  const dragBaseRef = useRef<{ x: number; y: number } | null>(null);
  const callbacksRef = useRef({ onGroupDragMove, onGroupDragEnd });
  useEffect(() => { callbacksRef.current = { onGroupDragMove, onGroupDragEnd }; });
  useEffect(() => {
    if (!hasNativeOverlay) return;
    if (typeof window === 'undefined') return;
    type Detail = { id?: string; dx?: number; dy?: number };
    const matches = (e: Event) => (e as CustomEvent<Detail>).detail?.id === groupId;
    const dragKey = `group:${groupId}`;
    const onDragStart = (e: Event) => {
      if (!matches(e)) return;
      dragBaseRef.current = { x: posRef.current.x, y: posRef.current.y };
      draggingRef.current = true;
      setIsDragging(true);
      adapter.notifyDragStart(dragKey);
      const dragSet: Set<string> = ((window as unknown as { __vibebudDragging?: Set<string> }).__vibebudDragging
        ||= new Set<string>());
      dragSet.add(dragKey);
      // Notify parent immediately so any "expand peeked group while
      // dragging" / collapse-suppression logic kicks in at gesture start.
      callbacksRef.current.onGroupDragMove(groupId, dragBaseRef.current);
    };
    const onDragMoveEvt = (e: Event) => {
      if (!matches(e) || !draggingRef.current || !dragBaseRef.current) return;
      const detail = (e as CustomEvent<Detail>).detail || {};
      const next = { x: dragBaseRef.current.x + (detail.dx ?? 0), y: dragBaseRef.current.y + (detail.dy ?? 0) };
      callbacksRef.current.onGroupDragMove(groupId, next);
    };
    const onDragEndEvt = (e: Event) => {
      if (!matches(e) || !draggingRef.current) return;
      draggingRef.current = false;
      setIsDragging(false);
      adapter.notifyDragEnd(dragKey);
      const dragSet: Set<string> | undefined = (window as unknown as { __vibebudDragging?: Set<string> }).__vibebudDragging;
      dragSet?.delete(dragKey);
      callbacksRef.current.onGroupDragEnd?.(groupId, posRef.current);
      dragBaseRef.current = null;
    };
    window.addEventListener('vibebud:groupDragStart', onDragStart);
    window.addEventListener('vibebud:groupDragMove', onDragMoveEvt);
    window.addEventListener('vibebud:groupDragEnd', onDragEndEvt);
    return () => {
      window.removeEventListener('vibebud:groupDragStart', onDragStart);
      window.removeEventListener('vibebud:groupDragMove', onDragMoveEvt);
      window.removeEventListener('vibebud:groupDragEnd', onDragEndEvt);
    };
  }, [adapter, groupId]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* noop */ }
    try {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      onDragStartPhysics?.(groupId, {
        x: e.clientX - (r.left + r.width / 2),
        y: e.clientY - (r.top + r.height / 2),
      });
    } catch { /* noop */ }
    const dragSet: Set<string> = ((window as any).__vibebudDragging ||= new Set<string>());
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
      onGroupDragEnd?.(groupId, posRef.current);
      if (onPointerMove) document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', stop);
      document.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
    };
    document.addEventListener('pointerup', stop);
    document.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
  };

  // Touchscreen cluster zone: on mobile builds without the native overlay
  // (in-app Capacitor WebView, web-mobile browsers) there's no equivalent of
  // OverlayService's group cluster window, so a collapsed group's avatars
  // each own their own pointer events and dragging a member just drags that
  // one buddy (and ejects). This div mirrors the native cluster window —
  // sits on top of the avatar cluster, taps expand the group, drags move
  // it. Only shown when collapsed; expanded groups already get the handle
  // strip on desktop and the avatar tap-zones own member taps natively.
  const showClusterZone = !hasNativeOverlay && adapter.isMobile && !expanded;
  const onClusterPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* noop */ }
    try {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      onDragStartPhysics?.(groupId, {
        x: e.clientX - (r.left + r.width / 2),
        y: e.clientY - (r.top + r.height / 2),
      });
    } catch { /* noop */ }
    const startX = e.clientX;
    const startY = e.clientY;
    const startBase = { x: posRef.current.x, y: posRef.current.y };
    let movedFar = false;
    const dragSet: Set<string> = ((window as unknown as { __vibebudDragging?: Set<string> }).__vibebudDragging
      ||= new Set<string>());
    const key = `group:${groupId}`;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!movedFar && Math.hypot(dx, dy) > 8) {
        movedFar = true;
        dragSet.add(key);
        adapter.notifyDragStart(key);
      }
      if (movedFar) {
        onGroupDragMove(groupId, { x: startBase.x + dx, y: startBase.y + dy });
      }
    };
    const stop = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', stop);
      document.removeEventListener('pointercancel', stop);
      if (movedFar) {
        adapter.notifyDragEnd(key);
        dragSet.delete(key);
        onGroupDragEnd?.(groupId, posRef.current);
      } else {
        onGroupTap?.(groupId);
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', stop);
    document.addEventListener('pointercancel', stop);
  };

  return (
    <>
    {showClusterZone && (
      <div
        data-buddy-interactive
        data-group={groupId}
        onPointerDown={onClusterPointerDown}
        className="fixed pointer-events-auto touch-none"
        style={{
          right: anchor.right - (pos.x + (memberCount - 1) * stride),
          bottom: anchor.bottom - pos.y,
          width: (memberCount - 1) * stride + avatarSize,
          height: avatarSize,
          zIndex: 70,
        }}
      />
    )}
    <div
      data-buddy-interactive
      {...(isCapacitor ? {} : { onPointerDown })}
      data-group={groupId}
      title="Drag to move group"
      className={`fixed rounded-full border border-white/50 ${
        isCapacitor ? '' : 'pointer-events-auto cursor-grab active:cursor-grabbing'
      } ${
        visible || magnetActive || edgeMagnetActive ? 'shadow-xl backdrop-blur-md opacity-100' : 'opacity-0 border-transparent'
      } ${magnetActive ? 'ring-4 ring-violet-400/80 shadow-[0_0_36px_8px_rgba(167,139,250,0.55)]' : ''} ${
        edgeMagnetActive && !magnetActive ? 'ring-4 ring-sky-400/80 shadow-[0_0_36px_8px_rgba(56,189,248,0.55)]' : ''
      }`}
      style={{
        right: rightCss,
        bottom: bottomCss,
        width,
        height,
        zIndex: 30,
        background: (visible || magnetActive) ? background : 'transparent',
        // Hull background stays unrotated by request — only the avatars
        // and their composite hands inside members rotate.
        transition: isDragging
          ? 'opacity 180ms ease-out, width 280ms cubic-bezier(0.22, 1, 0.36, 1), background 220ms ease-out'
          : 'opacity 180ms ease-out, ' +
            'width 280ms cubic-bezier(0.22, 1, 0.36, 1), ' +
            'right 280ms cubic-bezier(0.22, 1, 0.36, 1), ' +
            'bottom 280ms cubic-bezier(0.22, 1, 0.36, 1), ' +
            'background 220ms ease-out',
        animation: shaking
          ? 'buddy-shake 420ms ease-out'
          : (magnetActive ? 'buddy-magnet-pulse 1100ms ease-in-out infinite' : undefined),
      }}
    >
      {visible && !isCapacitor && (
        // Functional drag handle on web/desktop. Sits in the hull's empty
        // top-padding strip (above the avatars, which start at padTop=22),
        // and is positioned with z-index ABOVE the buddy avatars (z-50) so
        // pointer-down here always starts a group drag — never an
        // individual buddy drag. The pill is the visual affordance.
        <div
          // data-buddy-interactive is required for Electron click-through:
          // the window only becomes interactive (i.e. accepts pointerdowns)
          // while the cursor is over an element with this attribute. Without
          // it, mouse events pass through the transparent overlay to apps
          // below and the drag never starts.
          data-buddy-interactive
          data-group={groupId}
          onPointerDown={onPointerDown}
          title="Drag to move group"
          className="group/handle pointer-events-auto absolute left-0 right-0 top-0 cursor-grab active:cursor-grabbing"
          style={{ height: padTop, zIndex: 60 }}
        >
          <div
            aria-hidden
            className="absolute left-1/2 -translate-x-1/2 rounded-full bg-zinc-500/80 transition-all group-hover/handle:bg-zinc-700 group-hover/handle:scale-110 dark:bg-zinc-400/80 dark:group-hover/handle:bg-zinc-200"
            style={{ top: 6, width: 56, height: 6 }}
          />
        </div>
      )}
    </div>
    </>
  );
}
