// src/services/similarStore.ts — the vetted ai-similar pairs for ONE vault (S15/D6a), plus a
// memory of pairs the LLM declined so they aren't re-asked until content changes.
//
// File: `.denote/ai/similar.json` (S26 `version: 1`). Each accepted pair is "owned" by the
// lexicographically smaller relPath and carries the other endpoint + both content hashes + the
// LLM's stated reason (S15 edge ownership); re-labelling happens only when an endpoint's hash
// changes. Byte-stable ordering so the file doesn't churn. Same guarded `.denote/` IO as the
// annotation store (D23) — no `state/` import.
//
// (Deviation from S15's letter: failed pairs live here under `rejectedPairs` rather than in
// `rejections.json`'s `similarityPairs` key, so this store is a single writer. The behavior —
// don't re-ask until content changes — is identical. Cross-vault pairs never touch any vault's
// `.denote/`; they live app-side in crossvault.json, S24.)

import { ownerOf, pairKey, type PairEndpoint } from '../domain/similarity';
import type { InternalStoreIO } from './annotationStore';
import { loadMigratedJson } from './migrations';

export const SIMILAR_PATH = '.denote/ai/similar.json';

/** An accepted within-vault similar pair, owner-centric (owner = smaller relPath). */
export interface SimilarPairRecord {
  owner: string;
  other: string;
  ownerHash: string;
  otherHash: string;
  reason: string;
  confidence: number;
}

/** A declined pair, remembered by canonical key + the hashes it was declined at (so a content
 *  edit gives it a fresh chance). */
export interface RejectedPairRecord {
  key: string;
  aHash: string;
  bHash: string;
  /** Which S15 gate rejected the candidate. Older stores omit this and are treated as unrelated. */
  gate?: 'vacuity' | 'llm-unrelated' | 'llm-refusal';
}

export type SimilarityRejectionGate = NonNullable<RejectedPairRecord['gate']>;

/** Every S15 gate outcome for a retrieved candidate, including the pre-LLM cosine floor and the
 *  in-flight `pending` state. `accepted` means the pair became a real ai-similar edge. */
export type SimilarityCandidateGate = 'accepted' | SimilarityRejectionGate | 'cosine-floor' | 'pending';

export interface SimilarityCandidateDiagnostic {
  relPath: string;
  cosine: number;
  gate: SimilarityCandidateGate;
}

/** The full candidate/gate list of ONE note's last completed similarity pass, keyed by the
 *  content hash it ran at. Persisted (R-1) so the status panel can answer "why isn't this note
 *  linked?" truthfully after a restart, when the pipeline is hash-gated and does not re-run.
 *  Derived data (D3/D5): rebuildable by re-running the similarity pass, never a source of truth. */
export interface NoteCandidateDiagnostics {
  relPath: string;
  contentHash: string;
  candidates: SimilarityCandidateDiagnostic[];
}

interface SimilarFile {
  version: 1;
  pairs: SimilarPairRecord[];
  rejectedPairs: RejectedPairRecord[];
  /** Optional so pre-R-1 stores load unchanged (they simply have no diagnostics yet). */
  noteCandidates?: NoteCandidateDiagnostics[];
}

export class SimilarStore {
  private pairs: SimilarPairRecord[] = [];
  private rejected: RejectedPairRecord[] = [];
  private noteCandidates: NoteCandidateDiagnostics[] = [];

  constructor(private readonly io: InternalStoreIO) {}

  async load(): Promise<void> {
    const result = await loadMigratedJson(this.io, SIMILAR_PATH);
    if (!result || !result.ok) return;
    try {
      const f = result.data as unknown as SimilarFile;
      this.pairs = f.pairs ?? [];
      this.rejected = f.rejectedPairs ?? [];
      this.noteCandidates = f.noteCandidates ?? [];
    } catch {
      this.pairs = [];
      this.rejected = [];
      this.noteCandidates = [];
    }
  }

  /** All accepted pairs (owner-centric). */
  all(): readonly SimilarPairRecord[] {
    return this.pairs;
  }

  /** Whether this (relPath, hash) pair was already accepted at BOTH current hashes — skip re-label. */
  hasFresh(aRel: string, aHash: string, bRel: string, bHash: string): boolean {
    const { owner, other } = ownerOf(aRel, bRel);
    const ownerHash = owner === aRel ? aHash : bHash;
    const otherHash = other === aRel ? aHash : bHash;
    return this.pairs.some(
      (p) =>
        p.owner === owner &&
        p.other === other &&
        p.ownerHash === ownerHash &&
        p.otherHash === otherHash,
    );
  }

  /** Whether this pair was declined at these exact hashes (don't re-ask until content changes). */
  isRejectedFresh(a: PairEndpoint, aHash: string, b: PairEndpoint, bHash: string): boolean {
    const key = pairKey(a, b);
    const [h1, h2] = [aHash, bHash].sort();
    return this.rejected.some((r) => r.key === key && r.aHash === h1 && r.bHash === h2);
  }

  rejectionGateFresh(a: PairEndpoint, aHash: string, b: PairEndpoint, bHash: string): SimilarityRejectionGate | undefined {
    const key = pairKey(a, b);
    const [h1, h2] = [aHash, bHash].sort();
    const record = this.rejected.find((r) => r.key === key && r.aHash === h1 && r.bHash === h2);
    return record?.gate ?? (record ? 'llm-unrelated' : undefined);
  }

  /** Record (or refresh) an accepted pair, keyed by owner+other (one edge per pair, S15 dedup). */
  async upsertAccepted(
    aRel: string,
    aHash: string,
    bRel: string,
    bHash: string,
    reason: string,
    confidence: number,
  ): Promise<void> {
    const { owner, other } = ownerOf(aRel, bRel);
    const ownerHash = owner === aRel ? aHash : bHash;
    const otherHash = other === aRel ? aHash : bHash;
    this.pairs = this.pairs.filter((p) => !(p.owner === owner && p.other === other));
    this.pairs.push({ owner, other, ownerHash, otherHash, reason, confidence });
    // Clearing any stale rejection for this pair — content changed enough to accept now.
    this.dropRejected(owner, other);
    this.sort();
    await this.persist();
  }

  async recordRejected(
    a: PairEndpoint,
    aHash: string,
    b: PairEndpoint,
    bHash: string,
    gate: SimilarityRejectionGate = 'llm-unrelated',
  ): Promise<void> {
    const key = pairKey(a, b);
    const [h1, h2] = [aHash, bHash].sort();
    const existing = this.rejected.find((r) => r.key === key && r.aHash === h1 && r.bHash === h2);
    if (existing) {
      if (existing.gate !== gate) {
        existing.gate = gate;
        await this.persist();
      }
      return;
    }
    this.rejected.push({ key, aHash: h1, bHash: h2, gate });
    await this.persist();
  }

  /** The persisted candidate/gate list from `relPath`'s last completed similarity pass. Callers
   *  must compare `contentHash` against the note's live hash before trusting the candidates. */
  candidateDiagnosticsFor(relPath: string): NoteCandidateDiagnostics | undefined {
    return this.noteCandidates.find((record) => record.relPath === relPath);
  }

  /** Record the full candidate/gate outcome of a completed similarity pass (one record per note,
   *  keyed by the hash it ran at). Skips the disk write when nothing changed. */
  async setCandidateDiagnostics(
    relPath: string,
    contentHash: string,
    candidates: SimilarityCandidateDiagnostic[],
  ): Promise<void> {
    const record: NoteCandidateDiagnostics = {
      relPath,
      contentHash,
      candidates: candidates.map((candidate) => ({ ...candidate })),
    };
    const existing = this.candidateDiagnosticsFor(relPath);
    if (existing && JSON.stringify(existing) === JSON.stringify(record)) return;
    this.noteCandidates = this.noteCandidates.filter((r) => r.relPath !== relPath);
    this.noteCandidates.push(record);
    this.noteCandidates.sort((a, b) => a.relPath.localeCompare(b.relPath));
    await this.persist();
  }

  /** Drop every pair touching `relPath` (note deleted). */
  async removeForPath(relPath: string): Promise<void> {
    const before = this.pairs.length;
    this.pairs = this.pairs.filter((p) => p.owner !== relPath && p.other !== relPath);
    let diagnosticsTouched = false;
    const kept: NoteCandidateDiagnostics[] = [];
    for (const record of this.noteCandidates) {
      if (record.relPath === relPath) {
        diagnosticsTouched = true;
        continue;
      }
      const candidates = record.candidates.filter((candidate) => candidate.relPath !== relPath);
      if (candidates.length !== record.candidates.length) {
        diagnosticsTouched = true;
        kept.push({ ...record, candidates });
      } else {
        kept.push(record);
      }
    }
    this.noteCandidates = kept;
    if (this.pairs.length !== before || diagnosticsTouched) await this.persist();
  }

  /** Re-key a moved/renamed note (D4a). */
  async remapPath(oldRel: string, newRel: string): Promise<void> {
    let touched = false;
    for (const p of this.pairs) {
      if (p.owner === oldRel) {
        p.owner = newRel;
        touched = true;
      }
      if (p.other === oldRel) {
        p.other = newRel;
        touched = true;
      }
    }
    // Ownership may have flipped after the rename — re-normalize.
    for (const p of this.pairs) {
      if (p.owner > p.other) {
        [p.owner, p.other] = [p.other, p.owner];
        [p.ownerHash, p.otherHash] = [p.otherHash, p.ownerHash];
      }
    }
    for (const record of this.noteCandidates) {
      if (record.relPath === oldRel) {
        record.relPath = newRel;
        touched = true;
      }
      for (const candidate of record.candidates) {
        if (candidate.relPath === oldRel) {
          candidate.relPath = newRel;
          touched = true;
        }
      }
    }
    this.noteCandidates.sort((a, b) => a.relPath.localeCompare(b.relPath));
    if (touched) {
      this.sort();
      await this.persist();
    }
  }

  private dropRejected(owner: string, other: string): void {
    const key = pairKey({ vaultId: '', relPath: owner }, { vaultId: '', relPath: other });
    this.rejected = this.rejected.filter((r) => r.key !== key);
  }

  private sort(): void {
    this.pairs.sort((a, b) => (a.owner === b.owner ? a.other.localeCompare(b.other) : a.owner.localeCompare(b.owner)));
  }

  private async persist(): Promise<void> {
    const file: SimilarFile = {
      version: 1,
      pairs: this.pairs,
      rejectedPairs: this.rejected,
      noteCandidates: this.noteCandidates,
    };
    await this.io.write(SIMILAR_PATH, JSON.stringify(file, null, 2) + '\n');
  }
}
