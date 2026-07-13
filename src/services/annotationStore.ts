// src/services/annotationStore.ts — the AI annotation + rejection store for ONE vault (D3 tier 3).
//
// Files: `.denote/ai/annotations.json` and `.denote/ai/rejections.json` (S26 `version: 1`).
// Annotations are keyed by `relPath + contentHash` inside the record (D3); rejections are keyed
// by `(fingerprint, contentHash)` (S11/D10) so identical content never re-asks a rejected
// suggestion but any content edit gives it a fresh chance.
//
// This service does no fs of its own — it takes an `InternalStoreIO` (the Repository's guarded
// `.denote/` reader/writer), so every write still routes through the repository (D23) while
// keeping this module free of any `state/` import (services must not depend on state).

import { rejectionFingerprint } from '../domain/aiPayloads';
import type { AiAnnotation } from '../domain/types';
import { loadMigratedJson } from './migrations';

export const ANNOTATIONS_PATH = '.denote/ai/annotations.json';
export const REJECTIONS_PATH = '.denote/ai/rejections.json';

/** A rejected suggestion, remembered so it is never re-surfaced for identical content (D10/S11). */
export interface RejectionRecord {
  fingerprint: string;
  contentHash: string;
  notePath: string;
  kind: AiAnnotation['kind'];
  rejectedAt: string;
}

interface AnnotationsFile {
  version: 1;
  annotations: AiAnnotation[];
}
interface RejectionsFile {
  version: 1;
  rejections: RejectionRecord[];
  /** Reserved for pass-7 similarity-pair rejections (S15); untouched here. */
  similarityPairs?: unknown[];
}

/** The guarded `.denote/` I/O surface (the Repository supplies this). */
export interface InternalStoreIO {
  read(relPath: string): Promise<string | null>;
  write(relPath: string, content: string): Promise<void>;
  delete?(relPath: string): Promise<void>;
}

const LIVE = new Set<AiAnnotation['status']>(['suggested', 'applied-provisional']);

export class AnnotationStore {
  private annotations: AiAnnotation[] = [];
  private rejections: RejectionRecord[] = [];

  constructor(
    private readonly io: InternalStoreIO,
    private readonly now: () => number = Date.now,
  ) {}

  /** Load both files from disk (tolerant of missing/corrupt files — treated as empty). */
  async load(): Promise<void> {
    this.annotations = (await this.readJson<AnnotationsFile>(ANNOTATIONS_PATH))?.annotations ?? [];
    this.rejections = (await this.readJson<RejectionsFile>(REJECTIONS_PATH))?.rejections ?? [];
  }

  // ── queries ────────────────────────────────────────────────────────────────

  /** Live (suggested / applied-provisional) annotations for a note at a specific content hash. */
  liveFor(relPath: string, contentHash: string): AiAnnotation[] {
    return this.annotations.filter(
      (a) => a.notePath === relPath && a.contentHash === contentHash && LIVE.has(a.status),
    );
  }

  /** All annotations currently stored for a note (any status/hash). */
  allFor(relPath: string): AiAnnotation[] {
    return this.annotations.filter((a) => a.notePath === relPath);
  }

  get(id: string): AiAnnotation | undefined {
    return this.annotations.find((a) => a.id === id);
  }

  hasAnnotationsFor(relPath: string, contentHash: string, model: string): boolean {
    return this.annotations.some(
      (a) => a.notePath === relPath && a.contentHash === contentHash && a.model === model,
    );
  }

  isRejected(fingerprint: string, contentHash: string): boolean {
    return this.rejections.some((r) => r.fingerprint === fingerprint && r.contentHash === contentHash);
  }

  /** True iff the annotation's own (kind, payload, contentHash) has been rejected (S11). */
  isAnnotationRejected(ann: AiAnnotation): boolean {
    return this.isRejected(rejectionFingerprint(ann.kind, ann.payload), ann.contentHash);
  }

  // ── mutations (each persists the affected file) ──────────────────────────────

  /** Replace all LIVE annotations for a note with a fresh set (leaves accepted/rejected history
   *  intact). Used when enrichment produces new suggestions for a note. */
  async replaceLiveFor(relPath: string, next: AiAnnotation[]): Promise<void> {
    this.annotations = this.annotations.filter((a) => !(a.notePath === relPath && LIVE.has(a.status)));
    this.annotations.push(...next);
    await this.persistAnnotations();
  }

  async setStatus(id: string, status: AiAnnotation['status']): Promise<void> {
    const a = this.get(id);
    if (!a) return;
    a.status = status;
    await this.persistAnnotations();
  }

  /** Bulk status change for a note (used by takeover apply/demote). */
  async setStatusFor(ids: string[], status: AiAnnotation['status']): Promise<void> {
    const idset = new Set(ids);
    for (const a of this.annotations) if (idset.has(a.id)) a.status = status;
    await this.persistAnnotations();
  }

  async removeForPath(relPath: string): Promise<void> {
    const before = this.annotations.length;
    this.annotations = this.annotations.filter((a) => a.notePath !== relPath);
    if (this.annotations.length !== before) await this.persistAnnotations();
  }

  /** Move all records for a note to a new path (D4a move/rename reconciliation). */
  async remapPath(oldPath: string, newPath: string): Promise<void> {
    let touched = false;
    for (const a of this.annotations) {
      if (a.notePath === oldPath) {
        a.notePath = newPath;
        touched = true;
      }
    }
    for (const r of this.rejections) {
      if (r.notePath === oldPath) {
        r.notePath = newPath;
        touched = true;
      }
    }
    if (touched) {
      await this.persistAnnotations();
      await this.persistRejections();
    }
  }

  /** Record a rejection (D10). Also removes the matching live annotation from the panel. */
  async reject(ann: AiAnnotation): Promise<void> {
    const fingerprint = rejectionFingerprint(ann.kind, ann.payload);
    if (!this.isRejected(fingerprint, ann.contentHash)) {
      this.rejections.push({
        fingerprint,
        contentHash: ann.contentHash,
        notePath: ann.notePath,
        kind: ann.kind,
        rejectedAt: new Date(this.now()).toISOString(),
      });
      await this.persistRejections();
    }
    this.annotations = this.annotations.filter((a) => a.id !== ann.id);
    await this.persistAnnotations();
  }

  // ── persistence ──────────────────────────────────────────────────────────────

  private async persistAnnotations(): Promise<void> {
    const file: AnnotationsFile = { version: 1, annotations: this.annotations };
    await this.io.write(ANNOTATIONS_PATH, JSON.stringify(file, null, 2) + '\n');
  }

  private async persistRejections(): Promise<void> {
    const file: RejectionsFile = { version: 1, rejections: this.rejections };
    await this.io.write(REJECTIONS_PATH, JSON.stringify(file, null, 2) + '\n');
  }

  private async readJson<T>(relPath: string): Promise<T | null> {
    const result = await loadMigratedJson(this.io, relPath);
    return result?.ok ? result.data as T : null;
  }
}
