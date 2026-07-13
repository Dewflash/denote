// src/services/importer.ts — pass-11 external import planning.
// Files are copied into the vault through Repository, never by raw fs writes.

import { contentHash, normalize, parseNote, stripAiBlock } from '../domain';
import type { ParsedNote } from '../domain';

export type ImportDecision = 'import' | 'skip-exact' | 'review-near' | 'warn-ai-key';

export interface IncomingFile {
  relPath: string;
  content: string;
}

export interface ImportPlanItem {
  incoming: IncomingFile;
  decision: ImportDecision;
  reason: string;
  duplicateOf?: string;
  similarity?: number;
  warnings: string[];
}

export interface ImportPlan {
  items: ImportPlanItem[];
  exactSkipped: number;
  nearReview: number;
  warnings: string[];
}

export interface ExistingNoteForImport {
  relPath: string;
  content: string;
  parsed?: ParsedNote;
}

export interface ImportEmbeddingVectors {
  existing: Map<string, number[]>;
  incoming: Map<string, number[]>;
}

const NEAR_DUPLICATE_THRESHOLD = 0.95;
type SimilarityVector = Map<string, number> | number[];

export function planImport(existing: ExistingNoteForImport[], incoming: IncomingFile[], embeddings?: ImportEmbeddingVectors): ImportPlan {
  const existingByHash = new Map<string, string>();
  const existingVectors = existing.map((e) => ({
    relPath: e.relPath,
    vector: embeddings?.existing.get(e.relPath) ?? tokenVector((e.parsed ?? parseNote(e.relPath, e.content)).bodyText || stripAiBlock(e.content)),
  }));
  for (const note of existing) existingByHash.set(contentHash(note.content), note.relPath);

  const seenIncoming = new Map<string, string>();
  const items: ImportPlanItem[] = [];
  const warnings: string[] = [];

  for (const file of incoming.filter((f) => isImportableTextFile(f.relPath))) {
    const hash = contentHash(file.content);
    const itemWarnings = hasReservedAiKey(file.content) ? ['Incoming file has reserved top-level ai: frontmatter; DeNote will treat it as app-owned metadata.'] : [];
    if (itemWarnings.length) warnings.push(`${file.relPath}: ${itemWarnings[0]}`);

    const exact = existingByHash.get(hash) ?? seenIncoming.get(hash);
    if (exact) {
      items.push({
        incoming: file,
        decision: 'skip-exact',
        reason: 'Exact contentHash duplicate.',
        duplicateOf: exact,
        warnings: itemWarnings,
      });
      continue;
    }

    const vector = embeddings?.incoming.get(file.relPath) ?? tokenVector(parseNote(file.relPath, file.content).bodyText || stripAiBlock(file.content));
    let best: { relPath: string; score: number } | null = null;
    for (const candidate of existingVectors) {
      const score = cosine(vector, candidate.vector);
      if (!best || score > best.score) best = { relPath: candidate.relPath, score };
    }

    if (best && best.score >= NEAR_DUPLICATE_THRESHOLD) {
      items.push({
        incoming: file,
        decision: 'review-near',
        reason: 'Near-duplicate candidate; user review required.',
        duplicateOf: best.relPath,
        similarity: best.score,
        warnings: itemWarnings,
      });
    } else {
      items.push({
        incoming: file,
        decision: itemWarnings.length ? 'warn-ai-key' : 'import',
        reason: itemWarnings.length ? 'Importable, with reserved ai: warning.' : 'Importable.',
        warnings: itemWarnings,
      });
    }

    seenIncoming.set(hash, file.relPath);
  }

  return {
    items,
    exactSkipped: items.filter((i) => i.decision === 'skip-exact').length,
    nearReview: items.filter((i) => i.decision === 'review-near').length,
    warnings,
  };
}

export function mapObsidianRelPath(relPath: string): string | null {
  const normalized = relPath.split('\\').join('/');
  if (normalized.split('/').some((part) => part === '.obsidian')) return null;
  return isImportableTextFile(normalized) ? normalized.replace(/\.txt$/i, '.md') : null;
}

export function isImportableTextFile(relPath: string): boolean {
  return /\.(md|txt)$/i.test(relPath) && !relPath.split('/').some((part) => part.startsWith('.'));
}

function hasReservedAiKey(content: string): boolean {
  const t = normalize(content);
  if (!t.startsWith('---\n')) return false;
  const lines = t.split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---' || lines[i] === '...') return false;
    if (/^ai:(\s|$)/.test(lines[i])) return true;
  }
  return false;
}

function tokenVector(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const token of normalize(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (token.length < 2) continue;
    out.set(token, (out.get(token) ?? 0) + 1);
  }
  return out;
}

function cosine(a: SimilarityVector, b: SimilarityVector): number {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
    let dot = 0;
    let a2 = 0;
    let b2 = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      a2 += a[i] * a[i];
      b2 += b[i] * b[i];
    }
    if (a2 === 0 || b2 === 0) return 0;
    return dot / (Math.sqrt(a2) * Math.sqrt(b2));
  }
  let dot = 0;
  let a2 = 0;
  let b2 = 0;
  for (const v of a.values()) a2 += v * v;
  for (const v of b.values()) b2 += v * v;
  for (const [key, av] of a) dot += av * (b.get(key) ?? 0);
  if (a2 === 0 || b2 === 0) return 0;
  return dot / (Math.sqrt(a2) * Math.sqrt(b2));
}
