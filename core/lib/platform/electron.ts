import type { ClaudeCodeBridge, CodeAgentDescriptor, InteractiveRect, NotificationPayload, PlatformAdapter } from './types';

type VibebudBridge = {
  setInteractive?: (v: boolean) => void;
  setFocusable?: (v: boolean) => void;
  setBounds?: (b: { width: number; height: number }) => void;
  getCursorPoint?: () => Promise<{ x: number; y: number }>;
  onSpawnBuddy?: (cb: () => void) => () => void;
  showNotification?: (payload: NotificationPayload) => void;
  onOpenSettings?: (cb: () => void) => () => void;
  showPairing?: () => void;
  openExternal?: (url: string) => void;
  claude?: ClaudeCodeBridge;
  codex?: ClaudeCodeBridge;
  codeAgents?: {
    list: () => Promise<CodeAgentDescriptor[]>;
    start: (agentId: string, buddyId: string, opts?: unknown) => Promise<{ ok: boolean; alreadyRunning?: boolean; cwd?: string; artifactPath?: string; error?: string }>;
    send: (agentId: string, buddyId: string, text: string) => Promise<{ ok: boolean; error?: string }>;
    stop: (agentId: string, buddyId: string) => Promise<{ ok: boolean; error?: string }>;
    onEvent: (cb: (agentId: string, buddyId: string, event: unknown) => void) => () => void;
  };
  isElectron?: boolean;
};

const bridge = (): VibebudBridge | undefined => {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { vibebud?: VibebudBridge }).vibebud;
};

export class ElectronAdapter implements PlatformAdapter {
  readonly id = 'electron' as const;
  readonly isMobile = false;
  readonly isNative = true;

  publishInteractiveRects(_rects: InteractiveRect[]): void { /* noop — Electron uses click-through, not regions */ }
  publishAvatarRects(_rects: { id: string; x: number; y: number; w: number; h: number }[]): void { /* noop */ }
  publishGroupRects(_rects: { id: string; x: number; y: number; w: number; h: number }[]): void { /* noop */ }
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

  openExternal(url: string): void {
    bridge()?.openExternal?.(url);
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

  showNotification(payload: NotificationPayload): void {
    bridge()?.showNotification?.(payload);
  }

  async requestNotificationPermission(): Promise<boolean> {
    // Electron's Notification ctor requires no runtime grant on Windows; macOS
    // surfaces a one-time system prompt automatically the first time .show()
    // is called. We always report granted.
    return true;
  }

  hasNotificationPermission(): boolean { return true; }

  claudeCode(): ClaudeCodeBridge | null {
    return bridge()?.claude ?? null;
  }

  codexCode(): ClaudeCodeBridge | null {
    return bridge()?.codex ?? null;
  }

  async codeAgents(): Promise<CodeAgentDescriptor[]> {
    const list = bridge()?.codeAgents?.list;
    return list ? list() : [];
  }

  codeAgent(id: string): ClaudeCodeBridge | null {
    const b = bridge()?.codeAgents;
    if (!b) return null;
    return {
      start: (buddyId, opts) => b.start(id, buddyId, opts),
      send: (buddyId, text) => b.send(id, buddyId, text),
      stop: (buddyId) => b.stop(id, buddyId),
      list: async () => [],
      onEvent: (cb) => b.onEvent((agentId, buddyId, event) => {
        if (agentId === id) cb(buddyId, event as Parameters<typeof cb>[1]);
      }),
    };
  }

  showPairingWindow(): void {
    bridge()?.showPairing?.();
  }

  onOpenSettings(cb: () => void): () => void {
    const off = bridge()?.onOpenSettings?.(cb);
    return typeof off === 'function' ? off : () => {};
  }
}
