import { describe, expect, it } from 'vitest';
import { localNeighborhood } from '../../../src/features/graph/neighborhood';
import type { Graph } from '../../../src/domain';

// Chain: A - B - C - D - E
const graph: Graph = {
  nodes: ['A', 'B', 'C', 'D', 'E'].map((id) => ({ id: id as never, type: 'note' })),
  edges: [
    { id: 'A-B', from: 'A', to: 'B', type: 'wikilink', source: 'parser', weight: 1 },
    { id: 'B-C', from: 'B', to: 'C', type: 'wikilink', source: 'parser', weight: 1 },
    { id: 'C-D', from: 'C', to: 'D', type: 'wikilink', source: 'parser', weight: 1 },
    { id: 'D-E', from: 'D', to: 'E', type: 'wikilink', source: 'parser', weight: 1 },
  ],
};

describe('localNeighborhood', () => {
  it('0 hops returns just the center', () => {
    const out = localNeighborhood(graph, 'C', 0);
    expect(out.nodes.map((n) => n.id)).toEqual(['C']);
    expect(out.edges).toHaveLength(0);
  });

  it('1 hop returns immediate neighbors both directions (undirected BFS)', () => {
    const out = localNeighborhood(graph, 'C', 1);
    expect(new Set(out.nodes.map((n) => n.id))).toEqual(new Set(['B', 'C', 'D']));
    expect(out.edges).toHaveLength(2);
  });

  it('2 hops reaches the full chain from the middle', () => {
    const out = localNeighborhood(graph, 'C', 2);
    expect(new Set(out.nodes.map((n) => n.id))).toEqual(new Set(['A', 'B', 'C', 'D', 'E']));
    expect(out.edges).toHaveLength(4);
  });

  it('unknown center returns an empty graph rather than throwing', () => {
    expect(localNeighborhood(graph, 'nope', 3)).toEqual({ nodes: [], edges: [] });
  });

  it('stops expanding once the frontier is exhausted (no infinite loop past the graph edge)', () => {
    const out = localNeighborhood(graph, 'A', 10);
    expect(out.nodes).toHaveLength(5);
  });
});
