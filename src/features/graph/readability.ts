// src/features/graph/readability.ts — PURE graph-readability decisions (RECOVERY R-4). Three
// concerns the map surface needs answered deterministically (and therefore testably):
//   1. When do node titles paint at all (the large-graph label gate)?
//   2. Which visible notes are connected vs. isolated (drives orphan dimming — presentation
//      only; per D6 this must never invent structure, it only styles what buildGraph produced)?
//   3. Which explanatory hint does a zero-edge map deserve (layers off vs. filtered away vs.
//      the vault genuinely has no connections yet)?

import type { GraphEdge } from '../../domain';

/** Node-count threshold under which titles are always label candidates. R-4: "titles visible at
 *  default zoom for graphs ≤ ~300 nodes". */
export const LABEL_ALWAYS_MAX_NODES = 300;

/** Zoom gate for larger graphs — unchanged from the original hairball guard: canvas text is the
 *  first thing to kill frame rate, so 300+ node maps only label at deep zoom. */
export const LABEL_LARGE_GRAPH_SCALE_GATE = 2.2;

/** Returns the globalScale a node label must exceed to become a paint candidate.
 *
 *  ≤300 nodes → 0 (candidates at ANY zoom, including the fit-to-graph default — the per-frame
 *  collision layout in the renderer still culls labels that physically don't fit, which is the
 *  correct crowding control because it adapts to actual density instead of a zoom guess).
 *  >300 nodes → the original 2.2 deep-zoom gate. Hovered/selected labels bypass the gate
 *  entirely (renderer contract), so this only decides the default-zoom experience. */
export function labelScaleGate(nodeCount: number): number {
  return nodeCount <= LABEL_ALWAYS_MAX_NODES ? 0 : LABEL_LARGE_GRAPH_SCALE_GATE;
}

/** Of `noteIds`, the subset touched by at least one edge in `edges`. Edges to hub nodes (tags,
 *  topics) count for the NOTE endpoint only — a tag id in `edge.to` is simply not in `noteIds`.
 *  The complement of this set is the orphan set the renderer dims (R-4). */
export function connectedNoteIds(edges: readonly GraphEdge[], noteIds: ReadonlySet<string>): Set<string> {
  const connected = new Set<string>();
  for (const edge of edges) {
    if (noteIds.has(edge.from)) connected.add(edge.from);
    if (noteIds.has(edge.to)) connected.add(edge.to);
  }
  return connected;
}

export type EmptyHintKind = 'none' | 'no-connections' | 'layers-off' | 'filtered';

/** Which zero-edge explanation the map should surface (R-4: "layers off vs. genuinely no edges
 *  yet vs. AI dead" must be distinguishable — the no-connections branch is where the AI status
 *  panel link lives, because "AI dead" is a diagnosis only that panel can make truthfully).
 *
 *  - `none`           — nothing to explain: no nodes at all, or edges are visible.
 *  - `no-connections` — the UNFILTERED graph has zero edges: no layer toggle or filter could
 *                       reveal anything; the vault genuinely has no connections yet.
 *  - `layers-off`     — edges exist but every edge layer is toggled off.
 *  - `filtered`       — edges exist and layers are on, but the current filters hide them all. */
export function emptyHintKind(args: {
  nodeCount: number;
  rawEdgeCount: number;
  visibleEdgeCount: number;
  allLayersOff: boolean;
}): EmptyHintKind {
  if (args.nodeCount === 0) return 'none';
  if (args.visibleEdgeCount > 0) return 'none';
  if (args.rawEdgeCount === 0) return 'no-connections';
  return args.allLayersOff ? 'layers-off' : 'filtered';
}
