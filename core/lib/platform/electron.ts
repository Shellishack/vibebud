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
  notifyDragStart(_id: string): void { /* noop */ }
  notifyDragEnd(_id: string): void { /* noop */ }

  getCursorPoint(): Promise<{ x: number; y: number }> | null {
    const b = bridge();
    return b?.getCursorPoint ? b.getCursorPoint() : null;
  }

  setFocusable(focusable: boolean): void {
    bridge()?.setFocusable?.(focusable);
  }

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
