import { describe, expect, it } from 'vitest';
import { computeNoteDates, isSameLocalDay } from '../../src/domain/noteDates';

describe('computeNoteDates (S26)', () => {
  const btime = 1_000;
  const mtime = 2_000;

  it('falls back to btime when no frontmatter date', () => {
    expect(computeNoteDates({}, btime, mtime)).toEqual({ created: btime, edited: mtime });
  });

  it('prefers frontmatter `created` (string) over btime', () => {
    const iso = '2026-01-02T03:04:05.000Z';
    expect(computeNoteDates({ created: iso }, btime, mtime).created).toBe(Date.parse(iso));
  });

  it('falls back to frontmatter `date` when `created` is absent', () => {
    const iso = '2026-01-02T03:04:05.000Z';
    expect(computeNoteDates({ date: iso }, btime, mtime).created).toBe(Date.parse(iso));
  });

  it('accepts a yaml-parsed Date instance', () => {
    const d = new Date('2026-05-06T00:00:00.000Z');
    expect(computeNoteDates({ created: d }, btime, mtime).created).toBe(d.getTime());
  });

  it('ignores an unparseable frontmatter date and falls back to btime', () => {
    expect(computeNoteDates({ created: 'not-a-date' }, btime, mtime).created).toBe(btime);
  });

  it('edited is always mtime', () => {
    expect(computeNoteDates({ created: '2026-01-01' }, btime, mtime).edited).toBe(mtime);
  });
});

describe('isSameLocalDay', () => {
  it('true for the same calendar day', () => {
    const now = new Date(2026, 5, 15, 10, 0, 0).getTime();
    const earlier = new Date(2026, 5, 15, 0, 1, 0).getTime();
    expect(isSameLocalDay(earlier, now)).toBe(true);
  });

  it('false across a day boundary', () => {
    const now = new Date(2026, 5, 15, 0, 0, 1).getTime();
    const yesterday = new Date(2026, 5, 14, 23, 59, 0).getTime();
    expect(isSameLocalDay(yesterday, now)).toBe(false);
  });
});
