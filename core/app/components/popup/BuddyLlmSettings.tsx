'use client';

import { PROVIDERS, type ProviderId } from '../llm';
import type { CodeAgentDescriptor } from '../../../lib/platform/types';

type CodeAgentOption = CodeAgentDescriptor;

type Props = {
  buddyId: string;
  open: boolean;
  providerDraft: ProviderId;
  keyDraft: string;
  modelDraft: string;
  modelList: string[];
  loadingModels: boolean;
  codeAgentOptions: CodeAgentOption[];
  codeAgentActive: boolean;
  activeCodeAgent: string | null;
  showLlmOnboarding?: boolean;
  onToggleOpen: () => void;
  onDismissLlmOnboarding?: () => void;
  onSwitchProvider: (provider: ProviderId) => void;
  onKeyDraftChange: (key: string) => void;
  onModelDraftChange: (model: string) => void;
  onLoadModels: (provider: ProviderId, key: string) => void;
  onToggleCodeAgent: (agentId: string) => void;
  onCancel: () => void;
  onSave: () => void;
};

export default function BuddyLlmSettings({
  buddyId,
  open,
  providerDraft,
  keyDraft,
  modelDraft,
  modelList,
  loadingModels,
  codeAgentOptions,
  codeAgentActive,
  activeCodeAgent,
  showLlmOnboarding,
  onToggleOpen,
  onDismissLlmOnboarding,
  onSwitchProvider,
  onKeyDraftChange,
  onModelDraftChange,
  onLoadModels,
  onToggleCodeAgent,
  onCancel,
  onSave,
}: Props) {
  return (
    <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50/80 dark:border-zinc-700 dark:bg-zinc-800/50">
      <button
        data-buddy-interactive
        onClick={onToggleOpen}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-semibold text-zinc-700 dark:text-zinc-200"
      >
        <span>LLM settings</span>
        <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
          {open ? 'hide' : 'show'}
        </span>
      </button>
      {open && (
        <div className="border-t border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
          {showLlmOnboarding && (
            <div className="mb-2 rounded-xl bg-violet-50 px-3 py-2 text-[11px] text-violet-800 dark:bg-violet-500/10 dark:text-violet-200">
              Add an API key and model so this buddy can answer with your preferred provider.
              <button
                onClick={onDismissLlmOnboarding}
                className="ml-2 font-semibold underline"
              >
                dismiss
              </button>
            </div>
          )}
          <label className="mb-1 block text-zinc-600 dark:text-zinc-400">Provider</label>
          <div className="mb-2 flex gap-1">
            {(Object.keys(PROVIDERS) as ProviderId[]).map((provider) => (
              <button
                key={provider}
                onClick={() => onSwitchProvider(provider)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  providerDraft === provider
                    ? 'bg-violet-600 text-white'
                    : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-800'
                }`}
              >
                {PROVIDERS[provider].label}
              </button>
            ))}
          </div>
          {codeAgentOptions.length > 0 && (
            <div className="mb-2">
              <p className="mb-1 text-[11px] text-zinc-600 dark:text-zinc-400">Local code agent</p>
              <div className="flex flex-wrap gap-1">
                {codeAgentOptions.map((agent) => (
                  <button
                    key={agent.id}
                    data-buddy-interactive
                    onClick={() => onToggleCodeAgent(agent.id)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      codeAgentActive && activeCodeAgent === agent.id
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-800'
                    }`}
                    title={codeAgentActive && activeCodeAgent === agent.id ? `${agent.label} session running - click to stop` : `Start a local ${agent.label} session for this buddy`}
                  >
                    {codeAgentActive && activeCodeAgent === agent.id ? `* ${agent.label}` : agent.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="mb-1 block text-zinc-600 dark:text-zinc-400">{PROVIDERS[providerDraft].label} API key</label>
          <input
            type="password"
            value={keyDraft}
            onChange={(event) => onKeyDraftChange(event.target.value)}
            onBlur={() => onLoadModels(providerDraft, keyDraft.trim())}
            placeholder={PROVIDERS[providerDraft].keyPlaceholder}
            className="mb-2 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1 outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-zinc-600 dark:text-zinc-400">Model</label>
            <button
              onClick={() => onLoadModels(providerDraft, keyDraft.trim())}
              className="text-[10px] text-violet-600 hover:underline disabled:opacity-50 dark:text-violet-400"
              disabled={loadingModels}
            >
              {loadingModels ? 'loading...' : 'refresh'}
            </button>
          </div>
          <input
            type="text"
            list={`buddy-models-${buddyId}`}
            value={modelDraft}
            onChange={(event) => onModelDraftChange(event.target.value)}
            placeholder={PROVIDERS[providerDraft].defaultModel}
            className="mb-2 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1 outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <datalist id={`buddy-models-${buddyId}`}>
            {(modelList.length ? modelList : PROVIDERS[providerDraft].knownModels).map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          <div className="flex justify-end gap-2">
            <button
              onClick={onCancel}
              className="rounded-full px-2.5 py-1 text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              cancel
            </button>
            <button
              onClick={onSave}
              className="rounded-full bg-violet-600 px-2.5 py-1 font-medium text-white hover:bg-violet-700"
            >
              save
            </button>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            Stored locally in this browser only. Calls go direct from your browser to {PROVIDERS[providerDraft].label}.
          </p>
        </div>
      )}
    </div>
  );
}
