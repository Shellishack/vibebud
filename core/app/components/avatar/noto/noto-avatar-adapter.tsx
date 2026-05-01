'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { buildAnimation, getNotoCodepoint, NOTO_GROUPS, sampleFacesWithHands, VARIANTS, type FacesWithHandsComposition, type NotoGroup } from '../../avatars';
import { getCachedLottie, loadLottie } from '@/lib/noto-emoji';
import type { AvatarAdapter } from '../types';

const Lottie = dynamic(() => import('lottie-react'), { ssr: false });

export const notoAvatarAdapter: AvatarAdapter = {
  category: 'noto',
  label: 'Noto',
  matches: (state) => state.avatar?.kind === 'noto',
  useRuntime: ({ state, personality, emotion, onChange }) => {
    const [fetched, setFetched] = useState<Record<string, unknown>>({});
    const variant = VARIANTS.find((v) => v.id === personality.colorId) ?? VARIANTS[0];
    const avatar = state.avatar?.kind === 'noto' ? state.avatar : null;
    const fallbackAnimation = useMemo(
      () => (avatar ? buildAnimation(variant, emotion) : null),
      [avatar, emotion, variant],
    );
    const isComposite = avatar?.group === 'facesWithHands';
    const composition = isComposite ? avatar?.composition : undefined;
    const notoCp = avatar && !isComposite ? getNotoCodepoint(avatar.group, emotion) : null;
    const notoData = notoCp ? (fetched[notoCp] ?? getCachedLottie(notoCp)) : null;

    useEffect(() => {
      if (!notoCp || notoData) return;
      let cancelled = false;
      loadLottie(notoCp)
        .then((data) => { if (!cancelled) setFetched((cur) => ({ ...cur, [notoCp]: data })); })
        .catch(() => {});
      return () => { cancelled = true; };
    }, [notoCp, notoData]);

    useEffect(() => {
      if (state.avatar?.kind !== 'noto' || state.avatar.group !== 'facesWithHands') return;
      const next = sampleFacesWithHands(emotion);
      onChange({ ...state, avatar: { ...state.avatar, composition: next } });
      for (const cp of [next.face, next.lh, next.lhItem, next.rh, next.rhItem]) {
        if (cp) void loadLottie(cp).catch(() => {});
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [emotion, avatar?.group, state.avatar?.kind]);

    useEffect(() => {
      if (!composition) return;
      const cps = [composition.face, composition.lh, composition.lhItem, composition.rh, composition.rhItem]
        .filter((cp): cp is string => !!cp);
      let cancelled = false;
      for (const cp of cps) {
        if (fetched[cp] || getCachedLottie(cp)) continue;
        loadLottie(cp)
          .then((data) => { if (!cancelled) setFetched((cur) => ({ ...cur, [cp]: data })); })
          .catch(() => {});
      }
      return () => { cancelled = true; };
    }, [composition, fetched]);

    const animation = notoData ? (notoData as object) : fallbackAnimation;
    return {
      visual: isComposite && composition
        ? <CompositeFace composition={composition} fetched={fetched} />
        : animation ? <Lottie animationData={animation} loop autoplay /> : null,
      accessories: isComposite && composition
        ? <CompositeHands composition={composition} fetched={fetched} />
        : undefined,
      isMoving: false,
    };
  },
  Picker: ({ state, emotion, update, close }) => (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-2xl bg-zinc-50 px-2.5 py-2 dark:bg-zinc-800/60">
      {(Object.keys(NOTO_GROUPS) as NotoGroup[]).map((group) => {
        const cfg = NOTO_GROUPS[group];
        const selected = state.avatar?.kind === 'noto' && state.avatar.group === group;
        return (
          <button
            key={group}
            onClick={() => {
              void loadLottie(cfg.default).catch(() => {});
              if (group === 'facesWithHands') {
                update({ avatar: { kind: 'noto', group, composition: sampleFacesWithHands(emotion) } });
              } else {
                update({ avatar: { kind: 'noto', group } });
              }
              close();
            }}
            title={cfg.label}
            aria-label={`Use ${cfg.label} emoji family`}
            className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium transition-colors ${
              selected
                ? 'bg-violet-600 text-white'
                : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-800'
            }`}
          >
            <span className="text-base leading-none" aria-hidden>{cpToGlyph(cfg.preview)}</span>
            <span>{cfg.label}</span>
          </button>
        );
      })}
    </div>
  ),
};

function CompositeFace({ composition, fetched }: { composition: FacesWithHandsComposition; fetched: Record<string, unknown> }) {
  const data = composition.face
    ? ((fetched[composition.face] ?? getCachedLottie(composition.face)) as object | null)
    : null;
  if (!data) return null;
  return <Lottie animationData={data} loop autoplay />;
}

function CompositeHands({ composition, fetched }: { composition: FacesWithHandsComposition; fetched: Record<string, unknown> }) {
  const dataFor = (cp: string | undefined) =>
    cp ? ((fetched[cp] ?? getCachedLottie(cp)) as object | null) : null;
  const handSize = '4.25rem';
  const itemSize = '3.5rem';
  const Slot = ({ data, size }: { data: object | null; size: string }) =>
    data ? (
      <div style={{ width: size, height: size }} className="aspect-square shrink-0">
        <Lottie animationData={data} loop autoplay />
      </div>
    ) : null;
  return (
    <>
      {(composition.lh || composition.lhItem) && (
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 flex items-center"
          style={{ right: '100%', gap: '4px', paddingRight: '2px' }}
        >
          <Slot data={dataFor(composition.lhItem)} size={itemSize} />
          <Slot data={dataFor(composition.lh)} size={handSize} />
        </div>
      )}
      {(composition.rh || composition.rhItem) && (
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 flex items-center"
          style={{ left: '100%', gap: '4px', paddingLeft: '2px' }}
        >
          <Slot data={dataFor(composition.rh)} size={handSize} />
          <Slot data={dataFor(composition.rhItem)} size={itemSize} />
        </div>
      )}
    </>
  );
}

function cpToGlyph(cp: string): string {
  try {
    return cp.split('_').map((part) => String.fromCodePoint(parseInt(part, 16))).join('');
  } catch {
    return '';
  }
}
