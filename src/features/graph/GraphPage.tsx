// src/features/graph/GraphPage.tsx — composes the live vault graph: buildGraph (domain) fed by
// the open vault's index → layer/confidence filter → local-view neighborhood → position
// reconciliation (liveGraph.ts, "graph updates live when a note is edited") → ForceGraphRenderer
// + LayerControls + NodeInspector. No AI edges/topics exist yet this pass (buildGraph gets an
// empty `similarPairs`/no `topics`, per D26/pass-6 — the styling machinery is built and proven
// against `mockFixture.ts` in dev instead, so pass 7/8 plug in real data with zero UI changes).

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildGraph, type Graph } from '../../domain';
import { useVaultStore } from '../../state/vaultStore';
import { useGraphStore } from '../../state/graphStore';
import { useUiStore } from '../../state/uiStore';
import { ForceGraphRenderer } from './ForceGraphRenderer';
import { LayerControls } from './LayerControls';
import { NodeInspector } from './NodeInspector';
import { useGraphStyleTokens } from './useGraphStyleTokens';
import { filterGraph } from './filter';
import { localNeighborhood } from './neighborhood';
import { reconcileNodePositions, type PositionedNode } from './liveGraph';
import { buildMockGraphFixture } from './mockFixture';
import { noteRelPath } from './hulls';
import type { GraphNode } from '../../domain';

function useDevMockGraph(): boolean {
  return import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('graphMock') === '1';
}

export function GraphPage() {
  const repo = useVaultStore((s) => s.repo);
  const revision = useVaultStore((s) => s.revision);
  const setActiveNote = useVaultStore((s) => s.setActiveNote);
  const createGhostAndOpen = useVaultStore((s) => s.createGhostAndOpen);
  const setGraphViewOpen = useUiStore((s) => s.setGraphViewOpen);

  const layers = useGraphStore((s) => s.layers);
  const minConfidence = useGraphStore((s) => s.minConfidence);
  const hullsEnabled = useGraphStore((s) => s.hullsEnabled);
  const localView = useGraphStore((s) => s.localView);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode);

  const styleTokens = useGraphStyleTokens();
  const useMock = useDevMockGraph();

  const fullGraph: Graph = useMemo(() => {
    if (useMock) return buildMockGraphFixture();
    if (!repo) return { nodes: [], edges: [] };
    // similarPairs/topics are intentionally omitted — pass 6/7/8 own wiring them in (D26).
    return buildGraph({ vaults: [{ vaultId: repo.vaultId, notes: repo.index.allNotes() }] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, revision, useMock]);

  const scopedGraph: Graph = useMemo(() => {
    if (localView.enabled && localView.centerId) {
      return localNeighborhood(fullGraph, localView.centerId, localView.hops);
    }
    return fullGraph;
  }, [fullGraph, localView]);

  const visibleGraph: Graph = useMemo(
    () => filterGraph(scopedGraph, layers, minConfidence),
    [scopedGraph, layers, minConfidence],
  );

  // Persists across renders so a note edit (revision bump → fresh buildGraph()) doesn't reset
  // the force layout — see liveGraph.ts. Reconciliation is ref-mutating and therefore lives in
  // an effect (syncing derived positions from the external, imperative simulation), not in
  // render itself.
  const registryRef = useRef(new Map<string, PositionedNode>());
  const [positioned, setPositioned] = useState<PositionedNode[]>([]);
  useEffect(() => {
    setPositioned(reconcileNodePositions(registryRef.current, visibleGraph.nodes));
  }, [visibleGraph.nodes]);

  // Clear a stale selection (deleted/filtered-out node) rather than pointing the inspector at
  // nothing useful.
  useEffect(() => {
    if (selectedNodeId && !fullGraph.nodes.some((n) => n.id === selectedNodeId)) {
      setSelectedNode(null);
    }
  }, [fullGraph, selectedNodeId, setSelectedNode]);

  function handleNodeClick(node: GraphNode, opts: { metaKey: boolean }): void {
    setSelectedNode(node.id);
    if (node.type === 'ghost') {
      void createGhostAndOpen(node.label ?? '');
      if (!opts.metaKey) setGraphViewOpen(false);
      return;
    }
    if (node.type === 'note' && repo) {
      const relPath = noteRelPath(node.id, repo.vaultId);
      if (relPath) {
        void setActiveNote(relPath);
        if (!opts.metaKey) setGraphViewOpen(false);
      }
    }
    // tag/topic clicks just select — no navigation target.
  }

  return (
    <div className="flex h-full flex-col" style={{ minHeight: 0 }}>
      <LayerControls />
      <div className="flex flex-1" style={{ minHeight: 0 }}>
        <div className="flex-1" style={{ minWidth: 0 }}>
          <ForceGraphRenderer
            edges={visibleGraph.edges}
            positioned={positioned}
            groupings={{ hullsEnabled }}
            styleTokens={styleTokens}
            selectedId={selectedNodeId}
            onNodeClick={handleNodeClick}
            onBackgroundClick={() => setSelectedNode(null)}
          />
        </div>
        {selectedNodeId && (
          <div style={{ width: 280 }}>
            <NodeInspector graph={fullGraph} onClose={() => setSelectedNode(null)} />
          </div>
        )}
      </div>
    </div>
  );
}
