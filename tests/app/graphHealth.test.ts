import { describe, expect, it } from 'vitest';
import { deriveGraphHealth } from '../../src/app/graphHealth';
import type { ParsedNote } from '../../src/domain/types';

function note(relPath: string, title = relPath): ParsedNote {
  return { relPath, title, frontmatter: {}, aiFrontmatter: null, headings: [], links: [], tags: [], warnings: [], bodyText: '' };
}

describe('status-bar graph health', () => {
  it('keeps truly isolated notes and each unresolved link discoverable', () => {
    const links = [
      { fromPath: 'a.md', link: { targetTitle: 'Missing', embed: false, offsetStart: 1, offsetEnd: 10 }, resolution: { kind: 'ghost', id: 'ghost:v/missing' } },
      { fromPath: 'b.md', link: { targetTitle: 'a', embed: false, offsetStart: 1, offsetEnd: 5 }, resolution: { kind: 'note', relPath: 'a.md', matchType: 'filename' } },
    ] as const;
    const result = deriveGraphHealth([note('a.md', 'A'), note('b.md', 'B'), note('c.md', 'Lonely')], links);
    expect(result.orphans).toEqual([{ relPath: 'c.md', title: 'Lonely' }]);
    expect(result.unresolvedLinks).toEqual([{ fromPath: 'a.md', target: 'Missing', id: 'a.md:1:10' }]);
  });
});
