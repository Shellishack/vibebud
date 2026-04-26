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
  notifyDragStart(buddyId: string): void;
  notifyDragEnd(buddyId: string): void;

  // Capacitor-only: tells the native overlay window to grow to full-screen
  // (true) or shrink back to its idle bottom-right footprint (false). On other
  // platforms this is a noop.
  setOverlayExpanded(expanded: boolean): void;

  getCursorPoint(): Promise<{ x: number; y: number }> | null;

  setFocusable(focusable: boolean): void;

  onSpawnRequest(cb: () => void): () => void;
}

export interface LayoutAdapter {
  readonly chatPanelMode: 'anchored' | 'sheet';
  readonly toastMode: 'anchored' | 'sheet';
  readonly tapTargetSize: 'compact' | 'comfortable';
  readonly anchorPadding: number;
  readonly avatarSize: number;
}
