import type { InteractiveRect, PlatformAdapter } from './types';

type VibemojiBridge = {
  setInteractive?: (v: boolean) => void;
  setFocusable?: (v: boolean) => void;
  setBounds?: (b: { width: number; height: number }) => void;
  getCursorPoint?: () => Promise<{ x: number; y: number }>;
  onSpawnBuddy?: (cb: () => void) => () => void;
  isElectron?: boolean;
};

const bridge = (): VibemojiBridge | undefined => {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { vibemoji?: VibemojiBridge }).vibemoji;
};

export class ElectronAdapter implements PlatformAdapter {
  readonly id = 'electron' as const;
  readonly isMobile = false;
  readonly isNative = true;

  publishInteractiveRects(_rects: InteractiveRect[]): void { /* noop — Electron uses click-through, not regions */ }
  publishAvatarRects(_rects: { id: string; x: number; y: number; w: number; h: number }[]): void { /* noop */ }
  notifyDragStart(_id: string): void { /* noop */ }
  notifyDragEnd(_id: string): void { /* noop */ }
  setOverlayExpanded(_expanded: boolean): void { /* noop — Electron uses click-through */ }

  getCursorPoint(): Promise<{ x: number; y: number }> | null {
    const b = bridge();
    return b?.getCursorPoint ? b.getCursorPoint() : null;
  }

  setFocusable(focusable: boolean): void {
    bridge()?.setFocusable?.(focusable);
  }

  onOutsideTap(_cb: () => void): () => void { return () => {}; }
  stopOverlay(): void { /* noop */ }

  onSpawnRequest(cb: () => void): () => void {
    const off = bridge()?.onSpawnBuddy?.(cb);
    return typeof off === 'function' ? off : () => {};
  }

  // Electron-specific: keeps the click-through window in sync with cursor hovering.
  // Buddy.tsx still calls this directly via the bridge — exposed here for symmetry.
  setInteractive(interactive: boolean): void {
    bridge()?.setInteractive?.(interactive);
  }
}
