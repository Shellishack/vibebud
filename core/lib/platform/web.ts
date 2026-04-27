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
  publishAvatarRects(_rects: { id: string; x: number; y: number; w: number; h: number }[]): void { /* noop */ }
  publishGroupRects(_rects: { id: string; x: number; y: number; w: number; h: number }[]): void { /* noop */ }
  notifyDragStart(_id: string): void { /* noop */ }
  notifyDragEnd(_id: string): void { /* noop */ }
  setOverlayExpanded(_expanded: boolean): void { /* noop */ }

  getCursorPoint(): Promise<{ x: number; y: number }> | null { return null; }

  setFocusable(_focusable: boolean): void { /* noop */ }

  onSpawnRequest(_cb: () => void): () => void { return () => {}; }
  onOutsideTap(_cb: () => void): () => void { return () => {}; }
  stopOverlay(): void { /* noop */ }
}
