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

import { acceptSimilarity, type ParsedNote, type SimilarPair } from '../domain';
import {
  computeEmbedPlan,
  embedTextForNote,
  type EmbeddingsBackend,
} from '../services/embeddings';
import type { AiRouter } from '../services/aiClient';
import { DenoteError } from '../services/errors';
import { SimilarStore } from '../services/similarStore';
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

export class VaultEmbeddingEngine {
  private readonly dirty = new Set<string>();
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private syncing = false;
  private inflight: Promise<unknown> = Promise.resolve();

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
      void this.backend.remove(this.repo.root, rel).catch(() => {});
      return this.store.removeForPath(rel);
    });
    // First-open bulk embed runs in the background; the UI stays responsive.
    if (!this.deps.disableTimers) this.track(this.syncAll());
  }

  dispose(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
  }

  noteChanged(relPath: string, note: ParsedNote | null): void {
    if (note === null) return; // delete hook handles removal
    if (this.shouldSkip(relPath, note)) return;
    this.dirty.add(relPath);
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
    try {
      const wanted = this.wantedNotes();
      let index;
      try {
        index = await this.backend.index(this.repo.root);
      } catch {
        return; // backend unavailable (offline + no model yet) — jobs stay dirty, retried later
      }
      const plan = computeEmbedPlan(index, wanted, EXPECTED_EMBED_MODEL);

      const changed: string[] = [];
      const toEmbed = plan.toEmbed;
      for (let i = 0; i < toEmbed.length; i += EMBED_CHUNK) {
        const batch = toEmbed.slice(i, i + EMBED_CHUNK);
        const texts = batch.map((b) => this.textFor(b.relPath));
        let res;
        try {
          res = await this.backend.embed(texts);
        } catch {
          return; // model unavailable mid-run — leave the rest dirty for the next attempt
        }
        const entries = batch.map((b, j) => ({
          relPath: b.relPath,
          contentHash: b.contentHash,
          vector: res.vectors[j] ?? [],
        }));
        await this.backend.put(this.repo.root, res.model, res.dim, entries);
        for (const b of batch) changed.push(b.relPath);
        this.deps.onProgress?.(Math.min(i + EMBED_CHUNK, toEmbed.length), toEmbed.length);
      }
      for (const rel of plan.toRemove) await this.backend.remove(this.repo.root, rel);

      this.dirty.clear();
      // Similarity for every note whose vector just changed.
      for (const rel of changed) await this.computeSimilar(rel);
      if (changed.length) this.deps.onChange?.();
    } finally {
      this.syncing = false;
    }
  }

  // ── similarity (D6a/S15) ────────────────────────────────────────────────────────

  private async computeSimilar(relPath: string): Promise<void> {
    const aHash = this.repo.getHash(relPath);
    if (!aHash) return;
    const k = this.deps.k?.() ?? 3;
    const minCos = this.deps.minCos?.() ?? 0.62;

    let neighbors;
    try {
      neighbors = await this.backend.topK(this.repo.root, relPath, k, minCos);
    } catch {
      return;
    }

    const localOnly = this.deps.localOnly?.() ?? false;
    let client;
    try {
      client = this.router.route('label-similarity', { localOnly });
    } catch (err) {
      if (err instanceof DenoteError && err.kind === 'local-only-blocked') return;
      throw err;
    }

    const a = { vaultId: this.repo.vaultId, relPath };
    for (const n of neighbors) {
      const bHash = this.repo.getHash(n.relPath);
      if (!bHash) continue;
      const b = { vaultId: this.repo.vaultId, relPath: n.relPath };
      if (this.store.hasFresh(relPath, aHash, n.relPath, bHash)) continue;
      if (this.store.isRejectedFresh(a, aHash, b, bHash)) continue;

      let label;
      try {
        label = await client.labelSimilarity({ a: this.stub(relPath), b: this.stub(n.relPath) });
      } catch {
        continue; // sidecar unavailable/timeout — try again on a later change
      }
      if (acceptSimilarity(label)) {
        await this.store.upsertAccepted(relPath, aHash, n.relPath, bHash, label.reason, label.confidence);
      } else {
        await this.store.recordRejected(a, aHash, b, bHash);
      }
    }
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
      });
      engine = new VaultEmbeddingEngine(repo, opts.backend, opts.router, store, opts);
      await engine.attach();
      return engine;
    },
    getEngine: () => engine,
  };
}
