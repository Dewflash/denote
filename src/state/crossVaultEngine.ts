// src/state/crossVaultStore.ts — the cross-vault ai-similar ENGINE (S24 carried-in from pass 07).
//
// The within-vault pipeline (vaultEmbeddings.ts) only ever compares notes inside one vault. This
// coordinator computes the CROSS-vault edges: for each ordered pair of open, NON-localOnly vaults,
// it takes a note's vector from vault A's store and retrieves neighbors in vault B's store
// (`embeddings_topk_vector`, Rust), then the SAME two-gate pipeline (D6a) applies — an LLM must
// name a specific shared concept, and the S15 vacuity gate must pass — before an edge exists.
// Accepted/declined pairs live app-side in `crossvault.json` (CrossVaultStore), never in either
// vault's `.denote/` (D36 portability). localOnly vaults are excluded entirely (D18).
//
// Injected deps (embeddings backend, router, store, vault refs) so it's integration-testable with
// a mock backend + mock router over temp-dir repos — no Tauri.

import { acceptSimilarity, type SimilarPair } from '../domain';
import type { NoteStub } from '../services/aiClient';
import type { AiRouter } from '../services/aiClient';
import type { EmbeddingsBackend } from '../services/embeddings';
import { DenoteError } from '../services/errors';
import type { CrossVaultStore } from '../services/crossVaultStore';

export const CROSS_SYNC_DEBOUNCE_MS = 3000;

/** One open vault's surface the engine needs (supplied by vaultStore per open vault). */
export interface CrossVaultRef {
  vaultId: string;
  root: string;
  localOnly: boolean;
  /** Enrichable note paths (skips `_topics/`, `.denote/`, `source: ai`). */
  notePaths(): string[];
  getHash(relPath: string): string | undefined;
  stub(relPath: string): NoteStub;
}

export interface CrossVaultEngineDeps {
  backend: EmbeddingsBackend;
  router: AiRouter;
  store: CrossVaultStore;
  k?: () => number;
  minCos?: () => number;
  /** ALL open vaults (the engine filters localOnly + needs ≥2 non-local to do anything). */
  vaults: () => CrossVaultRef[];
  onChange?: () => void;
  disableTimers?: boolean;
}

export class CrossVaultEngine {
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private syncing = false;
  private inflight: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: CrossVaultEngineDeps) {}

  dispose(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
  }

  /** All cross-vault pairs renderable for the given open vaults (both endpoints open). */
  pairs(openVaultIds: string[]): SimilarPair[] {
    const open = new Set(openVaultIds);
    return this.deps.store.renderablePairs(open).map((p) => ({
      aVaultId: p.aVaultId,
      aRelPath: p.aRelPath,
      bVaultId: p.bVaultId,
      bRelPath: p.bRelPath,
      reason: p.reason,
      confidence: p.confidence,
    }));
  }

  schedule(): void {
    if (this.deps.disableTimers) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.track(this.syncAll());
    }, CROSS_SYNC_DEBOUNCE_MS);
  }

  private track(p: Promise<unknown>): void {
    this.inflight = this.inflight.then(() => p, () => p);
  }

  async settle(): Promise<void> {
    let prev: Promise<unknown>;
    do {
      prev = this.inflight;
      await prev.catch(() => {});
    } while (prev !== this.inflight);
  }

  /** Recompute cross-vault edges across every ordered pair of open non-localOnly vaults. */
  async syncAll(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const vaults = this.deps.vaults().filter((v) => !v.localOnly);
      if (vaults.length < 2) return;
      const k = this.deps.k?.() ?? 3;
      const minCos = this.deps.minCos?.() ?? 0.62;

      let changed = false;
      for (let i = 0; i < vaults.length; i++) {
        for (let j = i + 1; j < vaults.length; j++) {
          changed = (await this.syncPair(vaults[i], vaults[j], k, minCos)) || changed;
        }
      }
      if (changed) this.deps.onChange?.();
    } finally {
      this.syncing = false;
    }
  }

  private async syncPair(a: CrossVaultRef, b: CrossVaultRef, k: number, minCos: number): Promise<boolean> {
    let client;
    try {
      client = this.deps.router.route('label-similarity', { localOnly: false });
    } catch (err) {
      if (err instanceof DenoteError && err.kind === 'local-only-blocked') return false;
      throw err;
    }

    let changed = false;
    for (const aRel of a.notePaths()) {
      const aHash = a.getHash(aRel);
      if (!aHash) continue;
      let vector: number[] | undefined;
      try {
        vector = (await this.deps.backend.vectors(a.root, [aRel]))[0]?.vector;
      } catch {
        continue;
      }
      if (!vector || vector.length === 0) continue;

      let neighbors;
      try {
        neighbors = await this.deps.backend.topKVector(b.root, vector, k, minCos);
      } catch {
        continue;
      }

      const aEnd = { vaultId: a.vaultId, relPath: aRel };
      for (const n of neighbors) {
        const bHash = b.getHash(n.relPath);
        if (!bHash) continue;
        const bEnd = { vaultId: b.vaultId, relPath: n.relPath };
        if (this.deps.store.hasFresh(aEnd, aHash, bEnd, bHash)) continue;
        if (this.deps.store.isRejectedFresh(aEnd, aHash, bEnd, bHash)) continue;

        let label;
        try {
          label = await client.labelSimilarity({ a: a.stub(aRel), b: b.stub(n.relPath) });
        } catch {
          continue;
        }
        if (acceptSimilarity(label)) {
          await this.deps.store.upsertAccepted(aEnd, aHash, bEnd, bHash, label.reason, label.confidence);
          changed = true;
        } else {
          await this.deps.store.recordRejected(aEnd, aHash, bEnd, bHash);
        }
      }
    }
    return changed;
  }
}
