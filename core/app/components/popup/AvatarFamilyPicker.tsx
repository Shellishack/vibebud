'use client';

import { AVATAR_ADAPTERS } from '../avatar/adapters';
import type { AvatarCategory } from '../avatar/types';
import type { AvatarInstanceState } from '../avatar/avatar-instance.types';
import type { Emotion } from '../avatars';

type Props = {
  state: AvatarInstanceState;
  emotion: Emotion;
  openCategory: AvatarCategory | null;
  onOpenCategoryChange: (next: AvatarCategory | null) => void;
  update: (patch: Partial<AvatarInstanceState>) => void;
};

export default function AvatarFamilyPicker({ state, emotion, openCategory, onOpenCategoryChange, update }: Props) {
  const openAdapter = AVATAR_ADAPTERS.find((adapter) => adapter.category === openCategory);
  const Picker = openAdapter?.Picker;
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">avatar</span>
        <div className="flex gap-1">
          {AVATAR_ADAPTERS.map((adapter) => (
            <FamilyPill
              key={adapter.category}
              label={adapter.label}
              active={adapter.matches(state)}
              open={openCategory === adapter.category}
              onClick={() => onOpenCategoryChange(openCategory === adapter.category ? null : adapter.category)}
            />
          ))}
        </div>
      </div>
      {Picker && (
        <Picker
          state={state}
          emotion={emotion}
          update={update}
          close={() => onOpenCategoryChange(null)}
        />
      )}
    </div>
  );
}

function FamilyPill({ label, active, open, onClick }: { label: string; active: boolean; open: boolean; onClick: () => void }) {
  const base = 'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors';
  const cls = active
    ? 'bg-violet-600 text-white'
    : open
      ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50'
      : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700';
  return (
    <button onClick={onClick} aria-pressed={active} className={`${base} ${cls}`}>
      {label}
    </button>
  );
}
