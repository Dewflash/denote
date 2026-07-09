// src/features/graph/mockFixture.ts — DEV-ONLY mock data (pass-4 brief: "topics arrive pass 8
// — style them now with mock data in a storybook-style dev page, keep prod empty"). Never
// imported from production data paths — GraphPage only reaches this behind an
// `import.meta.env.DEV` gate (Vite statically eliminates the branch, and this module with it,
// from a production build). Exercises every visual case pass 7/8 will need: a topic hub with
// hierarchy, an ai-similar edge with a real reason, and a provisional/low-confidence edge for
// the confidence slider to have something to filter.

import type { Graph } from '../../domain';

export function buildMockGraphFixture(): Graph {
  const vaultId = 'mock';
  return {
    nodes: [
      { id: `${vaultId}/Japan.md`, type: 'note', vaultId, label: 'Japan' },
      { id: `${vaultId}/Yen Intervention.md`, type: 'note', vaultId, label: 'Yen Intervention' },
      { id: `${vaultId}/Interest Rates.md`, type: 'note', vaultId, label: 'Interest Rates' },
      { id: `${vaultId}/Miso Soup Recipe.md`, type: 'note', vaultId, label: 'Miso Soup Recipe' },
      { id: `ghost:${vaultId}/bank of japan`, type: 'ghost', label: 'Bank of Japan' },
      { id: 'tag:japan', type: 'tag', label: 'japan' },
      { id: 'tag:finance', type: 'tag', label: 'finance' },
      { id: `topic:${vaultId}-finance`, type: 'topic', vaultId, label: 'Finance' },
      { id: `topic:${vaultId}-banking`, type: 'topic', vaultId, label: 'Banking' },
    ],
    edges: [
      {
        id: 'wikilink:1',
        from: `${vaultId}/Japan.md`,
        to: `ghost:${vaultId}/bank of japan`,
        type: 'wikilink',
        source: 'parser',
        weight: 1,
      },
      {
        id: 'wikilink:2',
        from: `${vaultId}/Yen Intervention.md`,
        to: `${vaultId}/Interest Rates.md`,
        type: 'wikilink',
        source: 'parser',
        weight: 1,
      },
      {
        id: 'note-tag:1',
        from: `${vaultId}/Japan.md`,
        to: 'tag:japan',
        type: 'note-tag',
        source: 'parser',
        weight: 1,
      },
      {
        id: 'note-tag:2',
        from: `${vaultId}/Yen Intervention.md`,
        to: 'tag:japan',
        type: 'note-tag',
        source: 'parser',
        weight: 1,
      },
      {
        id: 'note-topic:1',
        from: `${vaultId}/Yen Intervention.md`,
        to: `topic:${vaultId}-banking`,
        type: 'note-topic',
        source: 'ai',
        weight: 0.88,
        confidence: 0.88,
        reason: 'discusses BOJ policy rate decisions',
      },
      {
        id: 'note-topic:2',
        from: `${vaultId}/Interest Rates.md`,
        to: `topic:${vaultId}-banking`,
        type: 'note-topic',
        source: 'ai',
        weight: 0.4,
        confidence: 0.4,
        reason: 'tangential mention of central bank policy',
      },
      {
        id: 'topic-topic:1',
        from: `topic:${vaultId}-banking`,
        to: `topic:${vaultId}-finance`,
        type: 'topic-topic',
        source: 'ai',
        weight: 1,
        reason: 'topic hierarchy',
      },
      {
        id: 'ai-similar:1',
        from: `${vaultId}/Japan.md`,
        to: `${vaultId}/Yen Intervention.md`,
        type: 'ai-similar',
        source: 'ai',
        weight: 0.81,
        confidence: 0.81,
        reason: 'both discuss BOJ zero-rate policy specifically',
      },
    ],
  };
}
