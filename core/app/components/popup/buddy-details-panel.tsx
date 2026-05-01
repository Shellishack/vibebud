'use client';

import type { Emotion } from '../avatars';
import type { ProviderId } from '../llm';
import type { AvatarInstanceState } from '../avatar/avatar-instance.types';
import type { AvatarCategory } from '../avatar/types';
import type { CodeAgentDescriptor } from '../../../lib/platform/types';
import AvatarFamilyPicker from './avatar-family-picker';
import BuddyLlmSettings from './buddy-llm-settings';

type Progress = {
  level: number;
  xp: number;
  next: number;
  pct: number;
  stats: {
    chats: number;
    tasksCompleted: number;
    pings: number;
  };
};

type Bond = {
  bondLevel: number;
  mood: string;
  memories: string[];
};

type Milestone = {
  level: number;
  title: string;
};

type DailyTask = {
  id: string;
  title: string;
  progress: number;
  target: number;
  completedAt?: string | number | null;
};

type TeamBonus = {
  label: string;
} | null | undefined;

type Props = {
  state: AvatarInstanceState;
  emotion: Emotion;
  familyMenu: AvatarCategory | null;
  settingsOpen: boolean;
  progress: Progress;
  bond: Bond;
  unlockedMilestones: Milestone[];
  dailyTasks: DailyTask[];
  activeTeamBonus: TeamBonus;
  providerDraft: ProviderId;
  keyDraft: string;
  modelDraft: string;
  modelList: string[];
  loadingModels: boolean;
  codeAgentOptions: CodeAgentDescriptor[];
  codeAgentActive: boolean;
  activeCodeAgent: string | null;
  showLlmOnboarding?: boolean;
  onFamilyMenuChange: (category: AvatarCategory | null) => void;
  onUpdate: (patch: Partial<AvatarInstanceState>) => void;
  onToggleSettings: () => void;
  onDismissLlmOnboarding?: () => void;
  onSwitchProvider: (provider: ProviderId) => void;
  onKeyDraftChange: (key: string) => void;
  onModelDraftChange: (model: string) => void;
  onLoadModels: (provider: ProviderId, key: string) => void;
  onToggleCodeAgent: (agentId: string) => void;
  onCancelSettings: () => void;
  onSaveSettings: () => void;
};

export default function BuddyDetailsPanel({
  state,
  emotion,
  familyMenu,
  settingsOpen,
  progress,
  bond,
  unlockedMilestones,
  dailyTasks,
  activeTeamBonus,
  providerDraft,
  keyDraft,
  modelDraft,
  modelList,
  loadingModels,
  codeAgentOptions,
  codeAgentActive,
  activeCodeAgent,
  showLlmOnboarding,
  onFamilyMenuChange,
  onUpdate,
  onToggleSettings,
  onDismissLlmOnboarding,
  onSwitchProvider,
  onKeyDraftChange,
  onModelDraftChange,
  onLoadModels,
  onToggleCodeAgent,
  onCancelSettings,
  onSaveSettings,
}: Props) {
  return (
    <>
      <div className="mt-2 max-h-[40vh] overflow-y-auto pr-1">
        <div className="mb-1 flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          <span>Level {progress.level}</span>
          <span>{progress.xp} / {progress.next} XP</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-violet-500 transition-[width] duration-500"
            style={{ width: `${progress.pct}%` }}
          />
        </div>
        <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
          {progress.stats.chats} chats · {progress.stats.tasksCompleted} tasks · {progress.stats.pings} pings
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-zinc-600 dark:text-zinc-300">
          <div className="rounded-xl bg-zinc-50 px-2 py-1.5 dark:bg-zinc-800/70">
            <p className="font-semibold uppercase tracking-wider text-zinc-400">Bond</p>
            <p className="mt-0.5">Lv {bond.bondLevel} · {bond.mood}</p>
          </div>
          <div className="rounded-xl bg-zinc-50 px-2 py-1.5 dark:bg-zinc-800/70">
            <p className="font-semibold uppercase tracking-wider text-zinc-400">Team</p>
            <p className="mt-0.5">{activeTeamBonus?.label ?? 'No active bonus'}</p>
          </div>
        </div>
        {(unlockedMilestones.length > 0 || bond.memories.length > 0) && (
          <div className="mt-2 flex flex-wrap gap-1">
            {unlockedMilestones.slice(-3).map((milestone) => (
              <span key={milestone.level} className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
                {milestone.title}
              </span>
            ))}
            {bond.memories.slice(-1).map((memory) => (
              <span key={memory} className="max-w-full truncate rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">
                {memory}
              </span>
            ))}
          </div>
        )}
        <div className="mt-2 space-y-1">
          {dailyTasks.map((task) => (
            <div key={task.id} className="flex items-center justify-between gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
              <span className={task.completedAt ? 'line-through opacity-60' : ''}>{task.title}</span>
              <span className="shrink-0">{task.progress}/{task.target}</span>
            </div>
          ))}
        </div>
      </div>
      <AvatarFamilyPicker
        state={state}
        emotion={emotion}
        openCategory={familyMenu}
        onOpenCategoryChange={onFamilyMenuChange}
        update={onUpdate}
      />
      <BuddyLlmSettings
        buddyId={state.id}
        open={settingsOpen}
        providerDraft={providerDraft}
        keyDraft={keyDraft}
        modelDraft={modelDraft}
        modelList={modelList}
        loadingModels={loadingModels}
        codeAgentOptions={codeAgentOptions}
        codeAgentActive={codeAgentActive}
        activeCodeAgent={activeCodeAgent}
        showLlmOnboarding={showLlmOnboarding}
        onToggleOpen={onToggleSettings}
        onDismissLlmOnboarding={onDismissLlmOnboarding}
        onSwitchProvider={onSwitchProvider}
        onKeyDraftChange={onKeyDraftChange}
        onModelDraftChange={onModelDraftChange}
        onLoadModels={onLoadModels}
        onToggleCodeAgent={onToggleCodeAgent}
        onCancel={onCancelSettings}
        onSave={onSaveSettings}
      />
    </>
  );
}
