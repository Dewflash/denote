// src/features/graph/neighborhood.ts — PURE local-view extraction: the n-hop neighborhood of
// one node (pass-4 brief: "local view mode ... reachable from the editor"). BFS over an
// undirected view of the edges (a wikilink's direction shouldn't hide a backlink neighbor).

import type { Graph } from '../../domain';

export function localNeighborhood(graph: Graph, centerId: string, hops: number): Graph {
  if (!graph.nodes.some((n) => n.id === centerId)) return { nodes: [], edges: [] };

  const adjacency = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    (adjacency.get(e.from) ?? adjacency.set(e.from, new Set()).get(e.from)!).add(e.to);
    (adjacency.get(e.to) ?? adjacency.set(e.to, new Set()).get(e.to)!).add(e.from);
  }

  const visited = new Set<string>([centerId]);
  let frontier = [centerId];
  for (let hop = 0; hop < hops; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  const nodes = graph.nodes.filter((n) => visited.has(n.id));
  const edges = graph.edges.filter((e) => visited.has(e.from) && visited.has(e.to));
  return { nodes, edges };
}
