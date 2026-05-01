import { buddyAvatarAdapter } from './buddy/buddy-avatar-adapter';
import { notoAvatarAdapter } from './noto/noto-avatar-adapter';
import { shimejiAvatarAdapter } from './shimeji/shimeji-avatar-adapter';
import { model3dAvatarAdapter } from './model3d/model-3d-avatar-adapter';
import { spriteAvatarAdapter } from './sprite/sprite-avatar-adapter';
import type { AvatarAdapter } from './types';

export const AVATAR_ADAPTERS: AvatarAdapter[] = [
  buddyAvatarAdapter,
  notoAvatarAdapter,
  shimejiAvatarAdapter,
  model3dAvatarAdapter,
  spriteAvatarAdapter,
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
