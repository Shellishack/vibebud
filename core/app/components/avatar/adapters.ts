import { buddyAvatarAdapter } from './buddy/BuddyAvatarAdapter';
import { notoAvatarAdapter } from './noto/NotoAvatarAdapter';
import { shimejiAvatarAdapter } from './shimeji/ShimejiAvatarAdapter';
import { model3dAvatarAdapter } from './model3d/Model3DAvatarAdapter';
import type { AvatarAdapter } from './types';

export const AVATAR_ADAPTERS: AvatarAdapter[] = [
  buddyAvatarAdapter,
  notoAvatarAdapter,
  shimejiAvatarAdapter,
  model3dAvatarAdapter,
];

export function getAvatarAdapterForState(state: Parameters<AvatarAdapter['matches']>[0]) {
  return AVATAR_ADAPTERS.find((adapter) => adapter.matches(state)) ?? buddyAvatarAdapter;
}

export function useAvatarRuntime(context: Parameters<AvatarAdapter['useRuntime']>[0]) {
  const runtimes = AVATAR_ADAPTERS.map((adapter) => ({
    adapter,
    runtime: adapter.useRuntime(context),
  }));
  return runtimes.find((entry) => entry.adapter.matches(context.state)) ?? runtimes[0];
}
