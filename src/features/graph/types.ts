// src/features/graph/types.ts — the GraphView component contract (D25): "props are {nodes,
// edges, groupings, style tokens, callbacks} — renderer-agnostic." react-force-graph (canvas 2D)
// is the first implementation (ForceGraphRenderer.tsx); swapping to Sigma/WebGL later (R5) means
// writing a new component that accepts this same props shape — nothing else in the app changes.

import type { GraphEdge, GraphNode } from '../../domain';

export interface GraphStyleTokens {
  fontUi: string;
  noteFill: string;
  ghostStroke: string;
  tagFill: string;
  topicFill: string;
  edgeSolid: string;
  edgeAi: string;
  hullPalette: string[];
  bg: string;
  fg: string;
  fgMuted: string;
  accent: string;
}

export interface GraphGroupings {
  /** Structural (vault→folder) hulls toggle (D7 default OFF). Hull GEOMETRY is a per-frame
   *  rendering concern (it must track live simulation/drag positions, not a value computed once
   *  per data change) — so the renderer derives polygons itself from the live node positions it
   *  already owns; this prop only says whether to paint them at all. */
  hullsEnabled: boolean;
}

export interface GraphViewProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  groupings?: GraphGroupings;
  styleTokens: GraphStyleTokens;
  /** vaultId → registered accent color (pass-05 brief: "per-vault accent color used on rail +
   *  hulls + headers"). Optional and additive: a renderer with no entry for a given vault falls
   *  back to its own single-vault hashed palette, so this never changes single-vault output. */
  vaultColors?: Record<string, string>;
  /** Semantic clustering (pass-8, D7 default view): note nodeId → its dominant-topic color, so a
   *  note is painted in its strongest topic's color rather than the flat note fill. Additive — a
   *  note with no membership falls back to the plain note fill. */
  nodeColors?: Record<string, string>;
  /** note nodeId → the colors of its ≥2 strong topic memberships, drawn as ring segments around
   *  the node (pass-8 mixed-membership visual). */
  nodeRings?: Record<string, string[]>;
  selectedId?: string | null;
  /** Plain click selects a node for inspection. Cmd-click opens a note (or creates a ghost) while
   *  keeping the graph open. Tag/topic clicks only select. */
  onNodeClick?: (node: GraphNode, opts: { metaKey: boolean }) => void;
  onBackgroundClick?: () => void;
  onNodeDragEnd?: (node: GraphNode, x: number, y: number) => void;
}
