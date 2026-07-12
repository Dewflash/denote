// src/state/vaultOntologyEngine.ts — the per-vault topic ontology + semantic-clustering engine
// (D14/D8c/S17/S18, pass-8 flagship). One engine per open vault, wired alongside search / AI /
// embeddings on the Repository's hooks; integration-testable against a real temp-dir Repository
// with a mock embeddings backend + a controllable LLM (no Tauri).
//
// What it owns:
//   - CANONICALIZATION (D14/R3, anti-sprawl): every enrichment-proposed topic goes through
//     exact-name → alias → centroid ≥ 0.80 → create, so "banking" / "banks" / "banking system"
//     collapse to ONE topic. This is the pass-killer if skipped.
//   - soft MEMBERSHIP (S17): weight = confidence + folder-co-location + reconfirmation, with
//     staleness on content change.
//   - HIERARCHY: parent/related edges are proposals until they recur ≥ 2× (then applied).
//   - `_topics/` MATERIALIZATION (D8c/S18): byte-stable hub notes for topics with ≥ 3 members,
//     written through the repository (D23), with the user-edit FREEZE rule.
//   - FOLDER PROFILES + MISFIT detection, RESURFACING, and the cancellable Organize-vault sweep.
//
// AI never touches note bodies here except the sanctioned `_topics/*.md` write path (D8/D8c).

import {
  assembleTopicFile,
  canonicalizeTopic,
  centroidOf,
  computeResurfacing,
  cosine,
  decideTopicFile,
  dominantTopic,
  isMisfit,
  membershipWeight,
  normalize,
  readTopicFile,
  renderTopicBody,
  setScalar,
  sha256Hex,
  splitFrontmatter,
  joinFrontmatter,
  topicBodyHash,
  topicCentroidText,
  topicFilePath,
  type ResurfaceCandidate,
  type ResurfaceCard,
  type Membership,
} from '../domain';
import type { EnrichResult, TopicStub, AiRouter } from '../services/aiClient';
import type { EmbeddingsBackend } from '../services/embeddings';
import { DenoteError } from '../services/errors';
import { TopicStore, type MisfitRecord, type TopicMember, type TopicRecord } from '../services/topicStore';
import type { ParsedNote } from '../domain';
import type { Repository } from './repository';

const SKIP_DIRS = ['_topics/', '.denote/'];
const MIN_MEMBERS_FOR_FILE = 3;
const MIN_FOLDER_NOTES = 3;
const RESURFACE_RECENT_DAYS = 7;
const DAY_MS = 86_400_000;

export interface VaultOntologyDeps {
  now?: () => number;
  localOnly?: () => boolean;
  onChange?: () => void;
  /** Re-enrich a note (Organize-vault "re-enrich stale notes"). Supplied by vaultStore = the AI
   *  engine's enrichNow; omitted in tests that drive enrichment directly. */
  reenrich?: (relPath: string) => Promise<void>;
}

/** A simple cooperative cancel token for the Organize-vault batch. */
export interface CancelToken {
  aborted: boolean;
}

export type OrganizePhase = 're-enrich' | 'folders' | 'topics';
export interface OrganizeResult {
  cancelled: boolean;
  mergedTopics: number;
  prunedTopics: number;
  materializedTopics: number;
}

export class VaultOntologyEngine {
  private readonly now: () => number;

  constructor(
    private readonly repo: Repository,
    private readonly backend: EmbeddingsBackend,
    private readonly router: AiRouter,
    private readonly store: TopicStore,
    private readonly deps: VaultOntologyDeps = {},
  ) {
    this.now = deps.now ?? Date.now;
  }

  async attach(): Promise<void> {
    await this.store.load();
    this.repo.registerRekeyHook(async (oldRel, newRel) => {
      this.store.remapPath(oldRel, newRel);
      await this.store.persist();
    });
    this.repo.registerDeleteHook(async (rel) => {
      if (this.store.removeNoteMemberships(rel)) {
        await this.store.persist();
        this.deps.onChange?.();
      }
    });
  }

  dispose(): void {
    /* no timers of its own — enrichment/embedding engines drive it */
  }

  // ── reads for the UI / graph ─────────────────────────────────────────────────────

  /** Domain topics for graphBuilder (semantic clustering source). */
  domainTopics() {
    return this.store.toDomainTopics();
  }

  /** Existing-topic stubs fed into every enrichNote prompt so the model ATTACHES, not invents
   *  (D14/R3 mandatory retrieval step). */
  topicStubs(): TopicStub[] {
    return this.store.all().map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      memberTitles: t.members
        .slice()
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 3)
        .map((m) => this.titleOf(m.notePath)),
    }));
  }

  /** A note's memberships as {topicId, name, weight, stale} (dominant-topic coloring / insights). */
  membershipsForNote(relPath: string): Membership[] {
    return this.store.topicsForNote(relPath).map(({ topic, member }) => ({
      topicId: topic.id,
      name: topic.name,
      weight: member.weight,
      stale: member.stale,
    }));
  }

  /** Topic detail for the graph inspector / insights panel (pass-8): name, description, parent,
   *  and members sorted strongest-first. */
  topicInsights(topicId: string):
    | {
        id: string;
        name: string;
        description: string;
        parentName: string | null;
        members: { relPath: string; title: string; weight: number; stale: boolean }[];
      }
    | undefined {
    const t = this.store.get(topicId);
    if (!t) return undefined;
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      parentName: t.parentId ? this.store.get(t.parentId)?.name ?? null : null,
      members: [...t.members]
        .sort((a, b) => b.weight - a.weight)
        .map((m) => ({ relPath: m.notePath, title: this.titleOf(m.notePath), weight: m.weight, stale: m.stale })),
    };
  }

  folderProfile(folderPath: string) {
    return this.store.folderProfile(folderPath);
  }
  misfits() {
    return this.store.allMisfits();
  }

  // ── change signal (from Repository.onIndexChange) ────────────────────────────────

  /** A note changed: mark its memberships stale (S17) until the next enrichment reconfirms. */
  noteChanged(relPath: string, note: ParsedNote | null): void {
    if (note === null) return; // delete handled by the delete hook
    if (this.shouldSkip(relPath, note)) return;
    if (this.store.markNoteStale(relPath)) {
      void this.store.persist();
      this.deps.onChange?.();
    }
  }

  // ── canonicalization + membership (called by the AI engine after each enrichment) ─

  /** Fold an enrichment result's topics into the persistent ontology (D14). Called with the note's
   *  current content hash so membership staleness/reconfirmation stays correct. */
  async onEnrichResult(
    relPath: string,
    hash: string,
    result: EnrichResult,
  ): Promise<void> {
    if (result.topics.length === 0) return;
    const affected = new Set<string>();

    // Deterministic order so repeated runs are stable.
    const proposals = [...result.topics].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const st of proposals) {
      const vec = await this.embedName(st.name, st.reason);
      const match = canonicalizeTopic(
        { name: st.name, existingTopicId: st.existingTopicId },
        this.store.matchInputs(),
        vec,
      );

      let topicId: string;
      if (match.kind === 'create') {
        topicId = crypto.randomUUID();
        this.store.createTopic({
          id: topicId,
          name: st.name,
          description: st.reason ?? '',
          aliases: [],
          parentId: null,
          relatedIds: [],
          source: 'ai',
          centroid: vec,
        });
      } else {
        topicId = match.topicId;
        if (match.kind === 'centroid') this.store.addAlias(topicId, match.addAlias);
      }
      affected.add(topicId);

      this.applyMembership(topicId, relPath, hash, st.confidence, st.reason);

      // Hierarchy (recurrence-gated). Parent/related names are canonicalized too (find-or-create).
      if (st.parentName) {
        const parentId = await this.resolveOrCreateTopic(st.parentName);
        if (parentId && parentId !== topicId) {
          if (this.store.proposeParent(topicId, parentId)) affected.add(parentId);
        }
      }
      for (const relName of st.relatedNames ?? []) {
        const relId = await this.resolveOrCreateTopic(relName);
        if (relId && relId !== topicId) {
          if (this.store.proposeRelated(topicId, relId)) affected.add(relId);
        }
      }
    }

    // Materialize affected topics (and their parents) with ≥3 members (D8c).
    for (const id of affected) {
      const parentId = this.store.get(id)?.parentId;
      if (parentId) affected.add(parentId);
    }
    for (const id of affected) await this.materializeTopic(id);

    await this.store.persist();
    this.deps.onChange?.();
  }

  private applyMembership(topicId: string, relPath: string, hash: string, confidence: number, reason: string): void {
    const topic = this.store.get(topicId);
    if (!topic) return;
    const existing = topic.members.find((m) => m.notePath === relPath);
    const reconfirmations = existing
      ? existing.contentHash === hash
        ? existing.reconfirmations
        : existing.reconfirmations + 1
      : 0;
    const folderCoLocated = topic.members.some(
      (m) => m.notePath !== relPath && dirOf(m.notePath) === dirOf(relPath),
    );
    const member: TopicMember = {
      notePath: relPath,
      confidence,
      reconfirmations,
      stale: false,
      contentHash: hash,
      reason,
      weight: membershipWeight(confidence, { folderCoLocated, reconfirmations }),
    };
    this.store.setMembership(topicId, member);
  }

  /** Canonicalize a bare topic NAME (parent/related hint) to an existing or newly-created topic. */
  private async resolveOrCreateTopic(name: string): Promise<string | null> {
    const vec = await this.embedName(name, '');
    const match = canonicalizeTopic({ name }, this.store.matchInputs(), vec);
    if (match.kind !== 'create') {
      if (match.kind === 'centroid') this.store.addAlias(match.topicId, match.addAlias);
      return match.topicId;
    }
    const id = crypto.randomUUID();
    this.store.createTopic({
      id,
      name,
      description: '',
      aliases: [],
      parentId: null,
      relatedIds: [],
      source: 'ai',
      centroid: vec,
    });
    return id;
  }

  /**
   * Land a cross-note THEME from deep-organize (D13/pass-9) as a topic in THIS vault. The theme's
   * member titles were already resolved to relPaths in this vault by the caller. Cloud output gets
   * NO canonicalization bypass (D14): the theme name flows through exact→alias→centroid→create
   * like any other topic, so a cloud theme can't spawn a near-duplicate of an existing topic.
   */
  async applyTheme(theme: {
    name: string;
    description: string;
    reason: string;
    confidence: number;
    members: string[];
  }): Promise<void> {
    const members = theme.members.filter((rel) => this.repo.getParsed(rel) && !this.shouldSkip(rel, this.repo.getParsed(rel)!));
    if (members.length < 2) return; // a theme needs ≥2 member notes to be a theme
    const vec = await this.embedName(theme.name, theme.description);
    const match = canonicalizeTopic({ name: theme.name }, this.store.matchInputs(), vec);
    let topicId: string;
    if (match.kind === 'create') {
      topicId = crypto.randomUUID();
      this.store.createTopic({
        id: topicId,
        name: theme.name,
        description: theme.description || theme.reason,
        aliases: [],
        parentId: null,
        relatedIds: [],
        source: 'ai',
        centroid: vec,
      });
    } else {
      topicId = match.topicId;
      if (match.kind === 'centroid') this.store.addAlias(topicId, match.addAlias);
    }
    for (const rel of members) {
      const hash = this.repo.getHash(rel);
      if (hash) this.applyMembership(topicId, rel, hash, theme.confidence, theme.reason);
    }
    await this.materializeTopic(topicId);
    await this.store.persist();
    this.deps.onChange?.();
  }

  /** Resolve note TITLES (as the cloud cited them) to relPaths in this vault, for theme members. */
  relPathsForTitles(titles: string[]): string[] {
    const want = new Set(titles.map((t) => t.trim().toLowerCase()));
    const out: string[] = [];
    for (const n of this.repo.index.allNotes()) {
      if (this.shouldSkip(n.relPath, n)) continue;
      if (want.has(n.title.trim().toLowerCase())) out.push(n.relPath);
    }
    return out;
  }

  /** Time-ordered member stubs for a topic (deep insights, D13). Summary = cached or body head. */
  insightMembers(topicId: string): { relPath: string; title: string; summary: string; time: number }[] {
    const t = this.store.get(topicId);
    if (!t) return [];
    return t.members
      .map((m) => {
        const note = this.repo.getParsed(m.notePath);
        const body = (note?.bodyText ?? '').trim();
        return {
          relPath: m.notePath,
          title: note?.title ?? basename(m.notePath),
          summary: m.reason || (body ? body.split(/\s+/).slice(0, 40).join(' ') : ''),
          time: this.repo.index.mtimes.get(m.notePath) ?? 0,
        };
      })
      .sort((a, b) => a.time - b.time);
  }

  // ── `_topics/` materialization (D8c/S18) ─────────────────────────────────────────

  /** Regenerate a topic's hub note if it has ≥3 members and the ontology moved; freeze if the user
   *  edited it. Never creates below the member threshold; never deletes an existing file. */
  async materializeTopic(topicId: string): Promise<void> {
    const t = this.store.get(topicId);
    if (!t || t.members.length < MIN_MEMBERS_FOR_FILE) return;

    const input = this.topicFileInput(t);
    const desiredBody = renderTopicBody(input);
    const path = topicFilePath(t.name);

    const existingText = await this.repo.readNote(path).catch(() => null);
    const parsed = existingText !== null ? readTopicFile(existingText) : null;
    const decision = decideTopicFile({
      exists: existingText !== null,
      currentSource: parsed?.source ?? null,
      currentBodyHash: parsed ? topicBodyHash(parsed.body) : null,
      storedGeneratedHash: t.generatedHash ?? parsed?.generatedHash ?? null,
      desiredBody,
    });

    if (decision.action === 'create' || decision.action === 'regenerate') {
      const { content, generatedHash } = assembleTopicFile(input, 'ai');
      await this.repo.saveNote(path, content);
      this.store.setGenerated(topicId, generatedHash);
    } else if (decision.action === 'freeze' && existingText !== null) {
      // Preserve the user's body; flip source → user-modified once (textual, S1-safe), then stop.
      const norm = normalize(existingText);
      const { fmLines, body } = splitFrontmatter(norm);
      const frozen = joinFrontmatter(fmLines ? setScalar(fmLines, 'source', 'user-modified') : fmLines, body);
      if (frozen !== norm) await this.repo.saveNote(path, frozen);
      this.store.freeze(topicId);
    }
  }

  private topicFileInput(t: TopicRecord) {
    const parentName = t.parentId ? this.store.get(t.parentId)?.name ?? null : null;
    const relatedNames = t.relatedIds
      .map((id) => this.store.get(id)?.name)
      .filter((n): n is string => !!n);
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      parentName,
      relatedNames,
      members: t.members.map((m) => ({
        title: this.titleOf(m.notePath),
        reason: m.reason,
        weight: m.weight,
        relPath: m.notePath,
      })),
    };
  }

  // ── Organize-vault batch (on-device, progress, cancellable) ──────────────────────

  async organizeVault(
    opts: { onProgress?: (done: number, total: number, phase: OrganizePhase) => void; signal?: CancelToken } = {},
  ): Promise<OrganizeResult> {
    const signal = opts.signal ?? { aborted: false };
    const result: OrganizeResult = { cancelled: false, mergedTopics: 0, prunedTopics: 0, materializedTopics: 0 };

    // Phase 1: re-enrich stale notes (skip if no re-enricher wired).
    if (this.deps.reenrich) {
      const stale = this.staleNotePaths();
      for (let i = 0; i < stale.length; i++) {
        if (signal.aborted) return { ...result, cancelled: true };
        await this.deps.reenrich(stale[i]);
        opts.onProgress?.(i + 1, stale.length, 're-enrich');
      }
    }

    // Phase 2: folder profiles + misfit detection.
    if (signal.aborted) return { ...result, cancelled: true };
    await this.rebuildFolderProfilesAndMisfits(opts.onProgress, signal);
    if (signal.aborted) return { ...result, cancelled: true };

    // Phase 3: canonicalization merge sweep + prune + materialize.
    result.mergedTopics = await this.mergeSweep(signal);
    if (signal.aborted) {
      await this.store.persist();
      return { ...result, cancelled: true };
    }
    result.prunedTopics = this.store.pruneEmptyTopics().length;
    result.materializedTopics = await this.materializeAll(signal);

    await this.store.persist();
    this.deps.onChange?.();
    return result;
  }

  /** Merge two existing ai topics when centroids are ≥ 0.92 AND the LLM confirms (S17). */
  private async mergeSweep(signal: CancelToken): Promise<number> {
    let merged = 0;
    const localOnly = this.deps.localOnly?.() ?? false;
    let client;
    try {
      client = this.router.route('label-similarity', { localOnly });
    } catch (err) {
      if (err instanceof DenoteError && err.kind === 'local-only-blocked') return 0;
      throw err;
    }
    // Re-scan each pass since ids disappear on merge.
    let progress = true;
    while (progress && !signal.aborted) {
      progress = false;
      const topics = this.store.all().filter((t) => t.source === 'ai' && t.centroid);
      outer: for (let i = 0; i < topics.length; i++) {
        for (let j = i + 1; j < topics.length; j++) {
          const a = topics[i];
          const b = topics[j];
          if (!a.centroid || !b.centroid) continue;
          if (cosine(a.centroid, b.centroid) < 0.92) continue;
          let label;
          try {
            label = await client.labelSimilarity({
              a: { relPath: a.id, title: a.name, summary: a.description },
              b: { relPath: b.id, title: b.name, summary: b.description },
            });
          } catch {
            continue;
          }
          if (label.related) {
            this.store.mergeTopics(b.id, a.id);
            merged++;
            progress = true;
            break outer; // topic list is now stale — rescan
          }
        }
      }
    }
    return merged;
  }

  private async materializeAll(signal: CancelToken): Promise<number> {
    let count = 0;
    for (const t of this.store.all()) {
      if (signal.aborted) break;
      if (t.members.length < MIN_MEMBERS_FOR_FILE) continue;
      await this.materializeTopic(t.id);
      count++;
    }
    return count;
  }

  /** Folder profiles (member summaries + dominant topics → one paragraph) + misfit suggestions. */
  private async rebuildFolderProfilesAndMisfits(
    onProgress: ((done: number, total: number, phase: OrganizePhase) => void) | undefined,
    signal: CancelToken,
  ): Promise<void> {
    const folders = this.foldersWithNotes();
    const folderPaths = [...folders.keys()].sort();
    const misfits: MisfitRecord[] = [];
    const localOnly = this.deps.localOnly?.() ?? false;
    let summarizer;
    try {
      summarizer = this.router.route('summarize', { localOnly });
    } catch {
      summarizer = null; // localOnly + network-only routing → skip profiles, still do misfit
    }

    // Precompute folder centroids + each folder's dominant-topic set.
    const folderCentroids = new Map<string, number[] | null>();
    const folderDominants = new Map<string, Set<string>>();
    for (const [folder, paths] of folders) {
      const vectors = await this.vectorsFor(paths);
      folderCentroids.set(folder, centroidOf([...vectors.values()]));
      const doms = new Set<string>();
      for (const p of paths) {
        const dom = dominantTopic(this.membershipsForNote(p));
        if (dom) doms.add(dom.topicId);
      }
      folderDominants.set(folder, doms);
    }

    for (let i = 0; i < folderPaths.length; i++) {
      if (signal.aborted) return;
      const folder = folderPaths[i];
      const paths = folders.get(folder)!;
      onProgress?.(i + 1, folderPaths.length, 'folders');

      // Profile (regenerate only when the member set changed).
      const memberSetHash = this.folderMemberSetHash(paths);
      const existing = this.store.folderProfile(folder);
      if (summarizer && (!existing || existing.memberSetHash !== memberSetHash)) {
        const doms = [...(folderDominants.get(folder) ?? new Set())].map((id) => this.store.get(id)?.name).filter(Boolean);
        const seed = `Folder "${folder || 'root'}" — dominant topics: ${doms.join(', ') || 'none'}. Notes: ${paths
          .map((p) => this.titleOf(p))
          .join('; ')}.`;
        try {
          const { summary } = await summarizer.summarize({ text: seed, maxWords: 40 });
          if (summary.trim()) this.store.setFolderProfile({ folderPath: folder, profile: summary.trim(), memberSetHash });
        } catch {
          /* summarizer unavailable — leave the previous profile */
        }
      }

      // Misfit: a note with zero dominant-topic overlap with its folder AND a far embedding.
      const centroid = folderCentroids.get(folder) ?? null;
      const noteVectors = await this.vectorsFor(paths);
      for (const p of paths) {
        const noteDom = dominantTopic(this.membershipsForNote(p));
        const noteTopics = noteDom ? [noteDom.topicId] : [];
        const others = new Set([...(folderDominants.get(folder) ?? new Set())]);
        if (noteDom) others.delete(noteDom.topicId); // compare against the REST of the folder
        // Recompute the folder centroid excluding this note for a fair distance.
        const restCentroid = centroidOf(paths.filter((q) => q !== p).map((q) => noteVectors.get(q) ?? []).filter((v) => v.length));
        if (
          isMisfit({
            noteTopics,
            folderTopics: [...others],
            noteVector: noteVectors.get(p) ?? null,
            folderCentroid: restCentroid ?? centroid,
          })
        ) {
          misfits.push({
            relPath: p,
            currentFolder: folder,
            suggestedFolder: this.suggestFolderFor(p, noteDom?.topicId ?? null, folder),
            reason: noteDom
              ? `Topic "${noteDom.name}" doesn't match this folder's usual themes.`
              : `Content doesn't match this folder's usual themes.`,
          });
        }
      }
    }
    this.store.setMisfits(misfits);
  }

  /** The folder that holds the most members of the note's dominant topic (else "(unfiled)"). */
  private suggestFolderFor(relPath: string, topicId: string | null, currentFolder: string): string {
    if (!topicId) return '(unfiled)';
    const counts = new Map<string, number>();
    const t = this.store.get(topicId);
    for (const m of t?.members ?? []) {
      if (m.notePath === relPath) continue;
      const f = dirOf(m.notePath);
      if (f === currentFolder) continue;
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestN = 0;
    for (const [f, n] of counts) {
      if (n > bestN || (n === bestN && (best === null || f < best))) {
        best = f;
        bestN = n;
      }
    }
    return best ?? '(unfiled)';
  }

  // ── resurfacing ("worth revisiting", pure local) ─────────────────────────────────

  /** Notes older than 90 days that share a topic or high similarity with content edited this week. */
  async computeResurfacingCards(): Promise<ResurfaceCard[]> {
    const now = this.now();
    const recent: string[] = [];
    for (const [rel, mtime] of this.repo.index.mtimes) {
      const note = this.repo.getParsed(rel);
      if (!note || this.shouldSkip(rel, note)) continue;
      if (now - mtime <= RESURFACE_RECENT_DAYS * DAY_MS) recent.push(rel);
    }

    const cands = new Map<string, ResurfaceCandidate>();
    const consider = (relPath: string, similarity: number, reason: string): void => {
      const mtime = this.repo.index.mtimes.get(relPath);
      if (mtime === undefined) return;
      const ageDays = (now - mtime) / DAY_MS;
      const prev = cands.get(relPath);
      if (!prev || similarity > prev.similarity) cands.set(relPath, { relPath, similarity, ageDays, reason });
    };

    for (const rel of recent) {
      // Topic overlap: any older note sharing a topic with this recently-edited one.
      for (const { topic } of this.store.topicsForNote(rel)) {
        for (const m of topic.members) {
          if (m.notePath === rel) continue;
          consider(m.notePath, m.weight, `Shares the "${topic.name}" topic with a note you edited this week.`);
        }
      }
      // Embedding neighbors.
      try {
        const neighbors = await this.backend.topK(this.repo.root, rel, 5, 0.5);
        for (const n of neighbors) consider(n.relPath, n.cos, `Similar to "${this.titleOf(rel)}", edited this week.`);
      } catch {
        /* backend unavailable — topic overlap alone still surfaces cards */
      }
    }

    return computeResurfacing([...cands.values()], { dismissed: this.store.dismissedResurfacing() });
  }

  async dismissResurfacing(relPath: string): Promise<void> {
    this.store.dismissResurfacing(relPath, new Date(this.now()).toISOString());
    await this.store.persist();
    this.deps.onChange?.();
  }

  // ── topic management (UI commands) ───────────────────────────────────────────────

  async renameTopic(topicId: string, name: string): Promise<void> {
    this.store.setName(topicId, name);
    await this.store.persist();
    this.deps.onChange?.();
  }
  async mergeTopics(fromId: string, intoId: string): Promise<void> {
    this.store.mergeTopics(fromId, intoId);
    await this.store.persist();
    this.deps.onChange?.();
  }
  async reparentTopic(topicId: string, parentId: string | null): Promise<void> {
    this.store.setParent(topicId, parentId);
    await this.store.persist();
    this.deps.onChange?.();
  }
  async deleteTopic(topicId: string): Promise<void> {
    this.store.deleteTopic(topicId);
    await this.store.persist();
    this.deps.onChange?.();
  }

  // ── helpers ──────────────────────────────────────────────────────────────────────

  private async embedName(name: string, description: string): Promise<number[] | null> {
    try {
      const res = await this.backend.embed([topicCentroidText(name, description)]);
      return res.vectors[0] ?? null;
    } catch {
      return null; // model unavailable → canonicalization falls back to name/alias only
    }
  }

  private async vectorsFor(paths: string[]): Promise<Map<string, number[]>> {
    const out = new Map<string, number[]>();
    if (paths.length === 0) return out;
    try {
      for (const row of await this.backend.vectors(this.repo.root, paths)) out.set(row.relPath, row.vector);
    } catch {
      /* backend unavailable → empty; misfit simply can't be judged (isMisfit returns false) */
    }
    return out;
  }

  private foldersWithNotes(): Map<string, string[]> {
    const folders = new Map<string, string[]>();
    for (const n of this.repo.index.allNotes()) {
      if (this.shouldSkip(n.relPath, n)) continue;
      const f = dirOf(n.relPath);
      (folders.get(f) ?? folders.set(f, []).get(f)!).push(n.relPath);
    }
    for (const [f, paths] of [...folders]) if (paths.length < MIN_FOLDER_NOTES) folders.delete(f);
    return folders;
  }

  private folderMemberSetHash(paths: string[]): string {
    const parts = [...paths].sort().map((p) => `${p}:${this.repo.getHash(p) ?? ''}`);
    return sha256Hex(parts.join('\n'));
  }

  private staleNotePaths(): string[] {
    const set = new Set<string>();
    for (const t of this.store.all()) for (const m of t.members) if (m.stale) set.add(m.notePath);
    return [...set];
  }

  private titleOf(relPath: string): string {
    return this.repo.getParsed(relPath)?.title ?? basename(relPath);
  }

  private shouldSkip(relPath: string, note: ParsedNote): boolean {
    if (SKIP_DIRS.some((d) => relPath.startsWith(d))) return true;
    if (note.frontmatter.source === 'ai') return true;
    return false;
  }
}

function dirOf(relPath: string): string {
  const i = relPath.lastIndexOf('/');
  return i < 0 ? '' : relPath.slice(0, i);
}
function basename(relPath: string): string {
  return (relPath.split('/').pop() ?? relPath).replace(/\.md$/i, '');
}

// ── binding factory (mirrors the search / AI / embedding bindings) ────────────────────

export interface OntologyBindingOptions extends VaultOntologyDeps {
  backend: EmbeddingsBackend;
  router: AiRouter;
}

export function createVaultOntologyBinding(opts: OntologyBindingOptions): {
  onIndexChange: (relPath: string, note: ParsedNote | null) => void;
  attach: (repo: Repository) => Promise<VaultOntologyEngine>;
  getEngine: () => VaultOntologyEngine | undefined;
} {
  let engine: VaultOntologyEngine | undefined;
  return {
    onIndexChange(relPath, note) {
      engine?.noteChanged(relPath, note);
    },
    async attach(repo: Repository) {
      const store = new TopicStore({ read: (p) => repo.readInternal(p), write: (p, c) => repo.writeInternal(p, c) });
      engine = new VaultOntologyEngine(repo, opts.backend, opts.router, store, opts);
      await engine.attach();
      return engine;
    },
    getEngine: () => engine,
  };
}
