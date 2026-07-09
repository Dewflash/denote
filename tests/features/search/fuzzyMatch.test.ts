import { describe, expect, it } from 'vitest';
import { fuzzyMatch } from '../../../src/features/search/fuzzyMatch';

describe('fuzzyMatch', () => {
  it('matches a subsequence case-insensitively', () => {
    expect(fuzzyMatch('yint', 'Yen Intervention')).not.toBeNull();
    expect(fuzzyMatch('YINT', 'yen intervention')).not.toBeNull();
  });

  it('returns null when characters are out of order or missing', () => {
    expect(fuzzyMatch('zzz', 'Yen Intervention')).toBeNull();
    expect(fuzzyMatch('tney', 'Yen Intervention')).toBeNull(); // out of order
  });

  it('empty query matches everything with score 0', () => {
    expect(fuzzyMatch('', 'anything')).toBe(0);
  });

  it('scores an earlier / more-consecutive match higher', () => {
    const early = fuzzyMatch('jap', 'Japan')!;
    const late = fuzzyMatch('jap', 'xxxxxJapan')!;
    expect(early).toBeGreaterThan(late);

    const consecutive = fuzzyMatch('abc', 'abcxyz')!;
    const scattered = fuzzyMatch('abc', 'axbxcx')!;
    expect(consecutive).toBeGreaterThan(scattered);
  });
});
