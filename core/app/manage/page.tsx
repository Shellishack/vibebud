'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { VARIANTS, cssColor } from '../components/avatars';
import {
  usePersonalities,
  addCustomPersonality,
  updateCustomPersonality,
  removeCustomPersonality,
  type Personality,
} from '../components/personalities';

type DraftPersonality = {
  variantId?: string;
  name: string;
  role: string;
  colorId: string;
  greeting: string;
  systemPrompt: string;
};

const blankDraft = (): DraftPersonality => ({
  name: '',
  role: '',
  colorId: VARIANTS[0].id,
  greeting: '',
  systemPrompt: '',
});

export default function ManagePage() {
  const personalities = usePersonalities();
  const [editing, setEditing] = useState<DraftPersonality | null>(null);

  const builtIns = useMemo(() => personalities.filter((p) => p.builtIn), [personalities]);
  const customs = useMemo(() => personalities.filter((p) => !p.builtIn), [personalities]);

  const startCreate = () => setEditing(blankDraft());
  const startEdit = (p: Personality) => setEditing({
    variantId: p.variantId,
    name: p.name,
    role: p.role,
    colorId: p.colorId,
    greeting: p.greeting,
    systemPrompt: p.systemPrompt,
  });
  const cancel = () => setEditing(null);

  const save = () => {
    if (!editing) return;
    const draft = editing;
    if (!draft.name.trim()) return;
    if (draft.variantId) {
      updateCustomPersonality(draft.variantId, {
        name: draft.name.trim(),
        role: draft.role.trim(),
        colorId: draft.colorId,
        greeting: draft.greeting.trim(),
        systemPrompt: draft.systemPrompt.trim(),
      });
    } else {
      addCustomPersonality({
        name: draft.name.trim(),
        role: draft.role.trim(),
        colorId: draft.colorId,
        greeting: draft.greeting.trim(),
        systemPrompt: draft.systemPrompt.trim(),
        replies: [],
      });
    }
    setEditing(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-violet-50 to-fuchsia-50 font-sans dark:from-zinc-950 dark:via-violet-950/30 dark:to-zinc-950">
      <main className="mx-auto max-w-4xl px-6 py-12">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <Link href="/" className="text-xs text-violet-700 hover:underline dark:text-violet-300">← back</Link>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">manage avatars</h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              the personalities your buddies can wear. spawn one from the floating buddy menu, or create a custom one below.
            </p>
          </div>
          <button
            onClick={startCreate}
            className="rounded-full bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-700"
          >
            + new avatar
          </button>
        </div>

        <Section title="built-in" subtitle="six hand-tuned personalities, always available">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {builtIns.map((p) => <PersonalityCard key={p.variantId} personality={p} />)}
          </div>
        </Section>

        <Section title="custom" subtitle={customs.length === 0 ? 'no custom avatars yet — create one to get started' : 'your custom avatars'}>
          {customs.length === 0 ? (
            <button
              onClick={startCreate}
              className="w-full rounded-2xl border-2 border-dashed border-zinc-300 bg-white/40 p-8 text-sm text-zinc-500 transition-colors hover:border-violet-300 hover:text-violet-700 dark:border-zinc-700 dark:bg-zinc-900/40 dark:hover:border-violet-500/50 dark:hover:text-violet-300"
            >
              create your first custom avatar
            </button>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {customs.map((p) => (
                <PersonalityCard
                  key={p.variantId}
                  personality={p}
                  onEdit={() => startEdit(p)}
                  onDelete={() => {
                    if (confirm(`Delete "${p.name}"? Existing buddies using it will fall back to a built-in.`)) {
                      removeCustomPersonality(p.variantId);
                    }
                  }}
                />
              ))}
            </div>
          )}
        </Section>
      </main>

      {editing && (
        <EditorModal
          draft={editing}
          onChange={setEditing}
          onCancel={cancel}
          onSave={save}
        />
      )}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</span>
      </div>
      {children}
    </section>
  );
}

function PersonalityCard({
  personality,
  onEdit,
  onDelete,
}: {
  personality: Personality;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const variant = VARIANTS.find((v) => v.id === personality.colorId) ?? VARIANTS[0];
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 backdrop-blur transition-colors hover:border-violet-300 dark:border-zinc-800 dark:bg-zinc-900/70 dark:hover:border-violet-500/40">
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 h-10 w-10 shrink-0 rounded-full ring-2 ring-white shadow-sm dark:ring-zinc-800"
          style={{ background: cssColor(variant.body) }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">{personality.name}</p>
            {personality.builtIn && (
              <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">built-in</span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{personality.role || 'no role'}</p>
          {personality.greeting && (
            <p className="mt-2 text-xs italic leading-relaxed text-zinc-600 dark:text-zinc-300">“{personality.greeting}”</p>
          )}
          {personality.systemPrompt && (
            <details className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
              <summary className="cursor-pointer select-none text-violet-700 hover:underline dark:text-violet-300">system prompt</summary>
              <p className="mt-1 whitespace-pre-wrap leading-relaxed">{personality.systemPrompt}</p>
            </details>
          )}
        </div>
      </div>
      {(onEdit || onDelete) && (
        <div className="mt-3 flex justify-end gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          {onEdit && (
            <button onClick={onEdit} className="rounded-full px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">edit</button>
          )}
          {onDelete && (
            <button onClick={onDelete} className="rounded-full px-3 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10">delete</button>
          )}
        </div>
      )}
    </div>
  );
}

function EditorModal({
  draft,
  onChange,
  onCancel,
  onSave,
}: {
  draft: DraftPersonality;
  onChange: (next: DraftPersonality) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const isNew = !draft.variantId;
  const set = (patch: Partial<DraftPersonality>) => onChange({ ...draft, ...patch });
  const canSave = draft.name.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {isNew ? 'new avatar' : `edit ${draft.name || 'avatar'}`}
        </h2>

        <div className="mt-5 space-y-4 text-sm">
          <Field label="name">
            <input
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="e.g. Mentor"
              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
            />
          </Field>

          <Field label="role">
            <input
              value={draft.role}
              onChange={(e) => set({ role: e.target.value })}
              placeholder="e.g. patient code reviewer"
              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
            />
          </Field>

          <Field label="color">
            <div className="flex flex-wrap gap-2">
              {VARIANTS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => set({ colorId: v.id })}
                  title={v.name}
                  aria-label={`Use ${v.name}`}
                  className={`h-8 w-8 rounded-full ring-2 ring-offset-2 transition-transform hover:scale-110 dark:ring-offset-zinc-900 ${
                    v.id === draft.colorId ? 'ring-zinc-900 dark:ring-white' : 'ring-transparent'
                  }`}
                  style={{ background: cssColor(v.body) }}
                />
              ))}
            </div>
          </Field>

          <Field label="greeting" hint="first message the buddy says when chat opens">
            <input
              value={draft.greeting}
              onChange={(e) => set({ greeting: e.target.value })}
              placeholder="hi! I'm…"
              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
            />
          </Field>

          <Field label="system prompt" hint="instructions sent to the LLM on every message">
            <textarea
              value={draft.systemPrompt}
              onChange={(e) => set({ systemPrompt: e.target.value })}
              rows={6}
              placeholder="You are…"
              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm leading-relaxed text-zinc-900 outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
            />
          </Field>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-full px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            cancel
          </button>
          <button
            onClick={onSave}
            disabled={!canSave}
            className="rounded-full bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isNew ? 'create' : 'save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">{label}</span>
        {hint && <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{hint}</span>}
      </div>
      {children}
    </label>
  );
}
