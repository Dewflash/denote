// src/features/graph/NodeInspector.tsx — click-to-inspect panel (pass-4 brief): title, folder,
// tags, outbound/inbound counts, and a connections list with PER-EDGE PROVENANCE (source badge,
// confidence, reason — D8c). Always reads the full (unfiltered) graph so provenance is honest
// even when a layer is toggled off in the canvas.

import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import type { Graph, GraphEdge, GraphNode } from '../../domain';
import { useVaultStore } from '../../state/vaultStore';
import { useGraphStore } from '../../state/graphStore';
import { useUiStore } from '../../state/uiStore';
import { folderOf, noteRelPath } from './hulls';
import { TopicAnalysisPanel } from './TopicAnalysisPanel';

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

function edgeLabel(type: GraphEdge['type']): string {
  switch (type) {
    case 'ai-link': return 'AI-suggested link';
    case 'ai-tag': return 'AI-suggested tag';
    case 'ai-similar': return 'AI-found similarity';
    case 'note-tag': return 'Shared tag';
    case 'note-topic': return 'AI topic group';
    case 'topic-topic': return 'Related topic groups';
    case 'wikilink': return 'Link you typed';
    case 'embed': return 'Embedded note';
    default: return type;
  }
}

function relPathOf(node: GraphNode): string | null {
  if (node.type !== 'note' || !node.vaultId) return null;
  return noteRelPath(node.id, node.vaultId);
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
  const getOpenRepo = useVaultStore((s) => s.getOpenRepo);
  const switchVault = useVaultStore((s) => s.switchVault);
  const setActiveNote = useVaultStore((s) => s.setActiveNote);
  const createGhostAndOpen = useVaultStore((s) => s.createGhostAndOpen);
  const setGraphViewOpen = useUiStore((s) => s.setGraphViewOpen);
  const getOntology = useVaultStore((s) => s.getOpenOntologyEngine);
  const [topicAction, setTopicAction] = useState<{ mode: 'rename' | 'delete'; topicId: string; topicName: string } | null>(null);
  const [topicNameDraft, setTopicNameDraft] = useState('');
  const [topicActionError, setTopicActionError] = useState<string | null>(null);

  const node = graph.nodes.find((n) => n.id === selectedId);
  if (!node) return null;

  const relPath = relPathOf(node);
  const noteRepo = node.vaultId ? getOpenRepo(node.vaultId) : undefined;
  const parsed = relPath ? noteRepo?.getParsed(relPath) : undefined;
  const folder = relPath ? folderOf(relPath) || '(vault root)' : null;

  // Topic insights + management (pass-8): description, members, rename/delete.
  const ontology = node.vaultId ? getOntology(node.vaultId) : undefined;
  const topicId = node.type === 'topic' ? node.id.replace(/^topic:/, '') : null;
  const topic = topicId ? ontology?.topicInsights(topicId) : undefined;

  async function submitTopicAction(): Promise<void> {
    if (!topicAction || !ontology) return;
    setTopicActionError(null);
    try {
      if (topicAction.mode === 'rename') {
        const name = topicNameDraft.trim();
        if (!name) {
          setTopicActionError('Enter a topic name.');
          return;
        }
        await ontology.renameTopic(topicAction.topicId, name);
      } else {
        await ontology.deleteTopic(topicAction.topicId);
        setSelectedNode(null);
      }
      setTopicAction(null);
    } catch (error) {
      setTopicActionError(error instanceof Error ? error.message : String(error));
    }
  }

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
  const openNote = () => {
    void (async () => {
      if (node.vaultId) await switchVault(node.vaultId);
      if (relPath) await setActiveNote(relPath);
      setGraphViewOpen(false);
    })();
  };

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

      {node.type === 'topic' && topic && ontology && (
        <div className="flex flex-col gap-2">
          {topic.description && (
            <div className="text-xs" style={{ color: 'var(--fg-muted)' }}>
              {topic.description}
            </div>
          )}
          {topic.parentName && (
            <div className="text-xs" style={{ color: 'var(--fg-muted)' }}>
              Parent: <span style={{ color: 'var(--fg)' }}>{topic.parentName}</span>
            </div>
          )}
          <div className="text-xs font-medium" style={{ color: 'var(--fg-muted)' }}>
            {topic.members.length} member{topic.members.length === 1 ? '' : 's'}
          </div>
          <div className="flex flex-col gap-1">
            {topic.members.slice(0, 12).map((m) => (
              <button
                key={m.relPath}
                className="truncate rounded px-2 py-1 text-left text-xs"
                style={{ border: '1px solid var(--border)', opacity: m.stale ? 0.6 : 1 }}
                title={m.stale ? 'membership stale — will be re-confirmed on next enrichment' : m.relPath}
                onClick={() => {
                  void (async () => {
                    if (node.vaultId) await switchVault(node.vaultId);
                    await setActiveNote(m.relPath);
                    setGraphViewOpen(false);
                  })();
                }}
              >
                {m.title}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              className="rounded px-2 py-1 text-xs"
              style={{ border: '1px solid var(--border)' }}
              onClick={() => {
                setTopicNameDraft(topic.name);
                setTopicActionError(null);
                setTopicAction({ mode: 'rename', topicId: topic.id, topicName: topic.name });
              }}
            >
              Rename
            </button>
            <button
              className="rounded px-2 py-1 text-xs"
              style={{ border: '1px solid var(--border)', color: 'var(--danger)' }}
              onClick={() => {
                setTopicActionError(null);
                setTopicAction({ mode: 'delete', topicId: topic.id, topicName: topic.name });
              }}
            >
              Delete
            </button>
          </div>
          {node.vaultId && topicId && (
            <TopicAnalysisPanel
              vaultId={node.vaultId}
              topicId={topicId}
              topicName={topic.name}
              members={topic.members.map((m) => ({ relPath: m.relPath, title: m.title }))}
            />
          )}
        </div>
      )}

      {node.type === 'ghost' && (
        <button
          className="rounded px-2 py-1 text-xs"
          style={{ border: '1px solid var(--border)', width: 'fit-content' }}
          onClick={() => {
            void (async () => {
              if (node.vaultId) await switchVault(node.vaultId);
              await createGhostAndOpen(node.label ?? String(node.id).split('/').pop() ?? '');
            })();
          }}
        >
          Create note
        </button>
      )}

      {node.type === 'note' && relPath && connections.length > 0 && (
        <button
          className="rounded px-2 py-1 text-xs"
          style={{ border: '1px solid var(--border)', width: 'fit-content' }}
          onClick={openNote}
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
              {edgeLabel(edge.type)}
              {edge.confidence !== undefined ? ` · ${Math.round(edge.confidence * 100)}% confidence` : ''}
            </span>
            {edge.reason && (
              <span className="text-xs italic" style={{ color: 'var(--fg-muted)' }}>
                “{edge.reason}”
              </span>
            )}
          </button>
        ))}
        {connections.length === 0 && node.type === 'note' && relPath ? (
          <div className="flex flex-col gap-2" style={{ color: 'var(--fg-muted)' }}>
            <div>This note isn&apos;t connected to anything yet. Open it and type [[ to link it to another note.</div>
            <button
              type="button"
              className="self-start rounded px-2 py-1 text-xs"
              style={{ border: '1px solid var(--border)', color: 'var(--fg)' }}
              onClick={openNote}
            >
              Open note
            </button>
          </div>
        ) : connections.length === 0 ? (
          <div style={{ color: 'var(--fg-muted)' }}>No connections.</div>
        ) : null}
      </div>
      <Dialog.Root
        open={topicAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTopicAction(null);
            setTopicActionError(null);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-50 w-[380px] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 p-4"
            style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: '0 8px 30px rgba(0,0,0,0.2)' }}
          >
            <Dialog.Title className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>
              {topicAction?.mode === 'rename' ? 'Rename topic' : 'Delete topic'}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-xs" style={{ color: 'var(--fg-muted)' }}>
              {topicAction?.mode === 'rename'
                ? 'The old name becomes an alias so existing notes keep their meaning.'
                : `Delete “${topicAction?.topicName}”? Its memberships will return to suggestions.`}
            </Dialog.Description>
            {topicAction?.mode === 'rename' && (
              <input
                autoFocus
                aria-label="Topic name"
                value={topicNameDraft}
                onChange={(event) => setTopicNameDraft(event.target.value)}
                className="mt-4 w-full rounded px-2 py-1.5 text-sm"
                style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg-panel)', color: 'var(--fg)' }}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submitTopicAction(); } }}
              />
            )}
            {topicActionError && <div role="alert" className="mt-3 text-xs" style={{ color: 'var(--danger)' }}>{topicActionError}</div>}
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button type="button" className="rounded px-2 py-1 text-xs" style={{ border: '1px solid var(--border)' }}>Cancel</button>
              </Dialog.Close>
              <button type="button" className="rounded px-2 py-1 text-xs" style={{ backgroundColor: topicAction?.mode === 'delete' ? 'var(--danger)' : 'var(--accent)', color: '#fff' }} onClick={() => void submitTopicAction()}>
                {topicAction?.mode === 'rename' ? 'Rename' : 'Delete topic'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
