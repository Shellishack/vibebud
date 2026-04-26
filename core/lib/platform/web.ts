import type { InteractiveRect, PlatformAdapter, PlatformId } from './types';

export class WebAdapter implements PlatformAdapter {
  readonly id: PlatformId;
  readonly isMobile: boolean;
  readonly isNative = false;

  constructor(id: PlatformId = 'web') {
    this.id = id;
    this.isMobile = id === 'web-mobile';
  }

  publishInteractiveRects(_rects: InteractiveRect[]): void { /* noop */ }
  notifyDragStart(_id: string): void { /* noop */ }
  notifyDragEnd(_id: string): void { /* noop */ }

  getCursorPoint(): Promise<{ x: number; y: number }> | null { return null; }

  setFocusable(_focusable: boolean): void { /* noop */ }

  onSpawnRequest(_cb: () => void): () => void { return () => {}; }
}
