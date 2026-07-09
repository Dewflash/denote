// src/features/graph/liveGraph.ts — "graph updates live when a note is edited (index event →
// rebuild diff)" (pass-4 DoD). domain/graphBuilder is pure and returns brand-new node/edge
// objects on every call; react-force-graph's simulation stores its live x/y/vx/vy/fx/fy ON the
// node objects it was given, so naively feeding it a fresh object per id on every revision bump
// would reset the whole layout on every keystroke-triggered save. This merges by id: an id seen
// before keeps its EXACT object reference (so the simulation's in-place mutations survive across
// re-renders); only genuinely new ids get a fresh, seeded object. Positions for merged ids are
// intentionally left untouched here — geometry (label/vaultId/type) is refreshed in place.

import type { GraphNode } from '../../domain';
import { seedPosition } from './layout';

export interface PositionedNode extends GraphNode {
  x: number;
  y: number;
  fx?: number;
  fy?: number;
}

/** Mutates and returns `registry` in place: `registry` is the caller's persistent id→node map
 *  (e.g. a useRef in the page component). Stale ids (no longer present in `freshNodes`) are
 *  removed so the registry doesn't grow unbounded across renames/deletes. */
export function reconcileNodePositions(
  registry: Map<string, PositionedNode>,
  freshNodes: readonly GraphNode[],
): PositionedNode[] {
  const freshIds = new Set<string>(freshNodes.map((n) => n.id));
  for (const id of registry.keys()) {
    if (!freshIds.has(id)) registry.delete(id);
  }

  const out: PositionedNode[] = [];
  for (const n of freshNodes) {
    const existing = registry.get(n.id);
    if (existing) {
      existing.type = n.type;
      existing.label = n.label;
      existing.vaultId = n.vaultId;
      out.push(existing);
    } else {
      const seed = seedPosition(n.id);
      const fresh: PositionedNode = { ...n, x: seed.x, y: seed.y };
      registry.set(n.id, fresh);
      out.push(fresh);
    }
  }
  return out;
}
