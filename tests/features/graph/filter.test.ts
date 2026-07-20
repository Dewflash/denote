import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYERS, filterGraph } from '../../../src/features/graph/filter';
import type { Graph } from '../../../src/domain';

const graph: Graph = {
  nodes: [
    { id: 'v/A.md', type: 'note', vaultId: 'v', label: 'A' },
    { id: 'v/B.md', type: 'note', vaultId: 'v', label: 'B' },
    { id: 'tag:japan', type: 'tag', label: 'japan' },
    { id: 'topic:finance', type: 'topic', vaultId: 'v', label: 'Finance' },
  ],
  edges: [
    { id: 'wikilink:A->B', from: 'v/A.md', to: 'v/B.md', type: 'wikilink', source: 'parser', weight: 1 },
    { id: 'note-tag:A->tag', from: 'v/A.md', to: 'tag:japan', type: 'note-tag', source: 'parser', weight: 1 },
    {
      id: 'note-topic:A->topic',
      from: 'v/A.md',
      to: 'topic:finance',
      type: 'note-topic',
      source: 'ai',
      weight: 0.9,
      confidence: 0.9,
      reason: 'member of Finance',
    },
    {
      id: 'ai-similar:A<->B',
      from: 'v/A.md',
      to: 'v/B.md',
      type: 'ai-similar',
      source: 'ai',
      weight: 0.5,
      confidence: 0.5,
      reason: 'both discuss BOJ policy specifically',
    },
  ],
};

const ALL_LAYERS = { wikilinks: true, tags: true, topics: true, aiSimilar: true } as const;

describe('filterGraph', () => {
  it('with all layers on and confidence 0, keeps everything', () => {
    const out = filterGraph(graph, ALL_LAYERS, 0);
    expect(out.nodes).toHaveLength(4);
    expect(out.edges).toHaveLength(4);
  });

  it('turning off tags drops note-tag edges AND the now-orphaned tag node', () => {
    const out = filterGraph(graph, { ...DEFAULT_LAYERS, tags: false }, 0);
    expect(out.edges.some((e) => e.type === 'note-tag')).toBe(false);
    expect(out.nodes.some((n) => n.type === 'tag')).toBe(false);
    // notes remain untouched
    expect(out.nodes.some((n) => n.id === 'v/A.md')).toBe(true);
  });

  it('turning off topics drops note-topic edges and the topic node', () => {
    const out = filterGraph(graph, { ...DEFAULT_LAYERS, topics: false }, 0);
    expect(out.edges.some((e) => e.type === 'note-topic')).toBe(false);
    expect(out.nodes.some((n) => n.type === 'topic')).toBe(false);
  });

  it('turning off aiSimilar drops only ai-similar edges', () => {
    const out = filterGraph(graph, { ...ALL_LAYERS, aiSimilar: false }, 0);
    expect(out.edges.some((e) => e.type === 'ai-similar')).toBe(false);
    expect(out.edges.some((e) => e.type === 'note-topic')).toBe(true);
  });

  it('confidence slider drops low-confidence AI edges but never non-AI edges', () => {
    const out = filterGraph(graph, ALL_LAYERS, 0.7);
    expect(out.edges.some((e) => e.id === 'ai-similar:A<->B')).toBe(false); // 0.5 < 0.7
    expect(out.edges.some((e) => e.id === 'note-topic:A->topic')).toBe(true); // 0.9 >= 0.7
    expect(out.edges.some((e) => e.type === 'wikilink')).toBe(true); // not AI, unaffected
  });

  it('note nodes are never dropped even if isolated', () => {
    const out = filterGraph(graph, { wikilinks: false, tags: false, topics: false, aiSimilar: false }, 0);
    expect(out.nodes.filter((n) => n.type === 'note')).toHaveLength(2);
    expect(out.edges).toHaveLength(0);
  });
});
