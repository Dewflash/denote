// src/services/embeddings.ts — the TS bridge to the Rust embedding subsystem (D24/S14) plus the
// PURE incremental-plan + embed-text helpers.
//
// The Rust core owns model inference AND the on-disk `.bin`/`.idx` store (binary format lives
// where binary belongs); this module is a typed transport plus the small pieces that ARE pure and
// therefore unit-tested here: deciding which notes need (re)embedding (incremental, S14) and
// building the text that represents a note. A mock backend (see tests) drives the similarity
// engine without a Tauri runtime.

import type { ParsedNote } from '../domain';

/** One stored vector's identity (mirrors the Rust `IdxRow`). */
export interface EmbeddingIdxRow {
  row: number;
  relPath: string;
  contentHash: string;
}

/** The `.idx` sidecar as returned by `embeddings_index` (mirrors the Rust `IdxFile`). */
export interface EmbeddingIndex {
  version: number;
  model: string;
  dim: number;
  rows: EmbeddingIdxRow[];
  free: number[];
}

export interface EmbeddingNeighbor {
  relPath: string;
  cos: number;
}

export interface EmbeddingVectorRow {
  relPath: string;
  vector: number[];
}

export interface EmbedResult {
  model: string;
  dim: number;
  vectors: number[][];
}

export interface EmbeddingPutEntry {
  relPath: string;
  contentHash: string;
  vector: number[];
}

/** The transport surface the similarity engine depends on (Tauri impl below; mock in tests). */
export interface EmbeddingsBackend {
  embed(texts: string[]): Promise<EmbedResult>;
  index(root: string): Promise<EmbeddingIndex>;
  put(root: string, model: string, dim: number, entries: EmbeddingPutEntry[]): Promise<void>;
  remove(root: string, relPath: string): Promise<void>;
  remap(root: string, from: string, to: string): Promise<void>;
  topK(root: string, relPath: string, k: number, minCos: number): Promise<EmbeddingNeighbor[]>;
  /** Stored vectors for a set of relPaths (pass-8 folder-centroid / misfit). Missing paths omitted. */
  vectors(root: string, relPaths: string[]): Promise<EmbeddingVectorRow[]>;
}

/** Max characters of a note fed to the embedding model. multilingual-e5-small caps around 512
 *  tokens (~1800 chars); we keep a little headroom. Title leads so short notes embed their title. */
const EMBED_CHAR_CAP = 1600;

/** The text representing a note for embedding: its title followed by the plain-text body, capped.
 *  PURE (title + bodyText only) so it's deterministic and testable. */
export function embedTextForNote(note: Pick<ParsedNote, 'title' | 'bodyText'>): string {
  const body = note.bodyText?.trim() ?? '';
  const combined = body ? `${note.title}\n\n${body}` : note.title;
  return combined.slice(0, EMBED_CHAR_CAP);
}

export interface EmbedPlan {
  /** Notes whose (relPath, contentHash) is not already in the store — need embedding. */
  toEmbed: { relPath: string; contentHash: string }[];
  /** Stored paths no longer present in the vault — should be dropped. */
  toRemove: string[];
  /** True when the store's model differs from the current model → whole store is invalid (S14). */
  modelChanged: boolean;
}

/** Compute the incremental work (S14 "only changed hashes re-embed"). A model mismatch invalidates
 *  the entire store: everything is re-embedded and nothing is treated as already present. PURE. */
export function computeEmbedPlan(
  index: EmbeddingIndex,
  wanted: { relPath: string; contentHash: string }[],
  currentModel: string,
): EmbedPlan {
  const modelChanged = index.rows.length > 0 && index.model !== '' && index.model !== currentModel;
  if (modelChanged) {
    return { toEmbed: wanted.map((w) => ({ ...w })), toRemove: [], modelChanged: true };
  }
  const have = new Map<string, string>(); // relPath -> contentHash
  for (const r of index.rows) have.set(r.relPath, r.contentHash);
  const wantedPaths = new Set(wanted.map((w) => w.relPath));

  const toEmbed = wanted.filter((w) => have.get(w.relPath) !== w.contentHash);
  const toRemove = index.rows.map((r) => r.relPath).filter((p) => !wantedPaths.has(p));
  return { toEmbed, toRemove, modelChanged: false };
}

// ── Tauri backend (production) ────────────────────────────────────────────────────

/** The real backend. Isolated in a factory so node tests never import `@tauri-apps/*`. */
export function createTauriEmbeddingsBackend(): EmbeddingsBackend {
  // Lazy import keeps this module importable in a node test that only uses the pure helpers.
  const invoke = <T>(cmd: string, args: Record<string, unknown>): Promise<T> =>
    import('@tauri-apps/api/core').then((m) => m.invoke<T>(cmd, args));
  return {
    embed: (texts) => invoke<EmbedResult>('embed_texts', { texts }),
    index: (root) => invoke<EmbeddingIndex>('embeddings_index', { root }),
    put: (root, model, dim, entries) => invoke('embeddings_put', { root, model, dim, entries }),
    remove: (root, relPath) => invoke('embeddings_remove', { root, relPath }),
    remap: (root, from, to) => invoke('embeddings_remap', { root, from, to }),
    topK: (root, relPath, k, minCos) =>
      invoke<EmbeddingNeighbor[]>('embeddings_topk', { root, relPath, k, minCos }),
    vectors: (root, relPaths) =>
      invoke<EmbeddingVectorRow[]>('embeddings_vectors', { root, relPaths }),
  };
}
