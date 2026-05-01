import type { ReactNode } from 'react';
import type { AvatarInstanceState } from './avatar-instance.types';
import type { Emotion, NotoGroup } from '../avatars';
import type { Personality } from '../personalities';
import type { ShimejiAction } from '@/lib/avatar/types';

export type AvatarCategory = 'buddy' | 'noto' | 'shimeji' | 'model3d';

export type NotoAvatarState = {
  kind: 'noto';
  group: NotoGroup;
  composition?: import('../avatars').FacesWithHandsComposition;
};

export type AvatarRuntimeContext = {
  state: AvatarInstanceState;
  personality: Personality;
  emotion: Emotion;
  action: ShimejiAction;
  direction?: -1 | 1;
  onChange: (next: AvatarInstanceState) => void;
};

export type AvatarRuntime = {
  visual: ReactNode;
  accessories?: ReactNode;
  isMoving: boolean;
};

export type AvatarPickerProps = {
  state: AvatarInstanceState;
  emotion: Emotion;
  update: (patch: Partial<AvatarInstanceState>) => void;
  close: () => void;
};

export type AvatarAdapter = {
  category: AvatarCategory;
  label: string;
  matches: (state: AvatarInstanceState) => boolean;
  useRuntime: (context: AvatarRuntimeContext) => AvatarRuntime;
  Picker: (props: AvatarPickerProps) => ReactNode;
};
