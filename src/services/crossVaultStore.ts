// src/services/crossVaultStore.ts — cross-vault ai-similar pairs + cross-note themes (S24/D36).
//
// Endpoints in DIFFERENT vaults can't live in either vault's `.denote/` (a vault folder must stay
// self-contained and portable, D36), so these edges live app-side in `crossvault.json` (S26 v1).
// Carried in from pass 07 (S24 was deferred there); the deep-organize themes (this pass) also span
// vaults, so the store lands here where both are first consumed. A referenced vault that is closed
// or missing simply isn't rendered — its edges stay in the file until the vault leaves the registry.
//
// Pair identity + the vacuity gate reuse the same pure S15 rules as the within-vault SimilarStore
// (domain/similarity.ts); only the storage location differs.

import { pairKey, type PairEndpoint } from '../domain/similarity';
import type { AppSupportIO } from './appSupportStore';

export const CROSSVAULT_PATH = 'crossvault.json';

export interface CrossVaultPair {
  aVaultId: string;
  aRelPath: string;
  bVaultId: string;
  bRelPath: string;
  aHash: string;
  bHash: string;
  reason: string;
  confidence: number;
}

export interface CrossVaultRejected {
  key: string;
  aHash: string;
  bHash: string;
}

interface CrossVaultFile {
  version: 1;
  pairs: CrossVaultPair[];
  rejected: CrossVaultRejected[];
}

/** Canonical ordering of two endpoints so a pair is stored once regardless of query order. */
function order(a: PairEndpoint, aHash: string, b: PairEndpoint, bHash: string) {
  const ax = `${a.vaultId} ${a.relPath}`;
  const bx = `${b.vaultId} ${b.relPath}`;
  return ax <= bx
    ? { first: a, firstHash: aHash, second: b, secondHash: bHash }
    : { first: b, firstHash: bHash, second: a, secondHash: aHash };
}

export class CrossVaultStore {
  private pairs: CrossVaultPair[] = [];
  private rejected: CrossVaultRejected[] = [];

  constructor(private io: AppSupportIO) {}

  /** Rebind to the real app-support IO once `appSupportRoot()` resolves (vaultStore wiring). */
  setIo(io: AppSupportIO): void {
    this.io = io;
  }

  async load(): Promise<void> {
    const raw = await this.io.read(CROSSVAULT_PATH);
    if (raw == null) return;
    try {
      const f = JSON.parse(raw) as Partial<CrossVaultFile>;
      this.pairs = Array.isArray(f.pairs) ? f.pairs : [];
      this.rejected = Array.isArray(f.rejected) ? f.rejected : [];
    } catch {
      this.pairs = [];
      this.rejected = [];
    }
  }

  all(): readonly CrossVaultPair[] {
    return this.pairs;
  }

  /** Pairs whose BOTH endpoints are in the given set of open vaults (only these can render). */
  renderablePairs(openVaultIds: Set<string>): CrossVaultPair[] {
    return this.pairs.filter((p) => openVaultIds.has(p.aVaultId) && openVaultIds.has(p.bVaultId));
  }

  hasFresh(a: PairEndpoint, aHash: string, b: PairEndpoint, bHash: string): boolean {
    const o = order(a, aHash, b, bHash);
    return this.pairs.some(
      (p) =>
        p.aVaultId === o.first.vaultId &&
        p.aRelPath === o.first.relPath &&
        p.bVaultId === o.second.vaultId &&
        p.bRelPath === o.second.relPath &&
        p.aHash === o.firstHash &&
        p.bHash === o.secondHash,
    );
  }

  isRejectedFresh(a: PairEndpoint, aHash: string, b: PairEndpoint, bHash: string): boolean {
    const key = pairKey(a, b);
    const [h1, h2] = [aHash, bHash].sort();
    return this.rejected.some((r) => r.key === key && r.aHash === h1 && r.bHash === h2);
  }

  async upsertAccepted(a: PairEndpoint, aHash: string, b: PairEndpoint, bHash: string, reason: string, confidence: number): Promise<void> {
    const o = order(a, aHash, b, bHash);
    this.pairs = this.pairs.filter(
      (p) => !(p.aVaultId === o.first.vaultId && p.aRelPath === o.first.relPath && p.bVaultId === o.second.vaultId && p.bRelPath === o.second.relPath),
    );
    this.pairs.push({
      aVaultId: o.first.vaultId,
      aRelPath: o.first.relPath,
      bVaultId: o.second.vaultId,
      bRelPath: o.second.relPath,
      aHash: o.firstHash,
      bHash: o.secondHash,
      reason,
      confidence,
    });
    this.dropRejected(a, b);
    this.sort();
    await this.persist();
  }

  async recordRejected(a: PairEndpoint, aHash: string, b: PairEndpoint, bHash: string): Promise<void> {
    const key = pairKey(a, b);
    const [h1, h2] = [aHash, bHash].sort();
    if (!this.rejected.some((r) => r.key === key && r.aHash === h1 && r.bHash === h2)) {
      this.rejected.push({ key, aHash: h1, bHash: h2 });
      await this.persist();
    }
  }

  /** Drop every cross-vault edge touching a vault (removed from the registry). */
  async removeForVault(vaultId: string): Promise<void> {
    const before = this.pairs.length;
    this.pairs = this.pairs.filter((p) => p.aVaultId !== vaultId && p.bVaultId !== vaultId);
    if (this.pairs.length !== before) await this.persist();
  }

  private dropRejected(a: PairEndpoint, b: PairEndpoint): void {
    const key = pairKey(a, b);
    this.rejected = this.rejected.filter((r) => r.key !== key);
  }

  private sort(): void {
    this.pairs.sort((p, q) =>
      p.aVaultId !== q.aVaultId
        ? p.aVaultId.localeCompare(q.aVaultId)
        : p.aRelPath !== q.aRelPath
          ? p.aRelPath.localeCompare(q.aRelPath)
          : p.bVaultId !== q.bVaultId
            ? p.bVaultId.localeCompare(q.bVaultId)
            : p.bRelPath.localeCompare(q.bRelPath),
    );
  }

  private async persist(): Promise<void> {
    const file: CrossVaultFile = { version: 1, pairs: this.pairs, rejected: this.rejected };
    await this.io.write(CROSSVAULT_PATH, JSON.stringify(file, null, 2) + '\n');
  }
}
