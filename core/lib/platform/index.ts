import { CapacitorAdapter } from './capacitor';
import { ElectronAdapter } from './electron';
import { getPlatform } from './detect';
import type { LayoutAdapter, PlatformAdapter, PlatformId } from './types';
import { WebAdapter } from './web';

let cached: PlatformAdapter | null = null;
let cachedLayout: LayoutAdapter | null = null;

export type { PlatformAdapter, LayoutAdapter, PlatformId, InteractiveRect } from './types';
export { getPlatform, isMobile, isWeb } from './detect';

const buildAdapter = (id: PlatformId): PlatformAdapter => {
  switch (id) {
    case 'capacitor-android': return new CapacitorAdapter();
    case 'electron':          return new ElectronAdapter();
    case 'web-mobile':        return new WebAdapter('web-mobile');
    case 'web':
    default:                  return new WebAdapter('web');
  }
};

const buildLayout = (id: PlatformId): LayoutAdapter => {
  const mobile = id === 'capacitor-android' || id === 'web-mobile';
  return {
    chatPanelMode: mobile ? 'sheet' : 'anchored',
    toastMode:     mobile ? 'sheet' : 'anchored',
    tapTargetSize: mobile ? 'comfortable' : 'compact',
    anchorPadding: mobile ? 16 : 24,
    avatarSize:    mobile ? 128 : 112,
  };
};

/**
 * Returns the platform adapter for the current runtime. Pass 'ssr' from
 * server / initial render paths to force the Web variant so hydration matches
 * the first client paint.
 */
export function getAdapter(mode?: 'ssr'): PlatformAdapter {
  if (mode === 'ssr') return new WebAdapter('web');
  if (!cached) cached = buildAdapter(getPlatform());
  return cached;
}

export function getLayout(mode?: 'ssr'): LayoutAdapter {
  if (mode === 'ssr') return buildLayout('web');
  if (!cachedLayout) cachedLayout = buildLayout(getPlatform());
  return cachedLayout;
}
