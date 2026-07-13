// src/domain/graphBuilder.ts — build {nodes, edges} from parsed notes + optional topics
// and ai-similar pairs, across a vault SET (D17). PURE and DETERMINISTIC: output is sorted
// by id so snapshots are stable.
//
// Edge model (D6): tags and topics are HUB nodes — never note↔note cliques. Every edge
// carries `source`; AI edges carry `confidence` + `reason` (D6/D6a). Similarity edges are
// supplied already-vetted (the embedding gate + LLM naming gate live in pass 7); this pure
// builder only lays them out.

import type { GraphEdge, GraphNode, NoteId, ParsedNote, Topic, VaultId } from './types';
import { buildLinkIndex, resolveLink } from './links';

export interface GraphVaultInput {
  vaultId: VaultId;
  notes: ParsedNote[];
  topics?: Topic[];
}

/** A vetted ai-similar pair (S15/S24). Endpoints may span vaults. */
export interface SimilarPair {
  aVaultId: VaultId;
  aRelPath: string;
  bVaultId: VaultId;
  bRelPath: string;
  reason: string;
  confidence: number;
  weight?: number;
}

export interface GraphBuildInput {
  vaults: GraphVaultInput[];
  similarPairs?: SimilarPair[];
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const noteId = (vaultId: VaultId, relPath: string): NoteId => `${vaultId}/${relPath}`;

export function buildGraph(input: GraphBuildInput): Graph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  const addNode = (n: GraphNode) => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
  };
  // Collapse parallel edges by id, summing weight (e.g. two wikilinks to the same note).
  const addEdge = (e: GraphEdge) => {
    const existing = edges.get(e.id);
    if (existing) existing.weight += e.weight;
    else edges.set(e.id, e);
  };

  const noteNodeIds = new Set<string>();

  // Deterministic iteration: sort vaults and their notes.
  const vaults = [...input.vaults].sort((a, b) => cmp(a.vaultId, b.vaultId));

  // Pass A: note nodes (needed before topic/similar edges can reference them).
  for (const v of vaults) {
    for (const note of [...v.notes].sort((a, b) => cmp(a.relPath, b.relPath))) {
      const id = noteId(v.vaultId, note.relPath);
      addNode({ id, type: 'note', vaultId: v.vaultId, label: note.title });
      noteNodeIds.add(id);
    }
  }

  // Pass B: per-vault link + tag edges.
  for (const v of vaults) {
    const sortedNotes = [...v.notes].sort((a, b) => cmp(a.relPath, b.relPath));
    const refs = sortedNotes.map((n) => ({ relPath: n.relPath, title: n.title }));
    const userLinkTargets = new Set(
      sortedNotes.flatMap((note) => note.links.map((link) => `${note.relPath}\u0000${link.targetTitle.toLowerCase()}`)),
    );

    // Wikilink / embed edges (resolution is vault-scoped, S4/D17).
    const index = buildLinkIndex(sortedNotes, v.vaultId);
    for (const entry of index) {
      const from = noteId(v.vaultId, entry.fromPath);
      const type: GraphEdge['type'] = entry.link.embed ? 'embed' : 'wikilink';
      let to: string;
      if (entry.resolution.kind === 'note') {
        to = noteId(v.vaultId, entry.resolution.relPath);
      } else {
        to = entry.resolution.id;
        // vaultId is redundant with the id's own `ghost:{vaultId}/...` encoding (S4), but an
        // explicit field lets multi-vault UI (e.g. "which vault to create this ghost note in")
        // read it the same way it reads a note node's vaultId, without string-parsing the id.
        addNode({ id: entry.resolution.id, type: 'ghost', vaultId: v.vaultId, label: entry.link.targetTitle });
      }
      addEdge({ id: `${type}:${from}->${to}`, from, to, type, source: 'parser', weight: 1 });
    }

    // AI takeover writes reversible suggestions into `ai:` frontmatter. They are real graph
    // relationships, but remain visibly separate from links the owner typed in the body.
    for (const note of sortedNotes) {
      const from = noteId(v.vaultId, note.relPath);
      for (const target of note.aiFrontmatter?.links ?? []) {
        const key = `${note.relPath}\u0000${target.toLowerCase()}`;
        if (userLinkTargets.has(key)) continue;
        const resolution = resolveLink(target, refs, v.vaultId);
        const to = resolution.kind === 'note' ? noteId(v.vaultId, resolution.relPath) : resolution.id;
        if (resolution.kind === 'ghost') {
          addNode({ id: resolution.id, type: 'ghost', vaultId: v.vaultId, label: target });
        }
        addEdge({
          id: `ai-link:${from}->${to}`,
          from,
          to,
          type: 'ai-link',
          source: 'ai',
          weight: 1,
          confidence: 0.75,
          reason: `Provisional link suggested by ${note.aiFrontmatter?.model ?? 'on-device AI'}`,
        });
      }
    }

    // Tag hub edges (D6): tag ids are GLOBAL (merge across vaults).
    for (const note of sortedNotes) {
      const from = noteId(v.vaultId, note.relPath);
      for (const tag of note.tags) {
        const tagId = `tag:${tag.toLowerCase()}` as const;
        addNode({ id: tagId, type: 'tag', label: tag });
        addEdge({
          id: `note-tag:${from}->${tagId}`,
          from,
          to: tagId,
          type: 'note-tag',
          source: 'parser',
          weight: 1,
        });
      }
      const userTags = new Set(note.tags.map((tag) => tag.toLowerCase()));
      for (const tag of note.aiFrontmatter?.tags ?? []) {
        if (userTags.has(tag.toLowerCase())) continue;
        const tagId = `tag:${tag.toLowerCase()}` as const;
        const from = noteId(v.vaultId, note.relPath);
        addNode({ id: tagId, type: 'tag', label: tag });
        addEdge({
          id: `ai-tag:${from}->${tagId}`,
          from,
          to: tagId,
          type: 'ai-tag',
          source: 'ai',
          weight: 1,
          confidence: 0.75,
          reason: `Provisional tag suggested by ${note.aiFrontmatter?.model ?? 'on-device AI'}`,
        });
      }
    }
  }

  // Pass C: topics (per-vault) — hub nodes + note-topic + topic-topic edges.
  for (const v of vaults) {
    for (const topic of [...(v.topics ?? [])].sort((a, b) => cmp(a.id, b.id))) {
      const topicNodeId = `topic:${topic.id}` as const;
      addNode({ id: topicNodeId, type: 'topic', vaultId: v.vaultId, label: topic.name });
      const edgeSource: GraphEdge['source'] = topic.source === 'user' ? 'user' : 'ai';

      for (const member of topic.members) {
        const from = noteId(v.vaultId, member.notePath);
        if (!noteNodeIds.has(from)) continue; // topic references an unloaded note
        addEdge({
          id: `note-topic:${from}->${topicNodeId}`,
          from,
          to: topicNodeId,
          type: 'note-topic',
          source: edgeSource,
          weight: member.weight,
          ...(edgeSource === 'ai' ? { reason: `member of topic "${topic.name}"` } : {}),
        });
      }

      if (topic.parentId) {
        const parentNodeId = `topic:${topic.parentId}` as const;
        addEdge({
          id: `topic-topic:${topicNodeId}->${parentNodeId}`,
          from: topicNodeId,
          to: parentNodeId,
          type: 'topic-topic',
          source: edgeSource,
          weight: 1,
          ...(edgeSource === 'ai' ? { reason: 'topic hierarchy' } : {}),
        });
      }
      for (const relId of topic.relatedIds) {
        const relNodeId = `topic:${relId}` as const;
        const [lo, hi] = [topicNodeId, relNodeId].sort(cmp);
        addEdge({
          id: `topic-topic:${lo}<->${hi}`,
          from: lo,
          to: hi,
          type: 'topic-topic',
          source: edgeSource,
          weight: 1,
          ...(edgeSource === 'ai' ? { reason: 'related topics' } : {}),
        });
      }
    }
  }

  // Pass D: ai-similar edges (unordered, deduped). Rendered only if both endpoints loaded.
  for (const pair of input.similarPairs ?? []) {
    const aId = noteId(pair.aVaultId, pair.aRelPath);
    const bId = noteId(pair.bVaultId, pair.bRelPath);
    if (!noteNodeIds.has(aId) || !noteNodeIds.has(bId)) continue;
    if (aId === bId) continue;
    const [lo, hi] = [aId, bId].sort(cmp);
    addEdge({
      id: `ai-similar:${lo}<->${hi}`,
      from: lo,
      to: hi,
      type: 'ai-similar',
      source: 'ai',
      weight: pair.weight ?? pair.confidence,
      confidence: pair.confidence,
      reason: pair.reason,
    });
  }

  return {
    nodes: [...nodes.values()].sort((a, b) => cmp(a.id, b.id)),
    edges: [...edges.values()].sort((a, b) => cmp(a.id, b.id)),
  };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
