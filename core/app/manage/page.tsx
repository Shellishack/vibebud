'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from '../../lib/hooks/use-translations';
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
  const { t } = useTranslations();
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
            <Link href="/" className="text-xs text-violet-700 hover:underline dark:text-violet-300">{t('manage.back')}</Link>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{t('manage.title')}</h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {t('manage.description')}
            </p>
          </div>
          <button
            onClick={startCreate}
            className="rounded-full bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-700"
          >
            {t('manage.newAvatar')}
          </button>
        </div>

        <Section title={t('manage.builtInTitle')} subtitle={t('manage.builtInSubtitle')}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {builtIns.map((p) => <PersonalityCard key={p.variantId} personality={p} />)}
          </div>
        </Section>

        <Section title={t('manage.customTitle')} subtitle={customs.length === 0 ? t('manage.customEmptySubtitle') : t('manage.customSubtitle')}>
          {customs.length === 0 ? (
            <button
              onClick={startCreate}
              className="w-full rounded-2xl border-2 border-dashed border-zinc-300 bg-white/40 p-8 text-sm text-zinc-500 transition-colors hover:border-violet-300 hover:text-violet-700 dark:border-zinc-700 dark:bg-zinc-900/40 dark:hover:border-violet-500/50 dark:hover:text-violet-300"
            >
              {t('manage.createFirstCustom')}
            </button>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {customs.map((p) => (
                <PersonalityCard
                  key={p.variantId}
                  personality={p}
                  onEdit={() => startEdit(p)}
                  onDelete={() => {
                    if (confirm(t('manage.deleteConfirm', { name: p.name }))) {
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
  const { t } = useTranslations();
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
              <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{t('manage.builtInBadge')}</span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{personality.role || t('manage.noRole')}</p>
          {personality.greeting && (
            <p className="mt-2 text-xs italic leading-relaxed text-zinc-600 dark:text-zinc-300">“{personality.greeting}”</p>
          )}
          {personality.systemPrompt && (
            <details className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
              <summary className="cursor-pointer select-none text-violet-700 hover:underline dark:text-violet-300">{t('manage.systemPrompt')}</summary>
              <p className="mt-1 whitespace-pre-wrap leading-relaxed">{personality.systemPrompt}</p>
            </details>
          )}
        </div>
      </div>
      {(onEdit || onDelete) && (
        <div className="mt-3 flex justify-end gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          {onEdit && (
            <button onClick={onEdit} className="rounded-full px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">{t('manage.edit')}</button>
          )}
          {onDelete && (
            <button onClick={onDelete} className="rounded-full px-3 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10">{t('manage.delete')}</button>
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
  const { t } = useTranslations();
  const isNew = !draft.variantId;
  const set = (patch: Partial<DraftPersonality>) => onChange({ ...draft, ...patch });
  const canSave = draft.name.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {isNew ? t('manage.modalNewTitle') : t('manage.modalEditTitle', { name: draft.name || t('manage.avatarFallback') })}
        </h2>

        <div className="mt-5 space-y-4 text-sm">
          <Field label={t('manage.fields.name')}>
            <input
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder={t('manage.fields.namePlaceholder')}
              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
            />
          </Field>

          <Field label={t('manage.fields.role')}>
            <input
              value={draft.role}
              onChange={(e) => set({ role: e.target.value })}
              placeholder={t('manage.fields.rolePlaceholder')}
              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
            />
          </Field>

          <Field label={t('manage.fields.color')}>
            <div className="flex flex-wrap gap-2">
              {VARIANTS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => set({ colorId: v.id })}
                  title={v.name}
                  aria-label={t('manage.fields.useColor', { name: v.name })}
                  className={`h-8 w-8 rounded-full ring-2 ring-offset-2 transition-transform hover:scale-110 dark:ring-offset-zinc-900 ${
                    v.id === draft.colorId ? 'ring-zinc-900 dark:ring-white' : 'ring-transparent'
                  }`}
                  style={{ background: cssColor(v.body) }}
                />
              ))}
            </div>
          </Field>

          <Field label={t('manage.fields.greeting')} hint={t('manage.fields.greetingHint')}>
            <input
              value={draft.greeting}
              onChange={(e) => set({ greeting: e.target.value })}
              placeholder={t('manage.fields.greetingPlaceholder')}
              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
            />
          </Field>

          <Field label={t('manage.fields.systemPrompt')} hint={t('manage.fields.systemPromptHint')}>
            <textarea
              value={draft.systemPrompt}
              onChange={(e) => set({ systemPrompt: e.target.value })}
              rows={6}
              placeholder={t('manage.fields.systemPromptPlaceholder')}
              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm leading-relaxed text-zinc-900 outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
            />
          </Field>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-full px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {t('manage.cancel')}
          </button>
          <button
            onClick={onSave}
            disabled={!canSave}
            className="rounded-full bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isNew ? t('manage.create') : t('manage.save')}
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
