import { describe, expect, it } from 'vitest';
import { reconcileNodePositions, type PositionedNode } from '../../../src/features/graph/liveGraph';
import type { GraphNode } from '../../../src/domain';

describe('reconcileNodePositions', () => {
  it('assigns a seeded position to a brand-new node', () => {
    const registry = new Map<string, PositionedNode>();
    const [a] = reconcileNodePositions(registry, [{ id: 'v/A.md', type: 'note', label: 'A' } as GraphNode]);
    expect(typeof a.x).toBe('number');
    expect(typeof a.y).toBe('number');
  });

  it('keeps a large graph inside a compact initial world for readable fit-to-view', () => {
    const registry = new Map<string, PositionedNode>();
    const nodes = Array.from({ length: 200 }, (_, i) => ({ id: `v/${i}.md`, type: 'note' as const }));
    const positioned = reconcileNodePositions(registry, nodes as GraphNode[]);
    const farthest = Math.max(...positioned.map((node) => Math.hypot(node.x, node.y)));
    expect(farthest).toBeLessThanOrEqual(241);
  });

  it('reuses the SAME object reference across calls for an id seen before', () => {
    const registry = new Map<string, PositionedNode>();
    const first = reconcileNodePositions(registry, [{ id: 'v/A.md', type: 'note', label: 'A' } as GraphNode])[0];
    // Simulate the force engine mutating position in place, as react-force-graph does.
    first.x = 123;
    first.y = 456;

    const second = reconcileNodePositions(registry, [{ id: 'v/A.md', type: 'note', label: 'A (edited)' } as GraphNode])[0];
    expect(second).toBe(first); // identity preserved
    expect(second.x).toBe(123); // position survives the "edit"
    expect(second.label).toBe('A (edited)'); // fresh fields still refreshed
  });

  it('drops stale ids from the registry (renamed/deleted notes do not leak)', () => {
    const registry = new Map<string, PositionedNode>();
    reconcileNodePositions(registry, [{ id: 'v/A.md', type: 'note' } as GraphNode]);
    expect(registry.has('v/A.md')).toBe(true);
    reconcileNodePositions(registry, [{ id: 'v/B.md', type: 'note' } as GraphNode]);
    expect(registry.has('v/A.md')).toBe(false);
    expect(registry.has('v/B.md')).toBe(true);
  });

  it('output order matches the input freshNodes order', () => {
    const registry = new Map<string, PositionedNode>();
    const out = reconcileNodePositions(registry, [
      { id: 'v/B.md', type: 'note' } as GraphNode,
      { id: 'v/A.md', type: 'note' } as GraphNode,
    ]);
    expect(out.map((n) => n.id)).toEqual(['v/B.md', 'v/A.md']);
  });
});
