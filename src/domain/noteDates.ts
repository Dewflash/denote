// src/domain/noteDates.ts — note-dates precedence for timelines/Today view (S26). PURE.
// created = frontmatter `created`/`date` if parseable, else file birthtime; edited = mtime.
// This is the ONE util documenting that precedence — nothing else should re-derive it.

export interface NoteDates {
  created: number; // epoch ms
  edited: number; // epoch ms
}

function parseFrontmatterDate(value: unknown): number | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/**
 * `frontmatter` is user frontmatter only (never the `ai:` namespace). `btime`/`mtime` are
 * epoch ms from the filesystem (S26's fallback for `created`, and always the source for
 * `edited`).
 */
export function computeNoteDates(
  frontmatter: Record<string, unknown>,
  btime: number,
  mtime: number,
): NoteDates {
  const fromFrontmatter =
    parseFrontmatterDate(frontmatter.created) ?? parseFrontmatterDate(frontmatter.date);
  return { created: fromFrontmatter ?? btime, edited: mtime };
}

/** True if `at` (epoch ms) falls on the same local calendar day as `now` (epoch ms). */
export function isSameLocalDay(at: number, now: number): boolean {
  const a = new Date(at);
  const b = new Date(now);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
