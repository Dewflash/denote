// src/services/topicStore.ts — the persistent topic ontology for ONE vault (D14/S17).
//
// File: `.denote/ai/topics.json` (S26 `version: 1`). Holds the canonicalized topics (with soft
// membership, aliases, hierarchy, and the name-string centroid used for anti-sprawl matching),
// plus the pass-8 side data that hangs off the ontology: per-folder profiles, "worth revisiting"
// dismissals, and misfit observations. Per-vault only — ontologies are NEVER shared across vaults
// (portability, D36/S25); the combined-view merge is presentation-only and never written here.
//
// Same guarded `.denote/` IO as annotation/similar stores (D23), so no `state/` import. Mutators
// update memory only; the ONTOLOGY ENGINE calls `persist()` once per coherent batch (the pass-8
// pitfall: "ontology writes are frequent — debounce" — one persist per enrichment/sweep, not per
// member). Writes are atomic (tmp+rename) in the backend, and byte-ordering is stable so an
// unchanged ontology never churns the file.

import { foldTopicName, type TopicMatchInput } from '../domain/ontology';
import type { Topic } from '../domain/types';
import type { InternalStoreIO } from './annotationStore';
import { loadMigratedJson } from './migrations';

export const TOPICS_PATH = '.denote/ai/topics.json';

export interface TopicMember {
  notePath: string;
  weight: number;
  confidence: number;
  reconfirmations: number;
  stale: boolean;
  /** The note contentHash the membership was last confirmed at (staleness on content change). */
  contentHash: string;
  /** One-line reason (for the `_topics` note line and insights). */
  reason: string;
}

export interface TopicRecord {
  id: string;
  name: string;
  description: string;
  aliases: string[];
  parentId: string | null;
  relatedIds: string[];
  source: 'user' | 'ai';
  members: TopicMember[];
  /** The name-string centroid (S17 `"{name} — {description}"` embedding), for canonicalization. */
  centroid: number[] | null;
  /** Last materialized `_topics` body hash (S18 lineage); undefined until first materialization. */
  generatedHash?: string;
  /** True once the user edited the materialized `_topics` file — regeneration stops (S18). */
  frozen?: boolean;
  /** Recurrence counters for proposed hierarchy edges — applied at ≥2 (pass-8: "recur ≥2 times"). */
  parentProposals?: Record<string, number>;
  relatedProposals?: Record<string, number>;
}

/** Hierarchy edges become applied once proposed at least this many times (pass-8 brief). */
export const HIERARCHY_RECURRENCE_THRESHOLD = 2;

export interface FolderProfile {
  folderPath: string;
  profile: string;
  /** Hash of the folder's member set + their content hashes — regenerate only when it changes. */
  memberSetHash: string;
}

export interface ResurfaceDismissal {
  relPath: string;
  dismissedAt: string;
}

export interface MisfitRecord {
  relPath: string;
  currentFolder: string;
  suggestedFolder: string;
  reason: string;
}

interface TopicsFile {
  version: 1;
  topics: TopicRecord[];
  folderProfiles: FolderProfile[];
  resurfacingDismissals: ResurfaceDismissal[];
  misfits: MisfitRecord[];
}

export class TopicStore {
  private topics: TopicRecord[] = [];
  private folderProfiles: FolderProfile[] = [];
  private dismissals: ResurfaceDismissal[] = [];
  private misfits: MisfitRecord[] = [];

  constructor(private readonly io: InternalStoreIO) {}

  async load(): Promise<void> {
    const result = await loadMigratedJson(this.io, TOPICS_PATH);
    if (!result || !result.ok) return;
    try {
      const f = result.data as Partial<TopicsFile>;
      this.topics = (f.topics ?? []).map(normalizeRecord);
      this.folderProfiles = f.folderProfiles ?? [];
      this.dismissals = f.resurfacingDismissals ?? [];
      this.misfits = f.misfits ?? [];
    } catch {
      this.topics = [];
      this.folderProfiles = [];
      this.dismissals = [];
      this.misfits = [];
    }
  }

  // ── reads ──────────────────────────────────────────────────────────────────────

  all(): readonly TopicRecord[] {
    return this.topics;
  }
  get(id: string): TopicRecord | undefined {
    return this.topics.find((t) => t.id === id);
  }
  byFoldedName(name: string): TopicRecord | undefined {
    const folded = foldTopicName(name);
    return this.topics.find((t) => foldTopicName(t.name) === folded);
  }

  /** Canonicalization inputs (id + name + aliases + centroid), sorted by id for determinism. */
  matchInputs(): TopicMatchInput[] {
    return [...this.topics]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((t) => ({ id: t.id, name: t.name, aliases: t.aliases, centroid: t.centroid }));
  }

  /** Domain `Topic[]` for graphBuilder — members with weight; NON-stale weights only would hide
   *  legitimate clusters, so stale members are kept (they render dimmed elsewhere). Deterministic. */
  toDomainTopics(): Topic[] {
    return [...this.topics]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((t) => ({
        id: t.id,
        name: t.name,
        aliases: [...t.aliases],
        parentId: t.parentId,
        relatedIds: [...t.relatedIds],
        source: t.source,
        members: t.members.map((m) => ({ notePath: m.notePath, weight: m.weight })),
      }));
  }

  /** Topics a note is a member of (for dominant-topic coloring / insights). */
  topicsForNote(relPath: string): { topic: TopicRecord; member: TopicMember }[] {
    const out: { topic: TopicRecord; member: TopicMember }[] = [];
    for (const t of this.topics) {
      const m = t.members.find((x) => x.notePath === relPath);
      if (m) out.push({ topic: t, member: m });
    }
    return out;
  }

  folderProfile(folderPath: string): FolderProfile | undefined {
    return this.folderProfiles.find((p) => p.folderPath === folderPath);
  }
  allFolderProfiles(): readonly FolderProfile[] {
    return this.folderProfiles;
  }
  allMisfits(): readonly MisfitRecord[] {
    return this.misfits;
  }
  dismissedResurfacing(): Set<string> {
    return new Set(this.dismissals.map((d) => d.relPath));
  }

  // ── mutators (memory only; caller persist()s) ────────────────────────────────────

  createTopic(rec: Omit<TopicRecord, 'members'> & { members?: TopicMember[] }): TopicRecord {
    const record: TopicRecord = { ...rec, members: rec.members ?? [] };
    this.topics.push(record);
    return record;
  }

  addAlias(topicId: string, alias: string): void {
    const t = this.get(topicId);
    if (!t) return;
    const folded = foldTopicName(alias);
    if (foldTopicName(t.name) === folded) return;
    if (!t.aliases.some((a) => foldTopicName(a) === folded)) t.aliases.push(alias);
  }

  setCentroid(topicId: string, centroid: number[] | null): void {
    const t = this.get(topicId);
    if (t) t.centroid = centroid;
  }
  setDescription(topicId: string, description: string): void {
    const t = this.get(topicId);
    if (t) t.description = description;
  }
  setParent(topicId: string, parentId: string | null): void {
    const t = this.get(topicId);
    if (t) t.parentId = parentId;
  }
  addRelated(topicId: string, relatedId: string): void {
    const t = this.get(topicId);
    if (t && relatedId !== topicId && !t.relatedIds.includes(relatedId)) t.relatedIds.push(relatedId);
  }

  /** Record a parent proposal; apply `parentId` once it recurs ≥ threshold (pass-8). Returns true
   *  when the parent edge becomes applied on this call. */
  proposeParent(childId: string, parentId: string): boolean {
    const t = this.get(childId);
    if (!t || childId === parentId || t.parentId === parentId) return false;
    const map = (t.parentProposals ??= {});
    map[parentId] = (map[parentId] ?? 0) + 1;
    if (t.parentId === null && map[parentId] >= HIERARCHY_RECURRENCE_THRESHOLD) {
      t.parentId = parentId;
      return true;
    }
    return false;
  }

  /** Record a related-topic proposal (symmetric); apply once it recurs ≥ threshold. */
  proposeRelated(aId: string, bId: string): boolean {
    const t = this.get(aId);
    if (!t || aId === bId || t.relatedIds.includes(bId)) return false;
    const map = (t.relatedProposals ??= {});
    map[bId] = (map[bId] ?? 0) + 1;
    if (map[bId] >= HIERARCHY_RECURRENCE_THRESHOLD) {
      this.addRelated(aId, bId);
      this.addRelated(bId, aId);
      return true;
    }
    return false;
  }
  setName(topicId: string, name: string): void {
    const t = this.get(topicId);
    if (!t) return;
    // Rename → the old name becomes an alias (pass-8 topic management). Set the new name FIRST so
    // addAlias doesn't reject the old name as "== canonical name".
    const oldName = t.name;
    t.name = name;
    if (foldTopicName(oldName) !== foldTopicName(name)) this.addAlias(topicId, oldName);
  }
  setGenerated(topicId: string, generatedHash: string): void {
    const t = this.get(topicId);
    if (t) {
      t.generatedHash = generatedHash;
      t.frozen = false;
    }
  }
  freeze(topicId: string): void {
    const t = this.get(topicId);
    if (t) t.frozen = true;
  }

  /** Set (or refresh) a note's membership in a topic. Reconfirmation bumps the counter when the
   *  content hash matches a prior confirmation; a new hash resets stale. */
  setMembership(topicId: string, member: TopicMember): void {
    const t = this.get(topicId);
    if (!t) return;
    const existing = t.members.find((m) => m.notePath === member.notePath);
    if (existing) {
      Object.assign(existing, member);
    } else {
      t.members.push(member);
    }
  }

  /** Mark all of a note's memberships stale (its content changed — S17). */
  markNoteStale(relPath: string): boolean {
    let touched = false;
    for (const t of this.topics) {
      for (const m of t.members) {
        if (m.notePath === relPath && !m.stale) {
          m.stale = true;
          touched = true;
        }
      }
    }
    return touched;
  }

  /** Remove a note from every topic (delete). Returns true if anything changed. */
  removeNoteMemberships(relPath: string): boolean {
    let touched = false;
    for (const t of this.topics) {
      const before = t.members.length;
      t.members = t.members.filter((m) => m.notePath !== relPath);
      if (t.members.length !== before) touched = true;
    }
    this.misfits = this.misfits.filter((m) => m.relPath !== relPath);
    return touched;
  }

  /** Delete a topic entirely (management UI). Members are dropped; references are cleaned. */
  deleteTopic(topicId: string): void {
    this.topics = this.topics.filter((t) => t.id !== topicId);
    for (const t of this.topics) {
      if (t.parentId === topicId) t.parentId = null;
      t.relatedIds = t.relatedIds.filter((r) => r !== topicId);
    }
  }

  /** Merge `fromId` into `intoId` (management UI / sweep): move members, fold aliases, drop source. */
  mergeTopics(fromId: string, intoId: string): void {
    const from = this.get(fromId);
    const into = this.get(intoId);
    if (!from || !into || fromId === intoId) return;
    for (const m of from.members) {
      const existing = into.members.find((x) => x.notePath === m.notePath);
      if (existing) existing.weight = Math.max(existing.weight, m.weight);
      else into.members.push({ ...m });
    }
    this.addAlias(intoId, from.name);
    for (const a of from.aliases) this.addAlias(intoId, a);
    this.deleteTopic(fromId);
  }

  /** Prune topics with no members (empty after content changes / Organize-vault). */
  pruneEmptyTopics(): string[] {
    const removed = this.topics.filter((t) => t.members.length === 0 && t.source === 'ai').map((t) => t.id);
    for (const id of removed) this.deleteTopic(id);
    return removed;
  }

  setFolderProfile(profile: FolderProfile): void {
    this.folderProfiles = this.folderProfiles.filter((p) => p.folderPath !== profile.folderPath);
    this.folderProfiles.push(profile);
  }

  setMisfits(misfits: MisfitRecord[]): void {
    this.misfits = misfits;
  }

  dismissResurfacing(relPath: string, at: string): void {
    if (!this.dismissals.some((d) => d.relPath === relPath)) {
      this.dismissals.push({ relPath, dismissedAt: at });
    }
  }
  /** Re-eligible after 90 more days (pass-8): drop dismissals older than the window. */
  pruneDismissals(now: number, windowDays = 90): void {
    const cutoff = now - windowDays * 86400_000;
    this.dismissals = this.dismissals.filter((d) => Date.parse(d.dismissedAt) >= cutoff);
  }

  // ── D4a re-key ──────────────────────────────────────────────────────────────────

  remapPath(oldRel: string, newRel: string): void {
    for (const t of this.topics) {
      for (const m of t.members) if (m.notePath === oldRel) m.notePath = newRel;
    }
    for (const m of this.misfits) if (m.relPath === oldRel) m.relPath = newRel;
    for (const d of this.dismissals) if (d.relPath === oldRel) d.relPath = newRel;
  }

  // ── persistence ──────────────────────────────────────────────────────────────────

  private toJSON(): TopicsFile {
    const topics = [...this.topics].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const t of topics) t.members.sort((a, b) => (a.notePath < b.notePath ? -1 : a.notePath > b.notePath ? 1 : 0));
    return {
      version: 1,
      topics,
      folderProfiles: [...this.folderProfiles].sort((a, b) => (a.folderPath < b.folderPath ? -1 : 1)),
      resurfacingDismissals: [...this.dismissals].sort((a, b) => (a.relPath < b.relPath ? -1 : 1)),
      misfits: [...this.misfits].sort((a, b) => (a.relPath < b.relPath ? -1 : 1)),
    };
  }

  async persist(): Promise<void> {
    await this.io.write(TOPICS_PATH, JSON.stringify(this.toJSON(), null, 2) + '\n');
  }
}

function normalizeRecord(r: Partial<TopicRecord>): TopicRecord {
  return {
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    description: String(r.description ?? ''),
    aliases: r.aliases ?? [],
    parentId: r.parentId ?? null,
    relatedIds: r.relatedIds ?? [],
    source: r.source === 'user' ? 'user' : 'ai',
    members: (r.members ?? []).map((m) => ({
      notePath: m.notePath,
      weight: m.weight ?? 0,
      confidence: m.confidence ?? m.weight ?? 0,
      reconfirmations: m.reconfirmations ?? 0,
      stale: m.stale ?? false,
      contentHash: m.contentHash ?? '',
      reason: m.reason ?? '',
    })),
    centroid: r.centroid ?? null,
    generatedHash: r.generatedHash,
    frozen: r.frozen,
    parentProposals: r.parentProposals,
    relatedProposals: r.relatedProposals,
  };
}
