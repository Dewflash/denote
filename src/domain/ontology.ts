// src/domain/ontology.ts — PURE ontology math (D14/S17). No I/O, no embeddings inference: the
// embedding VECTORS are supplied by the caller (Rust core owns inference), this module owns the
// deterministic decisions that must be testable in isolation:
//   - topic canonicalization (exact name → alias → centroid ≥ 0.80 → create) — the load-bearing
//     anti-sprawl step (D14/R3): "banking" / "banks" / "banking system" must collapse to ONE topic;
//   - soft membership weights (S17) and the dominant-topic / deterministic-color selection;
//   - folder-profile misfit detection (S17-adjacent, pass-8 brief) and "worth revisiting" ranking.
// Everything here is a pure function of its inputs so the pass-8 vision-corpus assertions are exact.

/** Attach an enrichment-proposed topic to an existing one when the name-string centroid cosine is
 *  ≥ this (D14/S17). */
export const ATTACH_THRESHOLD = 0.8;
/** Merge two existing topics during an Organize-vault sweep when centroids are ≥ this (S17). */
export const MERGE_THRESHOLD = 0.92;
/** Reconfirmations beyond this stop adding to a membership's weight (S17 "max 3"). */
export const MAX_RECONFIRMATIONS = 3;
/** Topic palette size — mirrors the theme's `--graph-hull-0..7` slots (S17 deterministic color). */
export const TOPIC_PALETTE_SIZE = 8;
/** A note is a folder misfit when its embedding-to-folder-centroid cosine is below this AND it
 *  shares zero dominant topics with the folder (pass-8 brief). */
export const MISFIT_COS_THRESHOLD = 0.45;
/** Resurfacing eligibility: a note must be at least this many days old (edited-date, S26). */
export const RESURFACE_AGE_DAYS = 90;
/** At most this many "worth revisiting" cards at a time (pass-8 brief). */
export const RESURFACE_MAX = 5;

// ── vector math ────────────────────────────────────────────────────────────────────

/** Cosine similarity of two equal-length vectors; 0 for empty / mismatched / zero-norm inputs. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** L2-normalized mean of a set of vectors (the folder/topic centroid), or null if empty. */
export function centroidOf(vectors: readonly number[][]): number[] | null {
  const usable = vectors.filter((v) => v.length > 0);
  if (usable.length === 0) return null;
  const dim = usable[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of usable) {
    if (v.length !== dim) continue;
    for (let i = 0; i < dim; i++) sum[i] += v[i];
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += sum[i] * sum[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return null;
  return sum.map((x) => x / norm);
}

// ── name folding (case + diacritic insensitive, S17) ─────────────────────────────────

/** Fold a topic name to its identity key: NFD-strip diacritics, lowercase, collapse whitespace. */
export function foldTopicName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ── canonicalization (D14 / R3) ──────────────────────────────────────────────────────

/** A topic as canonicalization sees it: identity + (optional) name-string centroid. */
export interface TopicMatchInput {
  id: string;
  name: string;
  aliases: string[];
  centroid: number[] | null;
}

export type TopicMatch =
  | { kind: 'exact'; topicId: string }
  | { kind: 'alias'; topicId: string }
  | { kind: 'centroid'; topicId: string; cos: number; addAlias: string }
  | { kind: 'create' };

/**
 * Decide where an enrichment-proposed topic goes (D14 order, mandatory): (1) the LLM's own
 * `existingTopicId` if it names a real topic; (2) exact folded-name match; (3) alias match;
 * (4) centroid cosine ≥ attachThreshold (record the proposed name as a new alias); else (5) create.
 * Deterministic: ties in step 4 break to the lexicographically smaller topic id.
 */
export function canonicalizeTopic(
  proposal: { name: string; existingTopicId?: string | null },
  existing: readonly TopicMatchInput[],
  proposalVector: number[] | null,
  opts: { attachThreshold?: number } = {},
): TopicMatch {
  const attachThreshold = opts.attachThreshold ?? ATTACH_THRESHOLD;

  // (1) the model attached to a real existing topic.
  if (proposal.existingTopicId) {
    const hit = existing.find((t) => t.id === proposal.existingTopicId);
    if (hit) return { kind: 'exact', topicId: hit.id };
  }

  const folded = foldTopicName(proposal.name);

  // (2) exact folded-name match.
  const exact = existing.find((t) => foldTopicName(t.name) === folded);
  if (exact) return { kind: 'exact', topicId: exact.id };

  // (3) alias match.
  const aliased = existing.find((t) => t.aliases.some((a) => foldTopicName(a) === folded));
  if (aliased) return { kind: 'alias', topicId: aliased.id };

  // (4) centroid similarity.
  if (proposalVector && proposalVector.length > 0) {
    let best: { topicId: string; cos: number } | null = null;
    for (const t of existing) {
      if (!t.centroid || t.centroid.length === 0) continue;
      const c = cosine(proposalVector, t.centroid);
      if (c >= attachThreshold && (best === null || c > best.cos || (c === best.cos && t.id < best.topicId))) {
        best = { topicId: t.id, cos: c };
      }
    }
    if (best) return { kind: 'centroid', topicId: best.topicId, cos: best.cos, addAlias: proposal.name };
  }

  // (5) create.
  return { kind: 'create' };
}

/** The string a topic's centroid is computed from (S17): `"{name} — {description}"`, trimmed. */
export function topicCentroidText(name: string, description: string | undefined | null): string {
  const desc = (description ?? '').trim();
  return desc ? `${name.trim()} — ${desc}` : name.trim();
}

// ── membership weights & dominant topic (S17) ────────────────────────────────────────

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Soft membership weight (S17): `clamp01(confidence + 0.1·folder-co-location + 0.05·reconfirmations)`
 * with reconfirmations capped at 3. The folder bonus is additive and never decisive (D14).
 */
export function membershipWeight(
  confidence: number,
  opts: { folderCoLocated?: boolean; reconfirmations?: number } = {},
): number {
  const folder = opts.folderCoLocated ? 0.1 : 0;
  const reconfirm = 0.05 * Math.min(Math.max(0, opts.reconfirmations ?? 0), MAX_RECONFIRMATIONS);
  return clamp01(confidence + folder + reconfirm);
}

export interface Membership {
  topicId: string;
  name: string;
  weight: number;
  stale?: boolean;
}

/** The dominant topic for coloring (S17): max weight, ties broken by lexicographic topic name.
 *  Stale memberships still count (they render at reduced opacity, but a note keeps its color). */
export function dominantTopic(memberships: readonly Membership[]): Membership | null {
  let best: Membership | null = null;
  for (const m of memberships) {
    if (best === null || m.weight > best.weight || (m.weight === best.weight && m.name < best.name)) {
      best = m;
    }
  }
  return best;
}

/** Memberships strong enough to show a mixed-membership ring segment (≥2 strong ones, pass-8). */
export function strongMemberships(memberships: readonly Membership[], minWeight = 0.5): Membership[] {
  return [...memberships]
    .filter((m) => m.weight >= minWeight)
    .sort((a, b) => (b.weight === a.weight ? (a.name < b.name ? -1 : 1) : b.weight - a.weight));
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic palette slot for a topic (S17): `fnv1a(topicId) % TOPIC_PALETTE_SIZE`. */
export function topicColorIndex(topicId: string): number {
  return fnv1a(topicId) % TOPIC_PALETTE_SIZE;
}

// ── folder profile / misfit (pass-8 brief) ───────────────────────────────────────────

/**
 * A note is a folder misfit when it shares ZERO dominant topics with its folder AND its embedding
 * is far from the folder centroid (cosine < MISFIT_COS_THRESHOLD). Both conditions required, so a
 * note with any topic overlap or any embedding affinity is never flagged. Missing vectors ⇒ not a
 * misfit (can't judge). Never triggers an automatic move — the engine renders it as a SUGGESTION.
 */
export function isMisfit(input: {
  noteTopics: readonly string[];
  folderTopics: readonly string[];
  noteVector: number[] | null;
  folderCentroid: number[] | null;
}): boolean {
  const folderSet = new Set(input.folderTopics);
  const overlap = input.noteTopics.some((t) => folderSet.has(t));
  if (overlap) return false;
  if (!input.noteVector || !input.folderCentroid) return false;
  return cosine(input.noteVector, input.folderCentroid) < MISFIT_COS_THRESHOLD;
}

// ── resurfacing ("worth revisiting", pass-8 brief) ───────────────────────────────────

export interface ResurfaceCandidate {
  relPath: string;
  /** Best similarity to something the user touched this week (topic overlap or embedding cosine). */
  similarity: number;
  /** How old the note is by edited-date (S26), in days. */
  ageDays: number;
  /** Why it surfaced (topic name or "similar to …") — carried through for the card. */
  reason: string;
}

export interface ResurfaceCard {
  relPath: string;
  score: number;
  reason: string;
}

/**
 * Rank "worth revisiting" cards (pass-8 brief): notes older than 90 days (edited-date) that share a
 * topic or high similarity with content edited this week, scored by `similarity × age`, at most 5,
 * with `dismissed` paths excluded. Pure local computation — no LLM.
 */
export function computeResurfacing(
  candidates: readonly ResurfaceCandidate[],
  opts: { dismissed?: ReadonlySet<string>; max?: number; minAgeDays?: number } = {},
): ResurfaceCard[] {
  const dismissed = opts.dismissed ?? new Set<string>();
  const minAge = opts.minAgeDays ?? RESURFACE_AGE_DAYS;
  const max = opts.max ?? RESURFACE_MAX;
  return candidates
    .filter((c) => c.ageDays >= minAge && !dismissed.has(c.relPath) && c.similarity > 0)
    .map((c) => ({ relPath: c.relPath, score: c.similarity * c.ageDays, reason: c.reason }))
    .sort((a, b) => (b.score === a.score ? (a.relPath < b.relPath ? -1 : 1) : b.score - a.score))
    .slice(0, max);
}
