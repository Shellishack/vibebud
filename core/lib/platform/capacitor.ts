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

// Capacitor LocalNotifications plugin — only present in the BridgeActivity
// WebView (MainActivity), where Capacitor injects `Capacitor.Plugins.*`.
// In the overlay's hand-rolled WebView this is undefined and we fall back
// to the vibemojiNative bridge.
type LocalNotificationsPlugin = {
  checkPermissions: () => Promise<{ display: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' }>;
  requestPermissions: () => Promise<{ display: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' }>;
  schedule: (opts: { notifications: { id: number; title: string; body: string }[] }) => Promise<unknown>;
};
type CapacitorRuntime = {
  isNativePlatform?: () => boolean;
  Plugins?: { LocalNotifications?: LocalNotificationsPlugin };
};
const localNotifications = (): LocalNotificationsPlugin | undefined => {
  if (typeof window === 'undefined') return undefined;
  const cap = (window as unknown as { Capacitor?: CapacitorRuntime }).Capacitor;
  return cap?.Plugins?.LocalNotifications;
};

let lastPluginPerm = false;

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
    // Prefer the Capacitor LocalNotifications plugin when available — that's
    // the supported path inside the MainActivity (BridgeActivity) WebView,
    // and it correctly handles channels + Android 14+ delivery rules. The
    // overlay's hand-rolled WebView falls back to vibemojiNative.
    const ln = localNotifications();
    if (ln) {
      try {
        void ln.schedule({ notifications: [{
          id: Math.floor(Math.random() * 2_147_483_647),
          title: payload.title,
          body: payload.body,
        }]});
        return;
      } catch { /* fall through */ }
    }
    try { native()?.showNotification?.(JSON.stringify(payload)); } catch { /* noop */ }
  }

  async requestNotificationPermission(): Promise<boolean> {
    // Capacitor plugin path — used inside MainActivity. The plugin properly
    // surfaces the Android-13+ runtime permission dialog and handles all the
    // OEM edge cases for us. We only fall back to the overlay native bridge
    // when the plugin isn't loaded (i.e. inside the overlay WebView).
    const ln = localNotifications();
    if (ln) {
      try {
        const cur = await ln.checkPermissions();
        if (cur?.display === 'granted') return true;
        const next = await ln.requestPermissions();
        return next?.display === 'granted';
      } catch { return false; }
    }

    const n = native();
    if (!n) return false;
    try {
      const cur = n.hasNotificationPermission?.();
      if (cur === 'granted') return true;
    } catch { /* noop */ }
    try { n.requestNotificationPermission?.(); } catch { /* noop */ }
    return new Promise((resolve) => {
      const start = Date.now();
      let settled = false;
      const finish = (v: boolean) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('focus', onVisible);
        resolve(v);
      };
      const check = (): boolean | null => {
        try {
          const v = n.hasNotificationPermission?.();
          if (v === 'granted') return true;
          if (v === 'denied') return false;
        } catch { /* noop */ }
        return null;
      };
      const onVisible = () => {
        if (document.visibilityState !== 'visible') return;
        const r = check();
        if (r === true) finish(true);
      };
      const tick = () => {
        if (settled) return;
        const r = check();
        if (r === true) return finish(true);
        if (r === false && Date.now() - start > 5_000) return finish(false);
        if (Date.now() - start > 120_000) return finish(false);
        setTimeout(tick, 500);
      };
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('focus', onVisible);
      setTimeout(tick, 500);
    });
  }

  hasNotificationPermission(): boolean {
    // Synchronous answer. Cache last known plugin result, refresh in the
    // background — required because `LocalNotifications.checkPermissions` is
    // async but callers (status badges) need a value right now.
    const ln = localNotifications();
    if (ln) {
      void ln.checkPermissions().then((r) => { lastPluginPerm = r?.display === 'granted'; }).catch(() => {});
      return lastPluginPerm;
    }
    try { return native()?.hasNotificationPermission?.() === 'granted'; }
    catch { return false; }
  }

  onOutsideTap(cb: () => void): () => void {
    if (typeof window === 'undefined') return () => {};
    const handler = () => cb();
    window.addEventListener('vibemoji:outsideTap', handler);
    return () => window.removeEventListener('vibemoji:outsideTap', handler);
  }
}
