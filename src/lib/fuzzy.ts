/**
 * Scores `text` against `query` as a case-insensitive subsequence match.
 * Returns -1 for no match; higher is better. Contiguous runs, word starts,
 * and early matches score higher.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const t = text.toLowerCase();

  const substring = t.indexOf(q);
  if (substring >= 0) {
    const atWordStart = substring === 0 || /[\s/._-]/.test(t[substring - 1]);
    return 1000 - substring + (atWordStart ? 200 : 0) + q.length * 10;
  }

  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    run = found === ti ? run + 1 : 0;
    const atWordStart = found === 0 || /[\s/._-]/.test(t[found - 1]);
    score += 1 + run * 3 + (atWordStart ? 5 : 0);
    ti = found + 1;
  }
  return score;
}
