// src/features/search/fuzzyMatch.ts — PURE lightweight subsequence fuzzy matcher (fzf/Obsidian
// quick-switcher style) for jumping to a note by title. This is deliberately separate from
// MiniSearch (services/searchIndex.ts): the quick switcher wants "characters typed in order,
// anywhere in the title," not tokenized full-text ranking — a different UX for a different job
// (cmd-O jump vs cmd-shift-F search), so no new dependency is pulled in for it.

/** Case-insensitive subsequence match: every character of `query`, in order, somewhere in
 *  `target`. Returns a score (higher = better; earlier and more-consecutive matches score
 *  higher) or `null` if `query` isn't a subsequence of `target`. Empty query matches everything
 *  with score 0. */
export function fuzzyMatch(query: string, target: string): number | null {
  if (query === '') return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let consecutive = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 10 + consecutive * 5 - ti * 0.1;
      consecutive += 1;
      qi += 1;
    } else {
      consecutive = 0;
    }
  }
  return qi === q.length ? score : null;
}
