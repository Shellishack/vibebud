import type { NotificationPayload, PlatformAdapter } from '../../lib/platform/types';
import { getNotifyMethod } from './llm';

export type Ping = NotificationPayload;

/**
 * Routes a "ping" (agent dispatched, PR ready, etc.) either to the OS-native
 * notification channel or to the in-app toast queue, depending on the user's
 * choice in app settings (vibemoji.notifyMethod.v1). Caller passes the
 * platform adapter (for the native branch) and a fallback that pushes an
 * in-app toast (for the default branch).
 */
export function routePing(
  adapter: PlatformAdapter,
  ping: Ping,
  pushToastFallback: (p: Ping) => void,
): void {
  if (getNotifyMethod() === 'native') {
    try { adapter.showNotification(ping); return; } catch { /* fall through */ }
  }
  pushToastFallback(ping);
}
