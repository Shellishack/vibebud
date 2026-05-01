import type { ClaudeCodeBridge, CodeAgentDescriptor, InteractiveRect, NotificationPayload, PlatformAdapter, PlatformId } from './types';
import { getRemoteClaudeBridge, getRemoteCodexBridge } from './remoteClaude';

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

  showNotification(payload: NotificationPayload): void {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    try { new Notification(payload.title, { body: payload.body }); } catch { /* noop */ }
  }

  async requestNotificationPermission(): Promise<boolean> {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    try {
      const r = await Notification.requestPermission();
      return r === 'granted';
    } catch { return false; }
  }

  hasNotificationPermission(): boolean {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return false;
    return Notification.permission === 'granted';
  }

  // Web can't spawn local processes. Falls back to the remote WS bridge
  // (desktop/claude-bridge-server.js) when the user has configured one in
  // localStorage; otherwise the UI hides the Claude Code toggle.
  claudeCode(): ClaudeCodeBridge | null { return getRemoteClaudeBridge(); }
  codexCode(): ClaudeCodeBridge | null { return getRemoteCodexBridge(); }
  async codeAgents(): Promise<CodeAgentDescriptor[]> { return []; }
  codeAgent(_id: string): ClaudeCodeBridge | null { return null; }
}
