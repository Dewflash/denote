// src/features/graph/filter.ts — PURE view-layer filtering: layer toggles (wikilinks / tags /
// topics / ai-similar) + the AI-edge confidence slider (pass-4 brief). This is presentation
// filtering only — it never mutates the domain graph, and never affects what graphBuilder
// computed (D6/D7: AI can't touch structure; this is strictly "what do we currently render").

import type { Graph, GraphEdge, GraphNode } from '../../domain';

export interface LayerToggles {
  wikilinks: boolean; // wikilink + embed edges
  tags: boolean; // note-tag edges + tag nodes
  topics: boolean; // note-topic + topic-topic edges + topic nodes
  aiSimilar: boolean; // ai-similar edges
}

export const DEFAULT_LAYERS: LayerToggles = {
  wikilinks: true,
  tags: true,
  topics: true,
  aiSimilar: true,
};

function edgeLayer(type: GraphEdge['type']): keyof LayerToggles | null {
  switch (type) {
    case 'wikilink':
    case 'embed':
      return 'wikilinks';
    case 'note-tag':
      return 'tags';
    case 'note-topic':
    case 'topic-topic':
      return 'topics';
    case 'ai-similar':
      return 'aiSimilar';
    default:
      return null; // 'manual' edges are always shown — no layer owns them
  }
}

/** Filters a graph down to what should currently render: layer toggles drop whole edge
 *  categories (and the hub nodes that would otherwise be left floating), and `minConfidence`
 *  drops AI edges below the slider (edges with no `confidence` are never dropped by it). */
export function filterGraph(graph: Graph, layers: LayerToggles, minConfidence: number): Graph {
  const edges = graph.edges.filter((e) => {
    const layer = edgeLayer(e.type);
    if (layer && !layers[layer]) return false;
    if (e.source === 'ai' && e.confidence !== undefined && e.confidence < minConfidence) return false;
    return true;
  });

  const touchedIds = new Set<string>();
  for (const e of edges) {
    touchedIds.add(e.from);
    touchedIds.add(e.to);
  }

  const nodes = graph.nodes.filter((n: GraphNode) => {
    // Hub node types are only meaningful while their layer is on AND they still have an edge.
    if (n.type === 'tag') return layers.tags && touchedIds.has(n.id);
    if (n.type === 'topic' || n.type === 'topicmerge') return layers.topics && touchedIds.has(n.id);
    // Notes and ghosts always render, even isolated (orphans are legitimate graph content).
    return true;
  });

  return { nodes, edges };
}
