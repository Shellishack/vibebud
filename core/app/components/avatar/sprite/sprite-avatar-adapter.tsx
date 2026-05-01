'use client';

import { useEffect, useState } from 'react';
import { SERVER_ORIGIN, goToGoogleSignIn } from '../../auth-client';
import {
  importSpriteZip,
  importSpriteZipBase64,
  listSpritePacks,
  removeSpritePack,
  resolveSpriteAsset,
  subscribeSpritePacks,
} from '@/lib/avatar/sprite';
import type { InstalledSpritePack } from '@/lib/avatar/types';
import { usePlatform } from '@/lib/hooks/use-platform';
import type { AvatarAdapter } from '../types';
import SpriteAvatarView from './sprite-avatar';

const MOVING_ACTIONS = new Set(['walk', 'climb', 'fall', 'drag']);
const VENDORED_SKILL_PATH = 'generate2dsprite';

export const spriteAvatarAdapter: AvatarAdapter = {
  category: 'sprite',
  label: 'Sprite',
  matches: (state) => state.avatar?.kind === 'sprite',
  useRuntime: ({ state, action, direction }) => {
    const avatar = state.avatar?.kind === 'sprite' ? state.avatar : null;
    return {
      visual: avatar ? <SpriteAvatarView avatar={avatar} action={action} direction={direction} /> : null,
      isMoving: !!avatar && MOVING_ACTIONS.has(action),
    };
  },
  Picker: (props) => <SpritePicker {...props} />,
};

function SpritePicker({ state, update, close }: Parameters<AvatarAdapter['Picker']>[0]) {
  const adapter = usePlatform();
  const codex = adapter.codexCode();
  const [packs, setPacks] = useState<InstalledSpritePack[]>([]);
  const [name, setName] = useState('Custom Sprite');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState<'codex' | 'managed' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [codexLog, setCodexLog] = useState<string[]>([]);
  const appendCodexLog = (lines: string | string[]) => {
    const next = (Array.isArray(lines) ? lines : [lines]).filter(Boolean);
    if (!next.length) return;
    setCodexLog((log) => [...log, ...next]);
  };

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      listSpritePacks().then((next) => { if (!cancelled) setPacks(next); });
    };
    refresh();
    const unsub = subscribeSpritePacks(refresh);
    return () => { cancelled = true; unsub(); };
  }, []);

  useEffect(() => {
    if (!codex) return;
    return codex.onEvent((buddyId, event) => {
      if (buddyId !== state.id) return;
      const type = event?.type;
      if (type === 'artifact' && (event as { artifactType?: string }).artifactType === 'sprite-zip') {
        const fileName = String((event as { name?: string }).name || 'vibebud-sprite.zip');
        const base64 = String((event as { base64?: string }).base64 || '');
        void importSpriteZipBase64(fileName, base64, 'generated')
          .then((pack) => {
            update({ avatar: { kind: 'sprite', packId: pack.manifest.id } });
            setStatus(`Imported ${pack.manifest.name}.`);
            appendCodexLog(`Imported ${pack.manifest.name}.`);
            close();
          })
          .catch((e) => setError(e instanceof Error ? e.message : String(e)))
          .finally(() => setBusy(null));
      } else if (type === 'assistant_delta') {
        const text = (event as { delta?: { text?: string } }).delta?.text;
        if (text) appendCodexLog(text);
      } else if (type === 'system' && (event as { subtype?: string }).subtype === 'init') {
        const cwd = String((event as { cwd?: string }).cwd || '');
        const skillPath = String((event as { skillPath?: string }).skillPath || '');
        appendCodexLog([
          cwd ? `Codex cwd: ${cwd}` : 'Codex initialized.',
          skillPath ? `Skill: ${skillPath}` : '',
        ]);
      } else if (type === 'tool_use') {
        const name = String((event as { name?: string }).name || 'tool');
        appendCodexLog(`Running ${name}...`);
      } else if (type === 'raw') {
        const text = String((event as { text?: string }).text || '').trim();
        if (text) appendCodexLog(text);
      } else if (type === 'result') {
        appendCodexLog('Codex finished. Waiting for generated sprite ZIP...');
      } else if (type === 'closed') {
        const code = (event as { code?: number }).code;
        if (code !== 0) {
          const stderr = String((event as { stderr?: string }).stderr || '').trim();
          setError(stderr || `Codex exited with code ${code ?? '?'}.`);
          appendCodexLog(stderr || `Codex exited with code ${code ?? '?'}.`);
          setBusy(null);
        }
      } else if (type === 'error') {
        const message = String((event as { text?: string }).text || 'Codex failed.');
        setError(message);
        appendCodexLog(message);
        setBusy(null);
      }
    });
  }, [close, codex, state.id, update]);

  const usePack = (pack: InstalledSpritePack) => {
    update({ avatar: { kind: 'sprite', packId: pack.manifest.id } });
    close();
  };

  const importPack = async (file: File | null) => {
    if (!file) return;
    setError(null);
    try {
      usePack(await importSpriteZip(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const deletePack = async (pack: InstalledSpritePack) => {
    setError(null);
    try {
      await removeSpritePack(pack.manifest.id);
      if (state.avatar?.kind === 'sprite' && state.avatar.packId === pack.manifest.id) update({ avatar: undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const generateWithCodex = async () => {
    if (!codex || !prompt.trim()) return;
    setBusy('codex');
    setError(null);
    setStatus('Starting Codex sprite generation...');
    setCodexLog(['Starting Codex sprite generation...']);
    const result = await codex.start(state.id, {
      artifact: { type: 'sprite-zip', name: 'vibebud-sprite.zip' },
      skillPath: VENDORED_SKILL_PATH,
    }).catch((e) => ({ ok: false, error: String(e) }));
    if (!result.ok) {
      setError(result.error || 'Codex unavailable.');
      setCodexLog((log) => [...log, result.error || 'Codex unavailable.']);
      setBusy(null);
      return;
    }
    const artifactPath = ('artifactPath' in result && result.artifactPath) ? result.artifactPath : 'vibebud-sprite.zip';
    const skillPath = ('skillPath' in result && typeof result.skillPath === 'string' && result.skillPath) ? result.skillPath : VENDORED_SKILL_PATH;
    appendCodexLog(`Prompt sent to Codex. Output: ${artifactPath}`);
    const processorUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/sprite/process` : '/api/sprite/process';
    const text = [
      `Use the app-bundled Codex skill at ${skillPath} to generate a 2D sprite avatar.`,
      'Do not run the skill Python script. Vibebud owns processing.',
      'Do not edit Vibebud source files or inspect the processor implementation. Treat a successful processor response as the final artifact.',
      `Use the skill only to plan/prompt/generate the raw image. Generate a 4 column by 6 row sprite sheet with square cells, ideally 1024x1536 pixels. Use a solid #FF00FF magenta background only where transparency should be. Convert the generated image to a data:image URL, POST JSON { "name", "prompt", "imageDataUrl" } to ${processorUrl}, save the application/zip response bytes to the artifact path, and stop.`,
      `Avatar name: ${name.trim() || 'Custom Sprite'}.`,
      `User concept: ${prompt.trim()}.`,
      `Create a Vibebud Sprite ZIP at this exact artifact path: ${artifactPath}`,
      'The processor may return a compact ZIP with sprite-manifest.json plus preview.svg and a shared sheet.svg. Animations may all reference sheet.svg with a row index. This is valid. Do not reject it for not having separate strip files.',
      'Keep the character consistent across all actions.',
      'When the ZIP is written, do not ask the user to import it manually; the host will automatically load it as the current avatar.',
    ].join('\n');
    const sent = await codex.send(state.id, text).catch((e) => ({ ok: false, error: String(e) }));
    if (!sent.ok) {
      setError(sent.error || 'Codex did not start generation.');
      setCodexLog((log) => [...log, sent.error || 'Codex did not start generation.']);
      setBusy(null);
    }
  };

  const generateManaged = async () => {
    if (!prompt.trim()) return;
    setBusy('managed');
    setError(null);
    setStatus('Generating managed sprite...');
    try {
      const res = await fetch(`${SERVER_ORIGIN}/ai/sprite-avatar`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, prompt }),
      });
      if (res.status === 401) {
        setError('Sign in to use managed sprite generation.');
        return;
      }
      if (res.status === 402) {
        setError('Managed sprite generation requires an active paid plan.');
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      usePack(await importSpriteZip(new File([blob], 'managed-sprite.zip', { type: 'application/zip' }), 'generated'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-2 space-y-2 rounded-2xl bg-zinc-50 px-2.5 py-2 dark:bg-zinc-800/60">
      <div className="rounded-xl bg-white p-2 ring-1 ring-violet-200 dark:bg-zinc-900 dark:ring-violet-500/30">
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-violet-700 dark:text-violet-200">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-violet-600 text-[13px] leading-none text-white" aria-hidden>✦</span>
          <span>change with AI</span>
        </div>
        <div className="grid gap-1.5">
          <input value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="name" className="rounded-xl border border-zinc-200 bg-white px-2.5 py-1.5 text-[11px] text-zinc-900 outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50" />
          <textarea value={prompt} onChange={(e) => setPrompt(e.currentTarget.value)} placeholder="describe the sprite avatar" rows={3} className="rounded-xl border border-zinc-200 bg-white px-2.5 py-1.5 text-[11px] text-zinc-900 outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50" />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {codex && <button disabled={!!busy || !prompt.trim()} onClick={() => void generateWithCodex()} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-violet-700 ring-1 ring-violet-200 hover:bg-violet-50 disabled:opacity-50 dark:bg-zinc-950 dark:text-violet-200 dark:ring-violet-500/40"><span aria-hidden>✦</span>generate with Codex</button>}
          <button disabled={!!busy || !prompt.trim()} onClick={() => void generateManaged()} className="inline-flex items-center gap-1 rounded-full bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-violet-700 disabled:opacity-50"><span aria-hidden>✦</span>managed generate</button>
          {error?.startsWith('Sign in') && <button onClick={() => { void goToGoogleSignIn(); }} className="rounded-full px-2.5 py-1 text-[11px] font-medium text-violet-700 ring-1 ring-violet-200">sign in</button>}
        </div>
      </div>
      {codexLog.length > 0 && (
        <div className="max-h-28 overflow-y-auto rounded-xl bg-zinc-950 px-2 py-1.5 text-[10px] leading-4 text-zinc-100 ring-1 ring-zinc-800">
          {codexLog.map((line, index) => (
            <p key={index} className="whitespace-pre-wrap break-words">{line}</p>
          ))}
        </div>
      )}
      <div className="grid gap-1.5">
        <label className="cursor-pointer rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-violet-700 ring-1 ring-violet-200 hover:bg-violet-50 dark:bg-zinc-900 dark:text-violet-200 dark:ring-violet-500/40 dark:hover:bg-violet-500/10">
          import sprite zip
          <input type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => { void importPack(e.currentTarget.files?.[0] ?? null); e.currentTarget.value = ''; }} />
        </label>
      </div>
      {status && <p className="rounded-xl bg-white px-2 py-1 text-[11px] text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">{status}</p>}
      {error && <p className="rounded-xl bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {packs.map((pack) => {
          const selected = state.avatar?.kind === 'sprite' && state.avatar.packId === pack.manifest.id;
          return (
            <div key={pack.manifest.id} className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium ${selected ? 'bg-violet-600 text-white' : 'bg-white text-zinc-700 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-700'}`}>
              <button onClick={() => usePack(pack)} className="flex min-w-0 items-center gap-1.5" title={`${pack.manifest.name} · ${pack.manifest.license}`}>
                <span className="block h-5 w-5 overflow-hidden rounded-full bg-zinc-100" style={{ backgroundImage: `url("${resolveSpriteAsset(pack, pack.manifest.preview)}")`, backgroundSize: 'cover', backgroundPosition: 'center' }} aria-hidden />
                <span className="truncate">{pack.manifest.name}</span>
              </button>
              <button data-buddy-interactive onClick={(e) => { e.stopPropagation(); void deletePack(pack); }} className={`ml-0.5 rounded-full px-1 text-[12px] leading-4 ${selected ? 'text-white/90 hover:bg-white/15' : 'text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10'}`}>x</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
