'use client';

import type { Emotion } from '../avatars';
import type { ProviderId } from '../llm';
import type { AvatarInstanceState } from '../avatar/avatar-instance.types';
import type { AvatarCategory } from '../avatar/types';
import type { CodeAgentDescriptor } from '../../../lib/platform/types';
import AvatarFamilyPicker from './avatar-family-picker';
import BuddyLlmSettings from './buddy-llm-settings';

type Props = {
  state: AvatarInstanceState;
  emotion: Emotion;
  familyMenu: AvatarCategory | null;
  settingsOpen: boolean;
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
    <div className="mt-2 max-h-[min(58vh,390px)] overflow-y-auto overscroll-contain pr-1">
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
    </div>
  );
}
