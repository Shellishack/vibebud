'use client';

import { useEffect, useRef, useState } from 'react';
import {
  fetchModels,
  getApiKey,
  getModel,
  getProvider,
  PROVIDERS,
  setApiKey,
  setModel,
  setProvider,
  type ProviderId,
} from '@/app/components/llm';

type Props = {
  showLlmOnboarding?: boolean;
  onShowOnboarding?: () => void;
  onDismissLlmOnboarding?: () => void;
};

export function useBuddyLlmSettings({
  showLlmOnboarding,
  onShowOnboarding,
  onDismissLlmOnboarding,
}: Props) {
  const [open, setOpen] = useState(false);
  const [providerDraft, setProviderDraft] = useState<ProviderId>('openai');
  const [keyDraft, setKeyDraft] = useState('');
  const [modelDraft, setModelDraft] = useState('');
  const [modelList, setModelList] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const modelsAbortRef = useRef<AbortController | null>(null);

  const loadModelsFor = (provider: ProviderId, key: string) => {
    modelsAbortRef.current?.abort();
    const controller = new AbortController();
    modelsAbortRef.current = controller;
    setLoadingModels(true);
    setModelList([]);
    fetchModels(provider, key, controller.signal)
      .then((list) => { if (!controller.signal.aborted) setModelList(list); })
      .finally(() => { if (!controller.signal.aborted) setLoadingModels(false); });
  };

  const openSettings = () => {
    const provider = getProvider();
    const key = getApiKey(provider);
    const model = getModel(provider);
    setProviderDraft(provider);
    setKeyDraft(key);
    setModelDraft(model);
    setOpen(true);
    loadModelsFor(provider, key);
  };

  const switchProvider = (provider: ProviderId) => {
    const key = getApiKey(provider);
    const model = getModel(provider);
    setProviderDraft(provider);
    setKeyDraft(key);
    setModelDraft(model);
    loadModelsFor(provider, key);
  };

  const save = () => {
    const key = keyDraft.trim();
    const model = modelDraft.trim() || PROVIDERS[providerDraft].defaultModel;
    setProvider(providerDraft);
    setApiKey(providerDraft, key);
    setModel(providerDraft, model);
    setOpen(false);
    onDismissLlmOnboarding?.();
  };

  const cancel = () => {
    setOpen(false);
    onDismissLlmOnboarding?.();
  };

  const toggle = () => {
    if (open) setOpen(false);
    else openSettings();
  };

  useEffect(() => {
    if (!showLlmOnboarding) return;
    onShowOnboarding?.();
    openSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLlmOnboarding]);

  return {
    open,
    providerDraft,
    keyDraft,
    modelDraft,
    modelList,
    loadingModels,
    setKeyDraft,
    setModelDraft,
    loadModelsFor,
    openSettings,
    switchProvider,
    save,
    cancel,
    toggle,
  };
}
