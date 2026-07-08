import { describe, expect, it } from 'vitest';
import { parseNote } from '../../src/domain/parser';
import { buildLinkIndex } from '../../src/domain/links';
import { computeBacklinks } from '../../src/domain/backlinks';

const V = 'vault-1';

describe('backlinks (D5 — computed, never stored)', () => {
  it('reverses the resolved link index; ghosts produce no backlinks', () => {
    const notes = [
      parseNote('Japan/Japan.md', '# Japan\n\n[[Yen Intervention]] and [[Bank of Japan]].'),
      parseNote('Economics/Interest Rates.md', '# Interest Rates\n\n[[Yen Intervention]] again.'),
      parseNote('Japan/Yen Intervention.md', '# Yen Intervention\n\nno outbound.'),
    ];
    const index = buildLinkIndex(notes, V);
    const back = computeBacklinks(index);

    const yen = back.get('Japan/Yen Intervention.md') ?? [];
    expect(yen.map((b) => b.fromPath)).toEqual(['Economics/Interest Rates.md', 'Japan/Japan.md']);
    // 'Bank of Japan' is a ghost → no entry
    expect(back.has('Bank of Japan')).toBe(false);
  });

  it('keeps the WikiLink (alias preserved) on the backlink', () => {
    const notes = [
      parseNote('a.md', '# A\n\n[[Interest Rates|rates]]'),
      parseNote('Interest Rates.md', '# Interest Rates\n'),
    ];
    const back = computeBacklinks(buildLinkIndex(notes, V));
    const entry = back.get('Interest Rates.md')?.[0];
    expect(entry?.link.alias).toBe('rates');
    expect(entry?.fromPath).toBe('a.md');
  });
});
