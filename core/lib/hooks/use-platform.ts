'use client';

import { useEffect, useState } from 'react';
import { getAdapter, getLayout } from '@/lib/platform';

export function usePlatform() {
  const [adapter, setAdapter] = useState(() => getAdapter('ssr'));
  useEffect(() => { setAdapter(getAdapter()); }, []);
  return adapter;
}

export function useLayout() {
  const [layout, setLayout] = useState(() => getLayout('ssr'));
  useEffect(() => { setLayout(getLayout()); }, []);
  return layout;
}
