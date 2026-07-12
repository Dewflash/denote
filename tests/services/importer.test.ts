import { describe, expect, it } from 'vitest';
import { planImport, mapObsidianRelPath } from '../../src/services/importer';

describe('import planner', () => {
  it('skips exact duplicates by contentHash', () => {
    const plan = planImport(
      [{ relPath: 'a.md', content: '# A\nsame body' }],
      [{ relPath: 'incoming/a.md', content: '# A\nsame body' }],
    );

    expect(plan.exactSkipped).toBe(1);
    expect(plan.items[0]?.decision).toBe('skip-exact');
    expect(plan.items[0]?.duplicateOf).toBe('a.md');
  });

  it('flags near duplicates for review', () => {
    const plan = planImport(
      [{ relPath: 'bank.md', content: '# Bank\npolicy rates currency reserves intervention liquidity liquidity policy rates reserves intervention currency outlook central bank swaps' }],
      [{ relPath: 'copy.md', content: '# Bank copy\npolicy rates currency reserves intervention liquidity liquidity policy rates reserves intervention currency outlook central bank swaps' }],
    );

    expect(plan.nearReview).toBe(1);
    expect(plan.items[0]?.decision).toBe('review-near');
  });

  it('warns on reserved ai frontmatter and ignores .obsidian', () => {
    const plan = planImport([], [{ relPath: 'x.md', content: '---\nai:\n  tags: [x]\n---\n# X' }]);

    expect(plan.items[0]?.decision).toBe('warn-ai-key');
    expect(plan.warnings[0]).toContain('reserved top-level ai');
    expect(mapObsidianRelPath('.obsidian/plugins/foo.md')).toBeNull();
    expect(mapObsidianRelPath('Folder/Note.txt')).toBe('Folder/Note.md');
  });
});
