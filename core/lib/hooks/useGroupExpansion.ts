'use client';

import type { Dispatch, SetStateAction } from 'react';

type Options = {
  setPeeked: Dispatch<SetStateAction<Record<string, boolean>>>;
  setExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
};

export function useGroupExpansion({ setPeeked, setExpanded }: Options) {
  const onGroupTap = (gid: string) => {
    setPeeked((cur) => ({ ...cur, [gid]: true }));
    setExpanded((cur) => {
      const next: Record<string, boolean> = {};
      for (const key of Object.keys(cur)) if (key !== gid) next[key] = false;
      next[gid] = true;
      return next;
    });
  };

  const onGroupTapCollapse = (gid: string) => {
    setExpanded((cur) => (cur[gid] ? { ...cur, [gid]: false } : cur));
    setPeeked((cur) => (cur[gid] ? { ...cur, [gid]: false } : cur));
  };

  const collapseAllGroups = () => {
    setExpanded((cur) => {
      if (!Object.values(cur).some(Boolean)) return cur;
      const next: Record<string, boolean> = {};
      for (const key of Object.keys(cur)) next[key] = false;
      return next;
    });
    setPeeked((cur) => {
      if (!Object.values(cur).some(Boolean)) return cur;
      const next: Record<string, boolean> = {};
      for (const key of Object.keys(cur)) next[key] = false;
      return next;
    });
  };

  return { onGroupTap, onGroupTapCollapse, collapseAllGroups };
}
