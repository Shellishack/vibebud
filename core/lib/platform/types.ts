export type PlatformId = 'web' | 'web-mobile' | 'electron' | 'capacitor-android';

export interface InteractiveRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlatformAdapter {
  readonly id: PlatformId;
  readonly isMobile: boolean;
  readonly isNative: boolean;

  publishInteractiveRects(rects: InteractiveRect[]): void;

  // Capacitor-only: publishes the bounding box of each avatar in device
  // pixels, keyed by buddy id, so native can maintain one tap-zone window
  // per avatar and forward the tapped buddy's id to JS. Pass [] to hide all.
  publishAvatarRects(rects: { id: string; x: number; y: number; w: number; h: number }[]): void;

  // Capacitor-only: per-group hull bounding box (device pixels). Native uses
  // these to maintain a transparent tap-zone window per visible group hull
  // so the user can drag the whole group on touch. Pass [] to hide all.
  publishGroupRects(rects: { id: string; x: number; y: number; w: number; h: number }[]): void;
  notifyDragStart(buddyId: string): void;
  notifyDragEnd(buddyId: string): void;

  // Capacitor-only: tells the native overlay window to grow to full-screen
  // (true) or shrink back to its idle bottom-right footprint (false). On other
  // platforms this is a noop.
  setOverlayExpanded(expanded: boolean): void;

  // Capacitor-only: makes the WebView touchable on empty areas (so outside-tap
  // dismissal works for an expanded/peeked group) WITHOUT disabling avatar or
  // group tap-zones. Different from setOverlayExpanded, which turns off
  // tap-zones for popup mode. No-op elsewhere.
  setOverlaySpilledOut?(spilled: boolean): void;

  getCursorPoint(): Promise<{ x: number; y: number }> | null;

  setFocusable(focusable: boolean): void;

  onSpawnRequest(cb: () => void): () => void;

  // Capacitor-only: fires when the user taps outside the published touchable
  // region (i.e. the touch routed to the background app). Used to dismiss
  // open popups since the WebView never sees those touches directly.
  onOutsideTap(cb: () => void): () => void;

  // Capacitor-only failsafe: tears down the floating overlay service. Wired
  // to a "Close overlay" button so a misbehaving touch-region setup can't
  // brick the device. No-op on other platforms.
  stopOverlay(): void;

  // Routes a "ping" to the OS-native notification channel. On Electron this
  // hits Windows Action Center / macOS Notification Center via Electron's
  // built-in Notification API; on Capacitor it posts an Android system
  // notification; on Web it uses the browser Notification API (if granted).
  // Caller is responsible for deciding whether to use this vs an in-app toast.
  showNotification(payload: NotificationPayload): void;

  // Asks the host for permission to post system notifications. Resolves with
  // whether permission is currently granted. On Electron this is a no-op
  // (always granted); on Web triggers Notification.requestPermission(); on
  // Android opens the system permission dialog (Android 13+).
  requestNotificationPermission(): Promise<boolean>;
}

export type NotificationPayload = {
  title: string;
  body: string;
  tone?: 'info' | 'action' | 'success';
};

export interface LayoutAdapter {
  readonly chatPanelMode: 'anchored' | 'sheet';
  readonly toastMode: 'anchored' | 'sheet';
  readonly tapTargetSize: 'compact' | 'comfortable';
  readonly anchorPadding: number;
  readonly avatarSize: number;
}
