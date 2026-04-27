import type { InteractiveRect, NotificationPayload, PlatformAdapter } from './types';

type VibemojiNative = {
  setTouchableRegion?: (json: string) => void;
  setInteractive?: (v: boolean) => void;
  setSpilledOut?: (v: boolean) => void;
  setExpanded?: (v: boolean) => void;
  stopOverlay?: () => void;
  setAvatarRects?: (json: string) => void;
  setGroupRects?: (json: string) => void;
  showNotification?: (json: string) => void;
  requestNotificationPermission?: () => void;
  hasNotificationPermission?: () => string;
};

const native = (): VibemojiNative | undefined => {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { vibemojiNative?: VibemojiNative }).vibemojiNative;
};

export class CapacitorAdapter implements PlatformAdapter {
  readonly id = 'capacitor-android' as const;
  readonly isMobile = true;
  readonly isNative = true;

  private dragHolders = new Set<string>();
  private pendingRects: InteractiveRect[] = [];
  private lastPushedJson = '';

  publishInteractiveRects(rects: InteractiveRect[]): void {
    this.pendingRects = rects;
    if (this.dragHolders.size === 0) this.flush();
  }

  private lastAvatarJson = '';
  private pendingAvatarRects: { id: string; x: number; y: number; w: number; h: number }[] | null = null;
  publishAvatarRects(rects: { id: string; x: number; y: number; w: number; h: number }[]): void {
    this.pendingAvatarRects = rects;
    if (this.dragHolders.size === 0) this.flushAvatar();
  }
  private flushAvatar(): void {
    if (this.pendingAvatarRects === null) return;
    const json = JSON.stringify(this.pendingAvatarRects);
    this.pendingAvatarRects = null;
    if (json === this.lastAvatarJson) return;
    this.lastAvatarJson = json;
    try { native()?.setAvatarRects?.(json); } catch { /* noop */ }
  }

  private lastGroupJson = '';
  private pendingGroupRects: { id: string; x: number; y: number; w: number; h: number }[] | null = null;
  publishGroupRects(rects: { id: string; x: number; y: number; w: number; h: number }[]): void {
    this.pendingGroupRects = rects;
    if (this.dragHolders.size === 0) this.flushGroup();
  }
  private flushGroup(): void {
    if (this.pendingGroupRects === null) return;
    const json = JSON.stringify(this.pendingGroupRects);
    this.pendingGroupRects = null;
    if (json === this.lastGroupJson) return;
    this.lastGroupJson = json;
    try { native()?.setGroupRects?.(json); } catch { /* noop */ }
  }

  notifyDragStart(id: string): void {
    // Native side flips its own nativeDragActive flag on ACTION_DOWN; we
    // don't bridge anything here. The point is to STOP publishing region
    // updates so the WebView's gesture state isn't disturbed by repeated
    // requestLayout calls during the drag.
    this.dragHolders.add(id);
  }

  notifyDragEnd(id: string): void {
    this.dragHolders.delete(id);
    if (this.dragHolders.size === 0) {
      this.flush();
      this.flushAvatar();
      this.flushGroup();
    }
  }

  private flush(): void {
    const json = JSON.stringify(this.pendingRects);
    if (json === this.lastPushedJson) return;
    this.lastPushedJson = json;
    try { native()?.setTouchableRegion?.(json); } catch { /* noop */ }
  }

  setOverlayExpanded(expanded: boolean): void {
    // Drives the main overlay window between passthrough (default) and fully
    // interactive modes. The native bridge also flips the avatar tap-zone in
    // the opposite direction so popup hits over the avatar's visual area
    // aren't swallowed by the tap-zone window.
    try { native()?.setInteractive?.(expanded); } catch { /* noop */ }
    try { native()?.setExpanded?.(expanded); } catch { /* noop */ }
  }

  setOverlaySpilledOut(spilled: boolean): void {
    // Group spillout: WebView accepts touches in empty areas (so
    // tap-outside-to-dismiss works), but avatar/group tap-zones stay
    // touchable so member drag/tap continue going through the dedicated
    // native gesture path instead of through React pointer events on a
    // fullscreen transparent WebView.
    try { native()?.setSpilledOut?.(spilled); } catch { /* noop */ }
  }

  getCursorPoint(): Promise<{ x: number; y: number }> | null { return null; }

  setFocusable(_focusable: boolean): void {
    // Intentionally a no-op for now. Toggling FLAG_NOT_FOCUSABLE on the live
    // overlay window via updateViewLayout disrupts the WebView's touch state
    // (buttons stop firing). The soft keyboard / IME path needs a different
    // approach — likely a fresh focusable child window for inputs only.
  }

  onSpawnRequest(_cb: () => void): () => void { return () => {}; }

  stopOverlay(): void {
    try { native()?.stopOverlay?.(); } catch { /* noop */ }
  }

  showNotification(payload: NotificationPayload): void {
    try { native()?.showNotification?.(JSON.stringify(payload)); } catch { /* noop */ }
  }

  async requestNotificationPermission(): Promise<boolean> {
    const n = native();
    if (!n) return false;
    try {
      // Best-effort: if native exposes a synchronous query, use it; otherwise
      // just trigger the request and assume the user will handle the dialog.
      if (typeof n.hasNotificationPermission === 'function') {
        const cur = n.hasNotificationPermission();
        if (cur === 'granted') return true;
      }
      n.requestNotificationPermission?.();
    } catch { /* noop */ }
    // Re-query after a short delay so the caller gets a useful boolean once
    // the dialog returns. Android dispatches the result asynchronously.
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        try {
          const v = n.hasNotificationPermission?.();
          if (v === 'granted') return resolve(true);
          if (v === 'denied') return resolve(false);
        } catch { /* noop */ }
        if (Date.now() - start > 30_000) return resolve(false);
        setTimeout(tick, 500);
      };
      setTimeout(tick, 500);
    });
  }

  onOutsideTap(cb: () => void): () => void {
    if (typeof window === 'undefined') return () => {};
    const handler = () => cb();
    window.addEventListener('vibemoji:outsideTap', handler);
    return () => window.removeEventListener('vibemoji:outsideTap', handler);
  }
}
