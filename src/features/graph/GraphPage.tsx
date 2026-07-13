// src/features/graph/GraphPage.tsx — composes the live COMBINED graph (pass-05 brief: "Graph
// vault selector: checkbox set of open vaults → combined graph", D17): buildGraph (domain) fed
// by every SELECTED open vault's index → layer/confidence filter → local-view neighborhood →
// position reconciliation (liveGraph.ts, "graph updates live when a note is edited") →
// ForceGraphRenderer + LayerControls + NodeInspector. AI-similar edges and topic hubs are fed
// from the live per-vault engines; the mock fixture remains a dev-only visual harness.

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildGraph, dominantTopic, strongMemberships, type Graph, type Membership } from '../../domain';
import { paletteColor } from './layout';
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
import { GraphNotesIndex } from './GraphNotesIndex';
import type { GraphNode } from '../../domain';

function useDevMockGraph(): boolean {
  return import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('graphMock') === '1';
}

export function GraphPage() {
  const revision = useVaultStore((s) => s.revision);
  const openVaultIds = useVaultStore((s) => s.openVaultIds);
  const registry = useVaultStore((s) => s.registry);
  const getOpenRepo = useVaultStore((s) => s.getOpenRepo);
  const switchVault = useVaultStore((s) => s.switchVault);
  const setActiveNote = useVaultStore((s) => s.setActiveNote);
  const createGhostAndOpen = useVaultStore((s) => s.createGhostAndOpen);
  const graphSimilarPairs = useVaultStore((s) => s.graphSimilarPairs);
  const graphAiLinks = useVaultStore((s) => s.graphAiLinks);
  const graphTopics = useVaultStore((s) => s.graphTopics);
  const setGraphViewOpen = useUiStore((s) => s.setGraphViewOpen);

  const layers = useGraphStore((s) => s.layers);
  const minConfidence = useGraphStore((s) => s.minConfidence);
  const hullsEnabled = useGraphStore((s) => s.hullsEnabled);
  const localView = useGraphStore((s) => s.localView);
  const exitLocalView = useGraphStore((s) => s.exitLocalView);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode);
  const selectedGraphVaultIds = useGraphStore((s) => s.selectedGraphVaultIds);

  const styleTokens = useGraphStyleTokens();
  const useMock = useDevMockGraph();

  const vaultColors = useMemo(
    () => Object.fromEntries(registry.map((v) => [v.id, v.color])),
    [registry],
  );

  const fullGraph: Graph = useMemo(() => {
    if (useMock) return buildMockGraphFixture();
    const topicsByVault = new Map(graphTopics(selectedGraphVaultIds).map((v) => [v.vaultId, v.topics]));
    const vaults = selectedGraphVaultIds
      .map((id) => getOpenRepo(id))
      .filter((r): r is NonNullable<typeof r> => r != null)
      .map((r) => ({
        vaultId: r.vaultId,
        // Generated `_topics/*` hub notes are represented by topic nodes, so keep those files
        // out of the note layer. Every other Markdown file belongs in the map, including notes
        // carrying reserved `source: ai` metadata from an import or an older DeNote version.
        notes: r.index.allNotes().filter((n) => !n.relPath.startsWith('_topics/')),
        topics: topicsByVault.get(r.vaultId),
      }));
    if (vaults.length === 0) return { nodes: [], edges: [] };
    // ai-similar pairs (pass 7, S15) come from the embedding engines; topics (pass 8) drive the
    // semantic-cluster hubs + note-topic edges.
    const similarPairs = graphSimilarPairs(selectedGraphVaultIds);
    const aiLinks = graphAiLinks(selectedGraphVaultIds);
    return buildGraph({ vaults, similarPairs, aiLinks });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGraphVaultIds, openVaultIds, getOpenRepo, graphSimilarPairs, graphAiLinks, graphTopics, revision, useMock]);

  // Semantic clustering (D7 default view): color each note by its dominant topic (matching the
  // topic hub node's own palette color), plus ring segments for ≥2 strong memberships.
  const { nodeColors, nodeRings } = useMemo(() => {
    const colors: Record<string, string> = {};
    const rings: Record<string, string[]> = {};
    const palette = styleTokens.hullPalette;
    const colorFor = (topicId: string) => paletteColor(`topic:${topicId}`, palette);
    for (const { vaultId, topics } of graphTopics(selectedGraphVaultIds)) {
      const byNote = new Map<string, Membership[]>();
      for (const t of topics) {
        for (const m of t.members) {
          const nodeId = `${vaultId}/${m.notePath}`;
          const list = byNote.get(nodeId) ?? [];
          list.push({ topicId: t.id, name: t.name, weight: m.weight });
          byNote.set(nodeId, list);
        }
      }
      for (const [nodeId, ms] of byNote) {
        const dom = dominantTopic(ms);
        if (dom) colors[nodeId] = colorFor(dom.topicId);
        const strong = strongMemberships(ms);
        if (strong.length >= 2) rings[nodeId] = strong.map((s) => colorFor(s.topicId));
      }
    }
    return { nodeColors: colors, nodeRings: rings };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGraphVaultIds, graphTopics, styleTokens, revision]);

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
  const visibleNotes = useMemo(
    () => visibleGraph.nodes.filter((node) => node.type === 'note'),
    [visibleGraph.nodes],
  );

  const fullNoteCount = useMemo(
    () => fullGraph.nodes.filter((node) => node.type === 'note').length,
    [fullGraph.nodes],
  );
  const localCenterTitle = useMemo(
    () => fullGraph.nodes.find((node) => node.id === localView.centerId)?.label ?? localView.centerId ?? 'this note',
    [fullGraph.nodes, localView.centerId],
  );
  const localVisibleNoteCount = useMemo(
    () => scopedGraph.nodes.filter((node) => node.type === 'note').length,
    [scopedGraph.nodes],
  );
  const [sparseHintDismissed, setSparseHintDismissed] = useState(false);
  const connectedNoteIds = useMemo(() => {
    const ids = new Set<string>();
    const noteIds = new Set(visibleNotes.map((note) => String(note.id)));
    for (const edge of visibleGraph.edges) {
      if (noteIds.has(String(edge.from))) ids.add(String(edge.from));
      if (noteIds.has(String(edge.to))) ids.add(String(edge.to));
    }
    return ids;
  }, [visibleGraph.edges, visibleNotes]);
  const orphanNoteCount = visibleNotes.length - connectedNoteIds.size;
  // A single orphan is worth explaining in a small map; requiring a majority meant the common
  // "three linked notes plus one new note" case looked like a broken renderer.
  const sparseHint = !sparseHintDismissed && orphanNoteCount > 0 && (
    visibleNotes.length <= 8 || orphanNoteCount > visibleNotes.length / 2
  );

  // Empty-state guidance (post-06 fix #2): silent dots with no edges confused the owner (all
  // layers off, or imported notes with few wikilinks). Surface a one-line hint instead.
  const allLayersOff = !layers.wikilinks && !layers.tags && !layers.topics && !layers.aiSimilar;
  const emptyHint =
    scopedGraph.nodes.length === 0
      ? null // nothing to show at all (no vault selected / empty vault) — not a filter problem
      : visibleGraph.edges.length === 0
        ? allLayersOff
          ? 'No edge layers active — enable Links you typed / Shared tags / AI topic groups / AI links & similarity above.'
          : 'No connections match the current filters — try “Reset view” above.'
        : null;

  // Persists across renders so a note edit (revision bump → fresh buildGraph()) doesn't reset
  // the force layout — see liveGraph.ts. Reconciliation is ref-mutating and therefore lives in
  // an effect (syncing derived positions from the external, imperative simulation), not in
  // render itself.
  const registryRef = useRef(new Map<string, PositionedNode>());
  const [positioned, setPositioned] = useState<PositionedNode[]>([]);
  const [notesIndexOpen, setNotesIndexOpen] = useState(() =>
    typeof window === 'undefined' || window.innerWidth > 720,
  );
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

  // A combined graph may show notes/ghosts from a vault that isn't currently ACTIVE — switching
  // is a no-op fast path when it's already active (vaultStore.switchVault), so this is safe to
  // call unconditionally before navigating.
  async function handleNodeClick(node: GraphNode, opts: { metaKey: boolean }): Promise<void> {
    setSelectedNode(node.id);
    if (node.type === 'ghost' && node.vaultId) {
      await switchVault(node.vaultId);
      void createGhostAndOpen(node.label ?? '', { reveal: false });
      if (!opts.metaKey) setGraphViewOpen(false);
      return;
    }
    if (node.type === 'note' && node.vaultId) {
      const relPath = noteRelPath(node.id, node.vaultId);
      if (relPath) {
        await switchVault(node.vaultId);
        void setActiveNote(relPath, { reveal: false });
        if (!opts.metaKey) setGraphViewOpen(false);
      }
    }
    // tag/topic clicks just select — no navigation target.
  }

  return (
    <div className="graph-page flex h-full flex-col" style={{ minHeight: 0 }}>
      <LayerControls
        notesIndexOpen={notesIndexOpen}
        onToggleNotesIndex={() => {
          const nextOpen = !notesIndexOpen;
          // The two mobile overlays share the graph viewport. Opening one must dismiss the
          // other, otherwise a node inspector can sit underneath the note list.
          if (nextOpen && typeof window !== 'undefined' && window.innerWidth <= 720) {
            setSelectedNode(null);
          }
          setNotesIndexOpen(nextOpen);
        }}
      />
      <div className="graph-content relative flex flex-1" style={{ minHeight: 0 }}>
        {notesIndexOpen && (
          <GraphNotesIndex
            notes={visibleNotes}
            selectedId={selectedNodeId}
            onOpenNote={(node) => {
              if (typeof window !== 'undefined' && window.innerWidth <= 720) setNotesIndexOpen(false);
              void handleNodeClick(node, { metaKey: false });
            }}
            onClose={() => setNotesIndexOpen(false)}
          />
        )}
        <div className="graph-map flex min-w-0 flex-1 flex-col" style={{ position: 'relative' }}>
          {localView.enabled && localView.centerId && (
            <div
              className="flex shrink-0 flex-wrap items-start justify-between gap-2 px-3 py-2 text-xs"
              style={{ backgroundColor: 'var(--bg-panel)', borderBottom: '1px solid var(--border)', color: 'var(--fg)' }}
            >
              <span className="min-w-0 flex-1">
                Showing only notes linked within {localView.hops} steps of “{localCenterTitle}” — {localVisibleNoteCount} of {fullNoteCount} notes visible.
              </span>
              <button type="button" className="shrink-0 rounded px-2 py-1" style={{ border: '1px solid var(--border)' }} onClick={exitLocalView}>
                Show all notes
              </button>
            </div>
          )}
          {emptyHint && (
            <div
              className="flex shrink-0 items-start px-3 py-2 text-xs"
              style={{ backgroundColor: 'var(--bg-panel)', borderBottom: '1px solid var(--border)', color: 'var(--fg-muted)' }}
            >
              {emptyHint}
            </div>
          )}
          {sparseHint && (
            <div className="flex shrink-0 items-start gap-2 px-3 py-2 text-xs" style={{ backgroundColor: 'var(--bg-panel)', borderBottom: '1px solid var(--border)', color: 'var(--fg)' }}>
              <span>
                Dots without lines are notes nothing links to yet. Connect notes by typing [[ inside them — or click “Organize vault…” above to let the on-device AI group them into topics.
              </span>
              <button type="button" aria-label="Dismiss graph hint" title="Dismiss until the next app launch" className="shrink-0 text-base leading-none" style={{ color: 'var(--fg-muted)' }} onClick={() => setSparseHintDismissed(true)}>
                ×
              </button>
            </div>
          )}
          <div className="min-h-0 flex-1">
            <ForceGraphRenderer
              edges={visibleGraph.edges}
              positioned={positioned}
              groupings={{ hullsEnabled }}
              styleTokens={styleTokens}
              vaultColors={vaultColors}
              nodeColors={nodeColors}
              nodeRings={nodeRings}
              selectedId={selectedNodeId}
              onNodeClick={(node, opts) => {
                if (typeof window !== 'undefined' && window.innerWidth <= 720) setNotesIndexOpen(false);
                void handleNodeClick(node, opts);
              }}
              onBackgroundClick={() => setSelectedNode(null)}
            />
          </div>
        </div>
        {selectedNodeId && (
          <div className="graph-inspector" style={{ width: 280 }}>
            <NodeInspector graph={fullGraph} onClose={() => setSelectedNode(null)} />
          </div>
        )}
      </div>
    </div>
  );
}
