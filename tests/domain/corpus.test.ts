// Corpus assembly (S27/D12): item priority ordering, skip rules, budget trimming.
import { describe, expect, it } from 'vitest';
import {
  buildBatchItems,
  estimateCorpus,
  trimToBudget,
  type AssembledCorpus,
  type BatchItemSpec,
} from '../../src/domain/corpus';

function corpus(): AssembledCorpus {
  return {
    notes: [
      { vaultId: 'v', relPath: 'Finance/Japan/BOJ.md', title: 'BOJ Intervention', folder: 'Finance/Japan', summary: 'BOJ policy', stale: true, enriched: true },
      { vaultId: 'v', relPath: 'Finance/Gold.md', title: 'Gold', folder: 'Finance', summary: 'gold prices', stale: false, enriched: false },
      { vaultId: 'v', relPath: 'Finance/Fed.md', title: 'Fed', folder: 'Finance', summary: 'fed rates', stale: false, enriched: true },
    ],
    topics: [{ vaultId: 'v', name: 'Banking', memberTitles: ['BOJ Intervention', 'Fed'] }],
  };
}

describe('buildBatchItems (D12)', () => {
  it('emits the theme item first, then stale notes, then unenriched; skips enriched-nonstale', () => {
    const items = buildBatchItems(corpus());
    expect(items[0].kind).toBe('theme');
    expect(items[0].priority).toBe(0);
    const notePaths = items.filter((i) => i.kind === 'note').map((i) => i.ref);
    // BOJ (stale) and Gold (unenriched) included; Fed (enriched + not stale) skipped.
    expect(notePaths).toContain('Finance/Japan/BOJ.md');
    expect(notePaths).toContain('Finance/Gold.md');
    expect(notePaths).not.toContain('Finance/Fed.md');
    // Stale note ranks above unenriched note.
    const staleIdx = items.findIndex((i) => i.ref === 'Finance/Japan/BOJ.md');
    const freshIdx = items.findIndex((i) => i.ref === 'Finance/Gold.md');
    expect(staleIdx).toBeLessThan(freshIdx);
  });

  it('never sends full note bodies — only title/folder/summary (D12)', () => {
    const items = buildBatchItems(corpus());
    const noteItem = items.find((i) => i.ref === 'Finance/Gold.md')!;
    expect(noteItem.user).toContain('Gold');
    expect(noteItem.user).toContain('gold prices'); // the summary, not a body
  });
});

describe('trimToBudget (S27)', () => {
  const cost = (est: { inputTokens: number; outputTokens: number }): number => est.outputTokens / 1000;

  it('drops lowest-priority items first but keeps the theme item', () => {
    const items = buildBatchItems(corpus());
    const full = cost(estimateCorpus(items));
    // Budget that only fits the theme (priority 0) plus nothing else.
    const themeOnly = cost(estimateCorpus(items.filter((i) => i.kind === 'theme')));
    const kept = trimToBudget(items, themeOnly, cost);
    expect(kept).toHaveLength(1);
    expect(kept[0].kind).toBe('theme');
    expect(full).toBeGreaterThan(themeOnly);
  });

  it('returns [] when even the theme alone exceeds budget (→ orchestrator refuses)', () => {
    const items: BatchItemSpec[] = buildBatchItems(corpus());
    const kept = trimToBudget(items, 0, cost);
    expect(kept).toHaveLength(0);
  });
});
