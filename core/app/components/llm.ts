import type { Personality } from './personalities';

export type ProviderId = 'openai' | 'anthropic' | 'openrouter';

export type ProviderInfo = {
  id: ProviderId;
  label: string;
  keyPlaceholder: string;
  defaultModel: string;
  knownModels: string[];
  chatUrl: string;
  modelsUrl: string;
};

// Curated model lists used as a fallback when /models can't be reached.
// Live lists are fetched at runtime via fetchModels().
export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    keyPlaceholder: 'sk-…',
    defaultModel: 'gpt-4o-mini',
    knownModels: [
      // Flagship + reasoning
      'gpt-5', 'gpt-5-mini', 'gpt-5-nano',
      'o4-mini', 'o3', 'o3-mini', 'o3-pro', 'o1', 'o1-mini',
      // GPT-4.1 family
      'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
      // GPT-4o family
      'gpt-4o', 'gpt-4o-mini',
      // Cheap fast option
      'gpt-3.5-turbo',
    ],
    chatUrl: 'https://api.openai.com/v1/chat/completions',
    modelsUrl: 'https://api.openai.com/v1/models',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    keyPlaceholder: 'sk-ant-…',
    defaultModel: 'claude-sonnet-4-5',
    knownModels: [
      // Latest Claude 4.x family
      'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-sonnet-4-5',
      'claude-haiku-4-5', 'claude-opus-4-1', 'claude-sonnet-4', 'claude-opus-4',
      // Aliases
      'claude-opus-latest', 'claude-sonnet-latest', 'claude-haiku-latest',
      // Claude 3.x (legacy but still popular)
      'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest',
    ],
    chatUrl: 'https://api.anthropic.com/v1/messages',
    modelsUrl: 'https://api.anthropic.com/v1/models',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    keyPlaceholder: 'sk-or-…',
    defaultModel: 'openai/gpt-4o-mini',
    knownModels: [
      // OpenAI via OpenRouter
      'openai/gpt-5', 'openai/gpt-5-mini', 'openai/gpt-4.1', 'openai/gpt-4o',
      'openai/gpt-4o-mini', 'openai/o3', 'openai/o4-mini',
      // Anthropic
      'anthropic/claude-opus-4.7', 'anthropic/claude-sonnet-4.6',
      'anthropic/claude-sonnet-4.5', 'anthropic/claude-opus-4.5',
      'anthropic/claude-haiku-4.5',
      // Google
      'google/gemini-2.5-pro', 'google/gemini-2.5-flash', 'google/gemini-2.0-flash',
      // Meta
      'meta-llama/llama-4-maverick', 'meta-llama/llama-4-scout',
      'meta-llama/llama-3.3-70b-instruct',
      // Mistral
      'mistralai/mistral-large', 'mistralai/mistral-small-3',
      // DeepSeek
      'deepseek/deepseek-r1', 'deepseek/deepseek-chat', 'deepseek/deepseek-v3',
      // xAI
      'x-ai/grok-4', 'x-ai/grok-2',
      // Alibaba
      'qwen/qwen-2.5-72b-instruct', 'qwen/qwq-32b-preview',
    ],
    chatUrl: 'https://openrouter.ai/api/v1/chat/completions',
    modelsUrl: 'https://openrouter.ai/api/v1/models',
  },
};

export type ChatRole = 'user' | 'assistant';
export type ChatTurn = { role: ChatRole; content: string };
export type Teammate = { name: string; role: string };

const PROVIDER_STORAGE = 'vibemoji.provider.v1';
const KEY_STORAGE = (p: ProviderId) => `vibemoji.llmKey.${p}.v1`;
const MODEL_STORAGE = (p: ProviderId) => `vibemoji.llmModel.${p}.v1`;
const MAX_HISTORY_MESSAGES = 30;

const lsGet = (k: string) => {
  if (typeof window === 'undefined') return '';
  try { return localStorage.getItem(k) ?? ''; } catch { return ''; }
};
const lsSet = (k: string, v: string) => {
  try { localStorage.setItem(k, v); } catch { /* noop */ }
};

export const getProvider = (): ProviderId => {
  const v = lsGet(PROVIDER_STORAGE);
  return (v in PROVIDERS ? v : 'openai') as ProviderId;
};
export const setProvider = (p: ProviderId) => lsSet(PROVIDER_STORAGE, p);

export const getApiKey = (p: ProviderId = getProvider()): string => lsGet(KEY_STORAGE(p));
export const setApiKey = (p: ProviderId, key: string) => lsSet(KEY_STORAGE(p), key);

export const getModel = (p: ProviderId = getProvider()): string => {
  return lsGet(MODEL_STORAGE(p)) || PROVIDERS[p].defaultModel;
};
export const setModel = (p: ProviderId, m: string) => lsSet(MODEL_STORAGE(p), m);

export function buildSystemPrompt(p: Personality, teammates: Teammate[]): string {
  let s = p.systemPrompt;
  if (teammates.length > 0) {
    const list = teammates.map((t) => `${t.name} (${t.role})`).join(', ');
    s +=
      `\n\nYou are currently in a small team of buddies with: ${list}. ` +
      `If the user's request fits a teammate's role better than yours, say so briefly and suggest they ask them — but stay in character and still give your own honest take.`;
  }
  return s;
}

export const trimHistory = (msgs: ChatTurn[]): ChatTurn[] =>
  msgs.length <= MAX_HISTORY_MESSAGES ? msgs : msgs.slice(-MAX_HISTORY_MESSAGES);

export type StreamOpts = {
  system: string;
  messages: ChatTurn[];
  signal?: AbortSignal;
  // All optional — defaults read from current localStorage settings.
  provider?: ProviderId;
  apiKey?: string;
  model?: string;
};

const buildBodyAndHeaders = (
  provider: ProviderId,
  apiKey: string,
  model: string,
  system: string,
  messages: ChatTurn[],
) => {
  if (provider === 'anthropic') {
    // Anthropic requires max_tokens. Pass a generous cap rather than no limit.
    return {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model, max_tokens: 4096, system, messages, stream: true }),
    };
  }
  // openai + openrouter share format
  const fullMessages = [
    { role: 'system' as const, content: system },
    ...messages,
  ];
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = (typeof window !== 'undefined' && window.location?.origin) || 'https://vibemoji.local';
    headers['X-Title'] = 'vibemoji';
  }
  // No token limit — let the model decide when to stop.
  return {
    headers,
    body: JSON.stringify({ model, messages: fullMessages, stream: true }),
  };
};

const parseDelta = (provider: ProviderId, evt: unknown): string | null => {
  if (!evt || typeof evt !== 'object') return null;
  const e = evt as Record<string, unknown>;
  if (provider === 'anthropic') {
    if (e.type === 'content_block_delta') {
      const d = e.delta as { type?: string; text?: string } | undefined;
      if (d?.type === 'text_delta' && typeof d.text === 'string') return d.text;
    }
    if (e.type === 'error' && e.error && typeof (e.error as Record<string, unknown>).message === 'string') {
      throw new Error(`stream error: ${(e.error as Record<string, string>).message}`);
    }
    return null;
  }
  // openai / openrouter
  const choices = e.choices as Array<{ delta?: { content?: string } }> | undefined;
  const c = choices?.[0]?.delta?.content;
  if (typeof c === 'string' && c.length) return c;
  if (e.error && typeof (e.error as Record<string, unknown>).message === 'string') {
    throw new Error(`stream error: ${(e.error as Record<string, string>).message}`);
  }
  return null;
};

export async function* streamChat(opts: StreamOpts): AsyncGenerator<string> {
  const provider = opts.provider ?? getProvider();
  const apiKey = opts.apiKey ?? getApiKey(provider);
  const model = opts.model ?? getModel(provider);
  if (!apiKey) throw new Error(`No API key set for ${PROVIDERS[provider].label}`);

  const { headers, body } = buildBodyAndHeaders(
    provider, apiKey, model, opts.system, opts.messages,
  );

  const res = await fetch(PROVIDERS[provider].chatUrl, {
    method: 'POST', headers, body, signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    let detail = '';
    try { detail = await res.text(); } catch { /* noop */ }
    throw new Error(`${PROVIDERS[provider].label} ${res.status}: ${detail.slice(0, 240) || res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const evt = JSON.parse(data);
        const out = parseDelta(provider, evt);
        if (out) yield out;
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('stream error')) throw err;
      }
    }
  }
}

/**
 * Fetch the live model list from a provider's /models endpoint. Returns model
 * IDs only. Falls back to the curated `knownModels` list on any failure.
 */
export async function fetchModels(provider: ProviderId, apiKey: string, signal?: AbortSignal): Promise<string[]> {
  const info = PROVIDERS[provider];
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (provider === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    } else if (provider !== 'openrouter' || apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const res = await fetch(info.modelsUrl, { headers, signal });
    if (!res.ok) throw new Error(`${res.status}`);
    const json = await res.json();
    const data = (json?.data ?? json?.models ?? []) as Array<{ id?: string; name?: string }>;
    const ids = data
      .map((m) => m.id || m.name)
      .filter((s): s is string => typeof s === 'string' && s.length > 0);
    return Array.from(new Set(ids)).sort();
  } catch {
    return info.knownModels;
  }
}
