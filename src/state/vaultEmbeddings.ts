// src/state/vaultEmbeddings.ts — the per-vault embedding + ai-similar pipeline (D24/D6a/S14/S15).
//
// Two jobs, both queue-gated like enrichment (pass-6 discipline):
//   1. Keep the vault's embedding store current — on note change, (re)embed only changed hashes
//      (S14 incremental) via the Rust `embed_texts` + store commands. First open embeds all
//      missing notes in chunks, off the UI thread, with a progress signal.
//   2. Propose ai-similar edges — for a (re)embedded note, retrieve topK neighbors (Rust cosine),
//      then the on-device LLM must NAME a specific shared concept (D6a). Only pairs that pass the
//      S15 vacuity gate become edges (SimilarStore, owned by the smaller relPath); declined pairs
//      are remembered so they aren't re-asked until content changes.
//
// Wired to `Repository.onIndexChange` alongside search + enrichment, so it's integration-testable
// against a real temp-dir Repository with a mock embeddings backend + mock router (no Tauri, no
// real model). Embeddings are always local (never network), so there's no D18 gate on embedding;
// `labelSimilarity` routes through the AiRouter and inherits the D18 boundary.

import { acceptSimilarity, reasonPassesVacuityGate, type ParsedNote, type SimilarPair } from '../domain';
import {
  computeEmbedPlan,
  embedTextForNote,
  type EmbeddingIndex,
  type EmbeddingsBackend,
} from '../services/embeddings';
import type { AiClient, AiRouter, NoteStub } from '../services/aiClient';
import { DenoteError } from '../services/errors';
import {
  SimilarStore,
  type SimilarityCandidateDiagnostic,
  type SimilarityCandidateGate,
  type SimilarityRejectionGate,
} from '../services/similarStore';
import type { Repository } from './repository';

// The expected local embedding model (D32/S14). If the store on disk carries a different model id
// the whole store is invalidated and re-embedded (mismatch handling in computeEmbedPlan).
export const EXPECTED_EMBED_MODEL = 'intfloat/multilingual-e5-small';
export const EMBED_CHUNK = 32;
const SKIP_DIRS = ['_topics/', '.denote/'];

export interface VaultEmbeddingDeps {
  now?: () => number;
  /** topK params (S15 defaults k=3, cos≥0.62; Settings sliders 1–10 / 0.4–0.9). */
  k?: () => number;
  minCos?: () => number;
  localOnly?: () => boolean;
  onChange?: () => void;
  /** Progress during a bulk embed (first open): (done, total). */
  onProgress?: (done: number, total: number) => void;
  disableTimers?: boolean;
}

export const SYNC_DEBOUNCE_MS = 2000;

export type EmbeddingSyncState = 'not-started' | 'syncing' | 'ready' | 'error';

export interface EmbeddingStatusSnapshot {
  state: EmbeddingSyncState;
  model: string;
  done: number;
  total: number;
  error?: string;
}

// Candidate/gate diagnostics live with the SimilarStore so they survive a restart (R-1). The
// types are re-exported here because the UI reads them off this engine.
export type { SimilarityCandidateDiagnostic, SimilarityCandidateGate };

export class VaultEmbeddingEngine {
  private readonly dirty = new Set<string>();
  /** Notes whose vetted similarity pass has not completed yet. This survives a temporarily
   * unavailable sidecar/model so a later retry can create graph edges without an edit. */
  private readonly pendingSimilarity = new Set<string>();
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private syncing = false;
  private inflight: Promise<unknown> = Promise.resolve();
  private syncState: EmbeddingSyncState = 'not-started';
  private syncProgress = { done: 0, total: 0 };
  private syncError: string | undefined;
  private readonly indexedHashes = new Map<string, string>();

  constructor(
    private readonly repo: Repository,
    private readonly backend: EmbeddingsBackend,
    private readonly router: AiRouter,
    private readonly store: SimilarStore,
    private readonly deps: VaultEmbeddingDeps = {},
  ) {}

  async attach(): Promise<void> {
    await this.store.load();
    this.repo.registerRekeyHook((oldRel, newRel) => {
      void this.backend.remap(this.repo.root, oldRel, newRel).catch(() => {});
      return this.store.remapPath(oldRel, newRel);
    });
    this.repo.registerDeleteHook((rel) => {
      this.dirty.delete(rel);
      this.pendingSimilarity.delete(rel);
      void this.backend.remove(this.repo.root, rel).catch(() => {});
      return this.store.removeForPath(rel);
    });
    for (const note of this.wantedNotes()) this.pendingSimilarity.add(note.relPath);
    // First-open bulk embed runs in the background; the UI stays responsive.
    if (!this.deps.disableTimers) this.track(this.syncAll());
  }

  dispose(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** Retry all unresolved similarity labels after a backend retry or model becomes available. */
  retry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryAttempt = 0;
    for (const note of this.wantedNotes()) this.pendingSimilarity.add(note.relPath);
    this.track(this.syncAll());
  }

  noteChanged(relPath: string, note: ParsedNote | null): void {
    if (note === null) return; // delete hook handles removal
    if (this.shouldSkip(relPath, note)) return;
    this.dirty.add(relPath);
    this.pendingSimilarity.add(relPath);
    this.scheduleSync();
  }

  private track(p: Promise<unknown>): void {
    this.inflight = this.inflight.then(() => p, () => p);
  }

  /** Await all background embedding/similarity work (tests). */
  async settle(): Promise<void> {
    let prev: Promise<unknown>;
    do {
      prev = this.inflight;
      await prev.catch(() => {});
    } while (prev !== this.inflight);
  }

  /** SimilarPairs for the graph (S15 → graphBuilder). Endpoints are within this vault. */
  similarPairs(): SimilarPair[] {
    return this.store.all().map((p) => ({
      aVaultId: this.repo.vaultId,
      aRelPath: p.owner,
      bVaultId: this.repo.vaultId,
      bRelPath: p.other,
      reason: p.reason,
      confidence: p.confidence,
    }));
  }

  status(): EmbeddingStatusSnapshot {
    return {
      state: this.syncState,
      model: EXPECTED_EMBED_MODEL,
      done: this.syncProgress.done,
      total: this.syncProgress.total,
      ...(this.syncError ? { error: this.syncError } : {}),
    };
  }

  noteState(relPath: string): 'not-embedded' | 'embedding' | 'ready' | 'error' {
    const hash = this.repo.getHash(relPath);
    if (!hash) return 'not-embedded';
    if (this.indexedHashes.get(relPath) === hash) return 'ready';
    if (this.syncState === 'error') return 'error';
    if (this.syncState === 'syncing' || this.dirty.has(relPath)) return 'embedding';
    return 'not-embedded';
  }

  /** The candidate/gate list from this note's last completed similarity pass. Persisted with the
   *  SimilarStore (R-1), so it survives a restart even though a hash-gated note never re-runs the
   *  pass; an edited note (hash mismatch) truthfully reports "not checked yet". */
  similarityDiagnosticsFor(relPath: string): SimilarityCandidateDiagnostic[] {
    const current = this.store.candidateDiagnosticsFor(relPath);
    return current && current.contentHash === this.repo.getHash(relPath)
      ? current.candidates.map((candidate) => ({ ...candidate }))
      : [];
  }

  /** Return the local embedding-ranked neighbors as bounded prompt stubs for note enrichment.
   * Similarity edges still require the separate label gate; this method only supplies retrieval
   * context to the enrichment model (D12/S16). */
  async candidateNotesFor(relPath: string, k = Math.max(1, Math.round(this.deps.k?.() ?? 3))): Promise<NoteStub[]> {
    try {
      const neighbors = await this.backend.topK(this.repo.root, relPath, k, 0);
      return neighbors
        .filter((neighbor) => neighbor.relPath !== relPath && !!this.repo.getParsed(neighbor.relPath))
        .map((neighbor) => this.stub(neighbor.relPath));
    } catch {
      return [];
    }
  }

  // ── sync ─────────────────────────────────────────────────────────────────────

  private scheduleSync(): void {
    if (this.deps.disableTimers) return; // tests call syncAll()/syncNow explicitly
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.track(this.syncAll());
    }, SYNC_DEBOUNCE_MS);
  }

  /** Bring the whole embedding store current, then (re)compute similarity for changed notes. */
  async syncAll(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    this.syncState = 'syncing';
    this.syncError = undefined;
    this.syncProgress = { done: 0, total: 0 };
    this.deps.onChange?.();
    try {
      const wanted = this.wantedNotes();
      const wantedPaths = new Set(wanted.map((n) => n.relPath));
      for (const relPath of this.pendingSimilarity) {
        if (!wantedPaths.has(relPath)) this.pendingSimilarity.delete(relPath);
      }
      let index: EmbeddingIndex;
      try {
        index = await this.backend.index(this.repo.root);
      } catch (error) {
        this.failSync(error);
        return; // backend unavailable (offline + no model yet) — jobs stay pending, retried later
      }
      this.indexedHashes.clear();
      for (const row of index.rows) this.indexedHashes.set(row.relPath, row.contentHash);
      const plan = computeEmbedPlan(index, wanted, EXPECTED_EMBED_MODEL);

      const changed: string[] = [];
      const toEmbed = plan.toEmbed;
      this.syncProgress = { done: 0, total: toEmbed.length };
      this.deps.onProgress?.(0, toEmbed.length);
      for (let i = 0; i < toEmbed.length; i += EMBED_CHUNK) {
        const batch = toEmbed.slice(i, i + EMBED_CHUNK);
        const texts = batch.map((b) => this.textFor(b.relPath));
        let res;
        try {
          res = await this.backend.embed(texts);
        } catch (error) {
          this.failSync(error);
          return; // model unavailable mid-run — leave the similarity pass pending
        }
        const entries = batch.map((b, j) => ({
          relPath: b.relPath,
          contentHash: b.contentHash,
          vector: res.vectors[j] ?? [],
        }));
        try {
          await this.backend.put(this.repo.root, res.model, res.dim, entries);
        } catch (error) {
          this.failSync(error);
          return;
        }
        for (const b of batch) {
          changed.push(b.relPath);
          this.indexedHashes.set(b.relPath, b.contentHash);
        }
        this.syncProgress = { done: Math.min(i + EMBED_CHUNK, toEmbed.length), total: toEmbed.length };
        this.deps.onProgress?.(this.syncProgress.done, this.syncProgress.total);
      }
      for (const rel of plan.toRemove) {
        try {
          await this.backend.remove(this.repo.root, rel);
        } catch (error) {
          this.failSync(error);
          return;
        }
        this.indexedHashes.delete(rel);
      }

      this.dirty.clear();
      this.syncState = 'ready';
      this.deps.onChange?.();
      // Similarity is attempted for changed notes and for any notes left incomplete by a prior
      // sidecar/model outage. The store's fresh/rejected gates prevent duplicate LLM calls.
      let similarityClient: AiClient;
      try {
        const routed = this.router.route('label-similarity', { localOnly: this.deps.localOnly?.() ?? false });
        const capabilities = await routed.capabilities();
        if (!capabilities.available) {
          this.scheduleRetry();
          return;
        }
        similarityClient = routed;
      } catch (err) {
        // A local-only vault routed to a network backend is intentionally quiet until routing
        // changes; all other failures remain pending for the bounded retry schedule.
        if (err instanceof DenoteError && err.kind === 'local-only-blocked') return;
        this.scheduleRetry();
        return;
      }
      let similarityChanged = false;
      for (const rel of [...this.pendingSimilarity]) {
        const result = await this.computeSimilar(rel, similarityClient);
        if (result.done) this.pendingSimilarity.delete(rel);
        similarityChanged ||= result.changed;
        // One failed label call usually means the sidecar just became unavailable. Stop the
        // batch immediately instead of issuing one doomed call per remaining note.
        if (!result.done) break;
      }
      if (changed.length || similarityChanged) this.deps.onChange?.();
      if (this.pendingSimilarity.size > 0) this.scheduleRetry();
      else {
        this.retryAttempt = 0;
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
    } finally {
      this.syncing = false;
    }
  }

  private failSync(error: unknown): void {
    this.syncState = 'error';
    this.syncError = error instanceof Error ? error.message : String(error);
    this.deps.onChange?.();
    this.scheduleRetry();
  }

  // ── similarity (D6a/S15) ────────────────────────────────────────────────────────

  private async computeSimilar(relPath: string, client: AiClient): Promise<{ done: boolean; changed: boolean }> {
    const aHash = this.repo.getHash(relPath);
    if (!aHash) return { done: true, changed: false };
    const k = this.deps.k?.() ?? 3;
    const minCos = this.deps.minCos?.() ?? 0.62;

    let neighbors;
    try {
      // Ask for the top-k without the floor so the status panel can explain candidates that were
      // found but rejected before the model gate.
      neighbors = await this.backend.topK(this.repo.root, relPath, k, 0);
    } catch {
      return { done: false, changed: false };
    }

    const a = { vaultId: this.repo.vaultId, relPath };
    let changed = false;
    const diagnostics: SimilarityCandidateDiagnostic[] = neighbors.map((n) => ({
      relPath: n.relPath,
      cosine: n.cos,
      gate: n.cos < minCos ? 'cosine-floor' : 'pending',
    }));
    for (const n of neighbors) {
      const bHash = this.repo.getHash(n.relPath);
      if (!bHash) continue;
      const b = { vaultId: this.repo.vaultId, relPath: n.relPath };
      const diagnostic = diagnostics.find((candidate) => candidate.relPath === n.relPath);
      if (n.cos < minCos) continue;
      if (this.store.hasFresh(relPath, aHash, n.relPath, bHash)) {
        if (diagnostic) diagnostic.gate = 'accepted';
        continue;
      }
      if (this.store.isRejectedFresh(a, aHash, b, bHash)) {
        if (diagnostic) diagnostic.gate = this.store.rejectionGateFresh(a, aHash, b, bHash) ?? 'llm-unrelated';
        continue;
      }

      let label;
      try {
        label = await client.labelSimilarity({ a: this.stub(relPath), b: this.stub(n.relPath) });
      } catch (error) {
        // A model refusal/schema failure is a terminal answer for this exact pair at these
        // hashes. Remember it like any other declined pair so one sensitive note cannot starve
        // every other note's similarity pass. Transport/time-out failures stay pending and are
        // retried after the bounded backoff.
        if (isPermanentSimilarityFailure(error)) {
          await this.store.recordRejected(a, aHash, b, bHash, 'llm-refusal');
          if (diagnostic) diagnostic.gate = 'llm-refusal';
          continue;
        }
        return { done: false, changed };
      }
      if (acceptSimilarity(label)) {
        await this.store.upsertAccepted(relPath, aHash, n.relPath, bHash, label.reason, label.confidence);
        if (diagnostic) diagnostic.gate = 'accepted';
        changed = true;
      } else {
        const gate: SimilarityRejectionGate = label.related && !reasonPassesVacuityGate(label.reason)
          ? 'vacuity'
          : 'llm-unrelated';
        await this.store.recordRejected(a, aHash, b, bHash, gate);
        if (diagnostic) diagnostic.gate = gate;
      }
    }
    await this.store.setCandidateDiagnostics(relPath, aHash, diagnostics);
    return { done: true, changed };
  }

  private scheduleRetry(delay = 30_000): void {
    if (this.deps.disableTimers || this.retryTimer || this.retryAttempt >= 3) return;
    const delays = [5_000, 30_000, 120_000];
    const retryDelay = delays[this.retryAttempt] ?? delay;
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.track(this.syncAll());
    }, retryDelay);
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private wantedNotes(): { relPath: string; contentHash: string }[] {
    const out: { relPath: string; contentHash: string }[] = [];
    for (const n of this.repo.index.allNotes()) {
      if (this.shouldSkip(n.relPath, n)) continue;
      const hash = this.repo.getHash(n.relPath);
      if (hash) out.push({ relPath: n.relPath, contentHash: hash });
    }
    return out;
  }

  private textFor(relPath: string): string {
    const note = this.repo.getParsed(relPath);
    return note ? embedTextForNote(note) : '';
  }

  private stub(relPath: string): { relPath: string; title: string; summary?: string } {
    const note = this.repo.getParsed(relPath);
    const title = note?.title ?? relPath;
    const body = (note?.bodyText ?? '').trim();
    const summary = body ? body.split(/\s+/).slice(0, 40).join(' ') : undefined;
    return { relPath, title, summary };
  }

  private shouldSkip(relPath: string, note: ParsedNote): boolean {
    if (SKIP_DIRS.some((d) => relPath.startsWith(d))) return true;
    if (note.frontmatter.source === 'ai') return true;
    return false;
  }
}

function isPermanentSimilarityFailure(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : String(error);
  return /ai-invalid-output|refusal|sensitive content|schema-invalid/i.test(detail);
}

// ── binding factory (mirrors createVaultAiBinding / search binding) ───────────────────

export interface EmbeddingBindingOptions extends VaultEmbeddingDeps {
  backend: EmbeddingsBackend;
  router: AiRouter;
}

export function createVaultEmbeddingBinding(opts: EmbeddingBindingOptions): {
  onIndexChange: (relPath: string, note: ParsedNote | null) => void;
  attach: (repo: Repository) => Promise<VaultEmbeddingEngine>;
  getEngine: () => VaultEmbeddingEngine | undefined;
} {
  let engine: VaultEmbeddingEngine | undefined;
  return {
    onIndexChange(relPath, note) {
      engine?.noteChanged(relPath, note);
    },
    async attach(repo: Repository) {
      const store = new SimilarStore({
        read: (p) => repo.readInternal(p),
        write: (p, c) => repo.writeInternal(p, c),
        delete: (p) => repo.deleteInternal(p),
      });
      engine = new VaultEmbeddingEngine(repo, opts.backend, opts.router, store, opts);
      await engine.attach();
      return engine;
    },
    getEngine: () => engine,
  };
}
