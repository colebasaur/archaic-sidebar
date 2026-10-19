import type { TabMeta } from './types';

export interface TabLike {
  id?: number;
  index: number;
}

/** Unbound tabs for the Today section, newest first. */
export function todayTabs<T extends TabLike>(
  tabs: T[],
  bindings: Record<string, number>,
  tabMeta: Record<number, TabMeta>,
): T[] {
  const bound = new Set(Object.values(bindings));
  const created = (t: T) => (t.id === undefined ? 0 : (tabMeta[t.id]?.createdAt ?? 0));
  return tabs
    .filter((t) => t.id !== undefined && !bound.has(t.id))
    .sort((a, b) => created(b) - created(a) || b.index - a.index);
}
