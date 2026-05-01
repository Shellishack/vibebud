'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlatformAdapter, ClaudeCodeBridge, CodeAgentDescriptor } from '@/lib/platform/types';

type ChatMsg = { id: number; from: 'buddy' | 'you'; text: string };
type CodeAgentOption = CodeAgentDescriptor & { bridge: ClaudeCodeBridge };

type Props = {
  adapter: PlatformAdapter;
  buddyId: string;
  getMessages: () => ChatMsg[];
  updateMessages: (messages: ChatMsg[]) => void;
  nextBuddyMessageId: () => number;
  onTaskComplete: () => void;
  onUnavailable: (title: string, body: string) => void;
  onHappy: () => void;
};

export function useCodeAgents({
  adapter,
  buddyId,
  getMessages,
  updateMessages,
  nextBuddyMessageId,
  onTaskComplete,
  onUnavailable,
  onHappy,
}: Props) {
  const [bridgeTick, setBridgeTick] = useState(0);
  const claudeBridge = useMemo(() => adapter.claudeCode(), [adapter, bridgeTick]);
  const codexBridge = useMemo(() => adapter.codexCode(), [adapter, bridgeTick]);
  const [extraAgents, setExtraAgents] = useState<CodeAgentDescriptor[]>([]);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const replyIdRef = useRef<number | null>(null);

  useEffect(() => {
    const onPaired = () => setBridgeTick((tick) => tick + 1);
    window.addEventListener('vibebud:paired', onPaired);
    return () => window.removeEventListener('vibebud:paired', onPaired);
  }, []);

  useEffect(() => {
    let cancelled = false;
    adapter.codeAgents().then((agents) => {
      if (!cancelled) setExtraAgents(agents);
    }).catch(() => {
      if (!cancelled) setExtraAgents([]);
    });
    return () => { cancelled = true; };
  }, [adapter, bridgeTick]);

  const options = useMemo<CodeAgentOption[]>(() => {
    const next: CodeAgentOption[] = [];
    if (claudeBridge) next.push({ id: 'claude', label: 'Claude Code', bridge: claudeBridge });
    if (codexBridge) next.push({ id: 'codex', label: 'Codex', bridge: codexBridge });
    for (const agent of extraAgents) {
      const bridge = adapter.codeAgent(agent.id);
      if (bridge) next.push({ ...agent, bridge });
    }
    return next;
  }, [adapter, claudeBridge, codexBridge, extraAgents]);

  const optionsRef = useRef<CodeAgentOption[]>([]);
  useEffect(() => { optionsRef.current = options; }, [options]);

  const activeBridge = useMemo(
    () => options.find((agent) => agent.id === activeAgent)?.bridge ?? null,
    [activeAgent, options],
  );
  const activeLabel = options.find((agent) => agent.id === activeAgent)?.label ?? 'Code agent';

  useEffect(() => {
    if (!activeBridge || !activeAgent) return;
    const off = activeBridge.onEvent((eventBuddyId, event) => {
      if (eventBuddyId !== buddyId) return;
      const replyId = replyIdRef.current;
      const type = event && typeof event === 'object' ? (event as { type?: string }).type : undefined;

      const appendToReply = (chunk: string) => {
        if (replyId == null || !chunk) return;
        const current = getMessages();
        const index = current.findIndex((message) => message.id === replyId);
        if (index < 0) return;
        const next = current.slice();
        next[index] = { ...next[index], text: next[index].text + chunk };
        updateMessages(next);
      };
      const appendStatus = (text: string) => {
        updateMessages([...getMessages(), { id: nextBuddyMessageId(), from: 'buddy', text }]);
      };

      if (type === 'system') {
        return;
      }
      if (type === 'assistant' || type === 'stream_event') {
        const message = (event as { message?: { content?: Array<{ type?: string; text?: string; name?: string }> } }).message;
        const blocks = message?.content;
        if (Array.isArray(blocks)) {
          for (const block of blocks) {
            if (block.type === 'text' && block.text) appendToReply(block.text);
            else if (block.type === 'tool_use' && block.name) appendToReply(`\n[tool: ${block.name}]\n`);
          }
        }
        const delta = (event as { delta?: { type?: string; text?: string } }).delta;
        if (delta?.type === 'text_delta' && delta.text) appendToReply(delta.text);
        return;
      }
      if (type === 'assistant_delta') {
        const delta = (event as { delta?: { text?: string } }).delta;
        if (delta?.text) appendToReply(delta.text);
        return;
      }
      if (type === 'tool_use') {
        const name = (event as { name?: string }).name || 'tool';
        appendToReply(`\n[tool: ${name}]\n`);
        return;
      }
      if (type === 'result') {
        setBusy(false);
        replyIdRef.current = null;
        onTaskComplete();
        onHappy();
        return;
      }
      if (type === 'error' || type === 'stderr' || type === 'raw') {
        const text = (event as { text?: string }).text || `${activeLabel} error`;
        if (replyId != null) appendToReply(`\n(${text.trim()})`);
        else appendStatus(`(${activeLabel}: ${text.trim()})`);
        return;
      }
      if (type === 'closed') {
        const code = (event as { code?: number }).code;
        const stderr = (event as { stderr?: string }).stderr;
        const bin = (event as { bin?: string }).bin;
        const cwd = (event as { cwd?: string }).cwd;
        if (code !== 0) {
          const detail = stderr
            ? stderr.trim()
            : `no stderr - likely '${bin || activeAgent || 'agent'}' is not on PATH or not authenticated (cwd: ${cwd || '?'}). Try authenticating in a terminal, or set this agent's VIBEBUD_*_BIN environment variable to the full path.`;
          appendStatus(`(${activeLabel} exited with code ${code ?? '?'}: ${detail})`);
        }
        setBusy(false);
        setActive(false);
        replyIdRef.current = null;
      }
    });
    return off;
  }, [activeAgent, activeBridge, activeLabel, buddyId, getMessages, nextBuddyMessageId, onHappy, onTaskComplete, updateMessages]);

  useEffect(() => {
    return () => {
      for (const option of optionsRef.current) void option.bridge.stop(buddyId).catch(() => {});
    };
  }, [buddyId]);

  const toggle = async (agentId: string) => {
    const option = options.find((item) => item.id === agentId);
    const bridge = option?.bridge;
    if (!bridge) return;
    if (active && activeAgent === agentId) {
      await bridge.stop(buddyId).catch(() => {});
      setActive(false);
      setActiveAgent(null);
      setBusy(false);
      replyIdRef.current = null;
      return;
    }
    if (active && activeBridge) {
      await activeBridge.stop(buddyId).catch(() => {});
    }
    const result = await bridge.start(buddyId).catch((error) => ({ ok: false, error: String(error) } as const));
    if (result.ok) {
      setActiveAgent(agentId);
      setActive(true);
      setBusy(false);
      replyIdRef.current = null;
    } else {
      onUnavailable(`${option.label} unavailable`, result.error || 'unknown error');
    }
  };

  const beginReply = (replyId: number) => {
    replyIdRef.current = replyId;
    setBusy(true);
  };

  const clearReply = () => {
    replyIdRef.current = null;
    setBusy(false);
  };

  const stopActive = async () => {
    if (active && activeBridge) await activeBridge.stop(buddyId).catch(() => {});
    clearReply();
  };

  return {
    options,
    active,
    busy,
    activeAgent,
    activeBridge,
    toggle,
    beginReply,
    clearReply,
    stopActive,
    setBusy,
  };
}
