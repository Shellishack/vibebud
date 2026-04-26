import type { InteractiveRect, PlatformAdapter } from './types';

type VibemojiNative = {
  setTouchableRegion?: (json: string) => void;
  setInteractive?: (v: boolean) => void;
  setExpanded?: (v: boolean) => void;
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

  notifyDragStart(id: string): void {
    // Native side flips its own nativeDragActive flag on ACTION_DOWN; we
    // don't bridge anything here. The point is to STOP publishing region
    // updates so the WebView's gesture state isn't disturbed by repeated
    // requestLayout calls during the drag.
    this.dragHolders.add(id);
  }

  notifyDragEnd(id: string): void {
    this.dragHolders.delete(id);
    if (this.dragHolders.size === 0) this.flush();
  }

  private flush(): void {
    const json = JSON.stringify(this.pendingRects);
    if (json === this.lastPushedJson) return;
    this.lastPushedJson = json;
    try { native()?.setTouchableRegion?.(json); } catch { /* noop */ }
  }

  setOverlayExpanded(expanded: boolean): void {
    try { native()?.setExpanded?.(expanded); } catch { /* noop */ }
  }

  getCursorPoint(): Promise<{ x: number; y: number }> | null { return null; }

  setFocusable(_focusable: boolean): void { /* noop — Capacitor activity handles focus itself */ }

  onSpawnRequest(_cb: () => void): () => void { return () => {}; }
}
