// src/services/batchStore.ts — Anthropic Batch durability (S27). A submitted batch outlives the
// process (batches take up to 24h), so the batchId + its custom_id manifest are persisted BEFORE
// submission; on the next launch the app resumes polling any non-terminal batch and reconciles
// actual usage into the spend ledger. A fetched batch is `reconciled` (terminal); an expired,
// never-fetched batch is `expired` and its spend is marked lost — money never vanishes silently.
//
// File: `batches.json` in app support (S26 v1). The manifest maps each custom_id back to what its
// result should become (an annotation on a note, a topic proposal, or a cross-note theme) so the
// orchestrator can apply results even after a restart, keyed by custom_id only (results arrive
// unordered, S27).

import type { AppSupportIO } from './appSupportStore';

export const BATCH_PATH = 'batches.json';

export type ManifestKind = 'note' | 'theme';

/** One custom_id's worth of "what to do with this result". `ref` is the notePath (note) or a
 *  synthetic theme id; `vaultId` scopes application back to the right open vault. */
export interface ManifestItem {
  customId: string;
  kind: ManifestKind;
  ref: string;
  vaultId: string;
}

/** `submitting` = staged BEFORE the createBatch call (checkpoint-D fix: a crash between
 *  submit-success and persistence must not orphan a billable batch — the staged record makes
 *  the window observable). A `submitting` record found at launch becomes `lost`.
 *  `lost` = outcome unknowable; its reserved estimate stays visible in the ledger. */
export type PersistedBatchStatus = 'submitting' | 'submitted' | 'reconciled' | 'expired' | 'lost';

export interface PersistedBatch {
  batchId: string;
  submittedAt: string;
  estimatedCostUsd: number;
  model: string;
  status: PersistedBatchStatus;
  manifest: ManifestItem[];
}

interface BatchFile {
  version: 1;
  batches: PersistedBatch[];
}

export class BatchStore {
  private batches: PersistedBatch[] = [];

  constructor(private io: AppSupportIO) {}

  /** Rebind to the real app-support IO once `appSupportRoot()` resolves (vaultStore wiring). */
  setIo(io: AppSupportIO): void {
    this.io = io;
  }

  async load(): Promise<void> {
    const raw = await this.io.read(BATCH_PATH);
    if (raw == null) return;
    try {
      const f = JSON.parse(raw) as Partial<BatchFile>;
      this.batches = Array.isArray(f.batches) ? f.batches : [];
    } catch {
      this.batches = [];
    }
  }

  all(): readonly PersistedBatch[] {
    return this.batches;
  }

  /** Batches still needing a poll on launch (submitted, not yet terminal). */
  pending(): PersistedBatch[] {
    return this.batches.filter((b) => b.status === 'submitted');
  }

  /** Crash leftovers: staged before submission, never confirmed. Resolved to `lost` at launch. */
  staleSubmitting(): PersistedBatch[] {
    return this.batches.filter((b) => b.status === 'submitting');
  }

  /** Swap the provisional staging id for the real batchId returned by the API. */
  async replaceId(oldId: string, newId: string): Promise<void> {
    const b = this.get(oldId);
    if (!b) return;
    b.batchId = newId;
    await this.persist();
  }

  /** Remove a staged record whose submission failed before any charge existed. */
  async remove(batchId: string): Promise<void> {
    const before = this.batches.length;
    this.batches = this.batches.filter((b) => b.batchId !== batchId);
    if (this.batches.length !== before) await this.persist();
  }

  get(batchId: string): PersistedBatch | undefined {
    return this.batches.find((b) => b.batchId === batchId);
  }

  /** Persist a batch BEFORE submission returns (S27: batchId recorded before the poll loop). */
  async add(batch: PersistedBatch): Promise<void> {
    this.batches = this.batches.filter((b) => b.batchId !== batch.batchId);
    this.batches.push(batch);
    await this.persist();
  }

  async setStatus(batchId: string, status: PersistedBatchStatus): Promise<void> {
    const b = this.get(batchId);
    if (!b) return;
    b.status = status;
    await this.persist();
  }

  private async persist(): Promise<void> {
    const file: BatchFile = { version: 1, batches: this.batches };
    await this.io.write(BATCH_PATH, JSON.stringify(file, null, 2) + '\n');
  }
}
