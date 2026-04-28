// ClaudeCodeBridge implementation that talks to the desktop bridge server
// (desktop/claude-bridge-server.js) over WebSocket. Lets Capacitor and web
// clients drive a `claude` subprocess running on the user's PC, since
// neither environment can spawn local processes itself.
//
// Config lives in localStorage under `vibemoji.claudeRemote.v1` as
// `{"url":"ws://host:port","token":"..."}`. When absent, the adapter returns
// `null` from claudeCode() and the UI hides the Claude Code toggle.
import type { ClaudeCodeBridge, ClaudeEvent, ClaudeStartOpts } from './types';

export type RemoteClaudeConfig = { url: string; token: string };

const STORAGE_KEY = 'vibemoji.claudeRemote.v1';

export function getRemoteClaudeConfig(): RemoteClaudeConfig | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.url || !parsed?.token) return null;
    return { url: String(parsed.url), token: String(parsed.token) };
  } catch { return null; }
}

export function setRemoteClaudeConfig(cfg: RemoteClaudeConfig | null): void {
  if (typeof localStorage === 'undefined') return;
  if (cfg) localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  else localStorage.removeItem(STORAGE_KEY);
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class RemoteClaudeBridge implements ClaudeCodeBridge {
  private ws: WebSocket | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(buddyId: string, event: ClaudeEvent) => void>();
  private closed = false;

  constructor(private cfg: RemoteClaudeConfig, private agent: 'claude' | 'codex' = 'claude') {}

  private connect(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      let ws: WebSocket;
      try { ws = new WebSocket(this.cfg.url); }
      catch (err) { reject(err as Error); return; }
      this.ws = ws;
      ws.onopen = () => {
        const id = this.nextId++;
        this.pending.set(id, {
          resolve: () => resolve(),
          reject: (e) => reject(e),
        });
        ws.send(JSON.stringify({ op: 'auth', id, token: this.cfg.token }));
      };
      ws.onmessage = (e) => this.handleMessage(String(e.data));
      ws.onerror = () => { /* surfaced via onclose */ };
      ws.onclose = (ev) => {
        this.closed = true;
        // Include the URL + close code so the chat-bubble error tells the
        // user where it tried to connect and why it failed (1006 = couldn't
        // reach host: firewall / wrong IP / different network; 4401 = bad
        // token; 1000 = clean close).
        const reason = ev.reason ? `: ${ev.reason}` : '';
        const err = new Error(`couldn't reach ${this.cfg.url} (close ${ev.code}${reason})`);
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
        this.ready = null;
        this.ws = null;
      };
    });
    return this.ready;
  }

  private handleMessage(data: string): void {
    let msg: { type?: string; id?: number; result?: unknown; buddyId?: string; event?: ClaudeEvent; message?: string; agent?: string };
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === 'event' && msg.buddyId && msg.event) {
      if (msg.agent && msg.agent !== this.agent) return;
      for (const cb of this.listeners) cb(msg.buddyId, msg.event);
      return;
    }
    if (msg.type === 'ack' && typeof msg.id === 'number') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      p.resolve(msg.result);
      return;
    }
    if (msg.type === 'error') {
      // Errors are not tied to a specific request id by the server. Surface
      // them as an event so the UI can display them in the chat bubble.
      for (const cb of this.listeners) cb('*', { type: 'error', text: String(msg.message || 'bridge error') });
    }
  }

  private async request<T>(op: string, payload: Record<string, unknown>): Promise<T> {
    if (this.closed) throw new Error('bridge closed');
    await this.connect();
    const ws = this.ws;
    if (!ws || ws.readyState !== ws.OPEN) throw new Error('bridge not open');
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject });
      try { ws.send(JSON.stringify({ op, id, agent: this.agent, ...payload })); }
      catch (err) { this.pending.delete(id); reject(err as Error); }
    });
  }

  async start(buddyId: string, opts?: ClaudeStartOpts) {
    return this.request<{ ok: boolean; alreadyRunning?: boolean; cwd?: string; error?: string }>(
      'start', { buddyId, opts }
    );
  }
  async send(buddyId: string, text: string) {
    return this.request<{ ok: boolean; error?: string }>('send', { buddyId, text });
  }
  async stop(buddyId: string) {
    return this.request<{ ok: boolean; error?: string }>('stop', { buddyId });
  }
  async list() {
    return this.request<string[]>('list', {});
  }
  onEvent(cb: (buddyId: string, event: ClaudeEvent) => void): () => void {
    this.listeners.add(cb);
    // Lazy-connect so `adapter.claudeCode()` is cheap even when nothing
    // subscribes yet (e.g. UI just rendered the toggle).
    void this.connect().catch(() => { /* surface via onclose */ });
    return () => { this.listeners.delete(cb); };
  }
}

// Shared singleton per (url, token) pair so multiple BuddyInstance components
// don't each open their own socket. Reset when the config changes.
let cached: { key: string; bridge: RemoteClaudeBridge } | null = null;
let cachedCodex: { key: string; bridge: RemoteClaudeBridge } | null = null;
export function getRemoteClaudeBridge(): RemoteClaudeBridge | null {
  const cfg = getRemoteClaudeConfig();
  if (!cfg) { cached = null; return null; }
  const key = `${cfg.url}|${cfg.token}`;
  if (cached?.key === key) return cached.bridge;
  cached = { key, bridge: new RemoteClaudeBridge(cfg, 'claude') };
  return cached.bridge;
}

export function getRemoteCodexBridge(): RemoteClaudeBridge | null {
  const cfg = getRemoteClaudeConfig();
  if (!cfg) { cachedCodex = null; return null; }
  const key = `${cfg.url}|${cfg.token}`;
  if (cachedCodex?.key === key) return cachedCodex.bridge;
  cachedCodex = { key, bridge: new RemoteClaudeBridge(cfg, 'codex') };
  return cachedCodex.bridge;
}
