import { fuzzyScore } from './fuzzy';
import type { LauncherTarget } from './types';

export type CandidateKind = 'tab' | 'entry' | 'archived' | 'bookmark' | 'history';

export interface Candidate {
  kind: CandidateKind;
  title: string;
  url: string;
  target: LauncherTarget;
  /** Small extra weight within a kind, e.g. history visit count or recency. */
  bonus?: number;
}

export interface Ranked extends Candidate {
  score: number;
}

const KIND_BOOST: Record<CandidateKind, number> = {
  tab: 300,
  entry: 250,
  archived: 80,
  bookmark: 100,
  history: 50,
};

/** Above this, the top result is a confident match and should beat "Search for …". */
export const CONFIDENT_SCORE = 1000;

export function rank(query: string, candidates: Candidate[], limit = 9): Ranked[] {
  const byUrl = new Map<string, Ranked>();
  for (const c of candidates) {
    const textScore = Math.max(fuzzyScore(query, c.title), fuzzyScore(query, c.url) * 0.8);
    if (textScore < 0) continue;
    const score = textScore + KIND_BOOST[c.kind] + Math.min(c.bonus ?? 0, 100);
    const existing = byUrl.get(c.url);
    // Same URL from several sources: keep the most actionable kind (an open tab beats history).
    if (!existing || KIND_BOOST[c.kind] > KIND_BOOST[existing.kind]) {
      byUrl.set(c.url, { ...c, score: Math.max(score, existing?.score ?? 0) });
    }
  }
  return [...byUrl.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
