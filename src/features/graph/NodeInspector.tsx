// src/features/graph/NodeInspector.tsx — click-to-inspect panel (pass-4 brief): title, folder,
// tags, outbound/inbound counts, and a connections list with PER-EDGE PROVENANCE (source badge,
// confidence, reason — D8c). Always reads the full (unfiltered) graph so provenance is honest
// even when a layer is toggled off in the canvas.

import type { Graph, GraphEdge, GraphNode } from '../../domain';
import { useVaultStore } from '../../state/vaultStore';
import { useGraphStore } from '../../state/graphStore';
import { useUiStore } from '../../state/uiStore';
import { folderOf, noteRelPath } from './hulls';

function sourceBadgeColor(source: GraphEdge['source']): string {
  switch (source) {
    case 'ai':
      return 'var(--graph-edge-ai)';
    case 'user':
      return 'var(--accent)';
    default:
      return 'var(--fg-muted)';
  }
}

function relPathOf(node: GraphNode, vaultId: string | undefined): string | null {
  if (node.type !== 'note' || !vaultId) return null;
  return noteRelPath(node.id, vaultId);
}

interface ConnectionRow {
  edge: GraphEdge;
  otherId: string;
  otherLabel: string;
  direction: 'out' | 'in';
}

export function NodeInspector({ graph, onClose }: { graph: Graph; onClose: () => void }) {
  const selectedId = useGraphStore((s) => s.selectedNodeId);
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode);
  const repo = useVaultStore((s) => s.repo);
  const setActiveNote = useVaultStore((s) => s.setActiveNote);
  const createGhostAndOpen = useVaultStore((s) => s.createGhostAndOpen);
  const setGraphViewOpen = useUiStore((s) => s.setGraphViewOpen);

  const node = graph.nodes.find((n) => n.id === selectedId);
  if (!node) return null;

  const relPath = relPathOf(node, repo?.vaultId);
  const parsed = relPath ? repo?.getParsed(relPath) : undefined;
  const folder = relPath ? folderOf(relPath) || '(vault root)' : null;

  const byId = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));
  const connections: ConnectionRow[] = [];
  for (const e of graph.edges) {
    if (e.from === node.id) {
      connections.push({ edge: e, otherId: e.to, otherLabel: byId.get(e.to)?.label ?? e.to, direction: 'out' });
    } else if (e.to === node.id) {
      connections.push({ edge: e, otherId: e.from, otherLabel: byId.get(e.from)?.label ?? e.from, direction: 'in' });
    }
  }
  const outboundCount = connections.filter((c) => c.direction === 'out').length;
  const inboundCount = connections.filter((c) => c.direction === 'in').length;

  return (
    <div
      className="flex h-full flex-col gap-3 overflow-auto p-3 text-sm"
      style={{ borderLeft: '1px solid var(--border)', backgroundColor: 'var(--bg-panel)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{node.label ?? node.id}</div>
          <div className="text-xs" style={{ color: 'var(--fg-muted)' }}>
            {node.type}
            {folder ? ` · ${folder}` : ''}
          </div>
        </div>
        <button className="text-xs" style={{ color: 'var(--fg-muted)' }} onClick={onClose}>
          Close
        </button>
      </div>

      {node.type === 'note' && parsed && parsed.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {parsed.tags.map((t) => (
            <span
              key={t}
              className="rounded px-1.5 py-0.5 text-xs"
              style={{ backgroundColor: 'var(--graph-node-tag)', color: '#fff', opacity: 0.85 }}
            >
              #{t}
            </span>
          ))}
        </div>
      )}

      {node.type === 'ghost' && (
        <button
          className="rounded px-2 py-1 text-xs"
          style={{ border: '1px solid var(--border)', width: 'fit-content' }}
          onClick={() => void createGhostAndOpen(node.label ?? String(node.id).split('/').pop() ?? '')}
        >
          Create note
        </button>
      )}

      {node.type === 'note' && relPath && (
        <button
          className="rounded px-2 py-1 text-xs"
          style={{ border: '1px solid var(--border)', width: 'fit-content' }}
          onClick={() => {
            void setActiveNote(relPath);
            setGraphViewOpen(false);
          }}
        >
          Open note
        </button>
      )}

      <div className="text-xs" style={{ color: 'var(--fg-muted)' }}>
        {outboundCount} outbound · {inboundCount} inbound
      </div>

      <div className="flex flex-col gap-1.5">
        {connections.map(({ edge, otherId, otherLabel, direction }, i) => (
          <button
            key={`${edge.id}-${i}`}
            className="flex flex-col items-start gap-0.5 rounded p-2 text-left"
            style={{ border: '1px solid var(--border)' }}
            onClick={() => setSelectedNode(otherId)}
          >
            <div className="flex w-full items-center justify-between gap-2">
              <span className="truncate">
                {direction === 'out' ? '→' : '←'} {otherLabel}
              </span>
              <span
                className="shrink-0 rounded px-1 text-[10px] uppercase"
                style={{ backgroundColor: sourceBadgeColor(edge.source), color: '#fff' }}
              >
                {edge.source}
              </span>
            </div>
            <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
              {edge.type}
              {edge.confidence !== undefined ? ` · ${Math.round(edge.confidence * 100)}% confidence` : ''}
            </span>
            {edge.reason && (
              <span className="text-xs italic" style={{ color: 'var(--fg-muted)' }}>
                “{edge.reason}”
              </span>
            )}
          </button>
        ))}
        {connections.length === 0 && <div style={{ color: 'var(--fg-muted)' }}>No connections.</div>}
      </div>
    </div>
  );
}

