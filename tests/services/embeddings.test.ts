// Pure embedding-bridge helpers (S14 incremental plan + embed-text builder).
import { describe, expect, it } from 'vitest';
import {
  computeEmbedPlan,
  embedTextForNote,
  type EmbeddingIndex,
} from '../../src/services/embeddings';

const MODEL = 'intfloat/multilingual-e5-small';

function index(rows: { relPath: string; contentHash: string }[], model = MODEL): EmbeddingIndex {
  return {
    version: 1,
    model,
    dim: 384,
    rows: rows.map((r, i) => ({ row: i, ...r })),
    free: [],
  };
}

describe('computeEmbedPlan (S14 incremental)', () => {
  it('embeds only notes whose (relPath, hash) is absent', () => {
    const idx = index([
      { relPath: 'a.md', contentHash: 'h1' },
      { relPath: 'b.md', contentHash: 'h2' },
    ]);
    const plan = computeEmbedPlan(
      idx,
      [
        { relPath: 'a.md', contentHash: 'h1' }, // unchanged
        { relPath: 'b.md', contentHash: 'h2b' }, // edited
        { relPath: 'c.md', contentHash: 'h3' }, // new
      ],
      MODEL,
    );
    expect(plan.modelChanged).toBe(false);
    expect(plan.toEmbed.map((e) => e.relPath).sort()).toEqual(['b.md', 'c.md']);
    expect(plan.toRemove).toEqual([]); // a and b still wanted
  });

  it('drops stored notes no longer present', () => {
    const idx = index([
      { relPath: 'a.md', contentHash: 'h1' },
      { relPath: 'gone.md', contentHash: 'hx' },
    ]);
    const plan = computeEmbedPlan(idx, [{ relPath: 'a.md', contentHash: 'h1' }], MODEL);
    expect(plan.toRemove).toEqual(['gone.md']);
    expect(plan.toEmbed).toEqual([]);
  });

  it('invalidates the entire store on model change (S14 mismatch)', () => {
    const idx = index([{ relPath: 'a.md', contentHash: 'h1' }], 'old-model');
    const plan = computeEmbedPlan(idx, [{ relPath: 'a.md', contentHash: 'h1' }], MODEL);
    expect(plan.modelChanged).toBe(true);
    expect(plan.toEmbed.map((e) => e.relPath)).toEqual(['a.md']); // re-embed everything
  });

  it('treats an empty store as "embed all", not a model change', () => {
    const plan = computeEmbedPlan(index([], ''), [{ relPath: 'a.md', contentHash: 'h1' }], MODEL);
    expect(plan.modelChanged).toBe(false);
    expect(plan.toEmbed).toHaveLength(1);
  });
});

describe('embedTextForNote', () => {
  it('leads with the title then the body, capped', () => {
    const out = embedTextForNote({ title: 'Yen', bodyText: 'BOJ intervened in the market.' });
    expect(out.startsWith('Yen')).toBe(true);
    expect(out).toContain('BOJ intervened');
  });
  it('is just the title when the body is empty', () => {
    expect(embedTextForNote({ title: 'Solo', bodyText: '' })).toBe('Solo');
  });
});
