// src/domain/takeover.ts — PURE decision function for the takeover policy (D9/S10).
// Decides which provisional entries to APPLY or DEMOTE. It does NOT write anything —
// applying/demoting (the `ai:` frontmatter write) is the repository's job in pass 6.

import type { AiAnnotation, AiFrontmatter, ParsedNote } from './types';
import type { LinkPayload, TagPayload, TopicPayload } from './aiPayloads';

export const DEFAULT_TAKEOVER_THRESHOLD = 0.75;

export type TakeoverDecision =
  | { action: 'apply'; apply: AiAnnotation[] }
  | { action: 'demote'; demote: AiAnnotation[] }
  | { action: 'none' };

export interface TakeoverOptions {
  /** Confidence floor for auto-applying provisional structure (default 0.75, S10). */
  threshold?: number;
}

/** Kinds that become provisional structure in the `ai:` block (S10). */
const PROVISIONABLE = new Set<AiAnnotation['kind']>(['topic', 'link', 'tag']);

/**
 * A note is "bare" iff it carries NO user structure: no wikilinks and no tags in the body,
 * and no user `tags:` frontmatter (S10). Folder membership is NOT counted here (D9).
 */
export function isBare(note: ParsedNote): boolean {
  if (note.links.length > 0) return false;
  if (note.tags.length > 0) return false;
  return !hasFrontmatterTags(note);
}

function hasFrontmatterTags(note: ParsedNote): boolean {
  const raw = note.frontmatter.tags;
  if (raw == null) return false;
  if (Array.isArray(raw)) return raw.length > 0;
  if (typeof raw === 'string') return raw.trim() !== '';
  return true; // any other non-null shape counts as user-supplied structure
}

/**
 * Decide the takeover action for one note given its annotations (S10 state machine):
 * - user structure present ⇒ demote every `applied-provisional` annotation back to suggestions
 *   (removing the `ai:` block is the caller's follow-up);
 * - bare + suggestions at/above the confidence threshold exist ⇒ apply them provisionally;
 * - otherwise nothing to do. Rejected entries (D10) are never auto-applied.
 */
export function decideTakeover(
  note: ParsedNote,
  annotations: AiAnnotation[],
  options: TakeoverOptions = {},
): TakeoverDecision {
  const threshold = options.threshold ?? DEFAULT_TAKEOVER_THRESHOLD;

  if (!isBare(note)) {
    const demote = annotations.filter((a) => a.status === 'applied-provisional');
    return demote.length ? { action: 'demote', demote } : { action: 'none' };
  }

  const apply = annotations.filter(
    (a) =>
      a.status === 'suggested' &&
      a.confidence >= threshold &&
      PROVISIONABLE.has(a.kind),
  );
  return apply.length ? { action: 'apply', apply } : { action: 'none' };
}

/**
 * Build the `ai:` frontmatter (S10 schema) from the annotations being applied provisionally.
 * Only provisionable kinds contribute: `tag` → `tags`, `link` → `links` (the raw target text,
 * resolved per S4 at read time), `topic` → `topics` (the topic id or, absent an ontology in
 * pass 6, its name). De-duplicated in stable order. `applied`/`model` stamp provenance.
 */
export function buildAiFrontmatter(
  apply: AiAnnotation[],
  model: string,
  appliedAt: string,
): AiFrontmatter {
  const tags: string[] = [];
  const links: string[] = [];
  const topics: string[] = [];
  const pushUnique = (arr: string[], v: string): void => {
    if (v && !arr.some((x) => x.toLowerCase() === v.toLowerCase())) arr.push(v);
  };
  for (const a of apply) {
    if (a.kind === 'tag') pushUnique(tags, (a.payload as TagPayload).name);
    else if (a.kind === 'link') pushUnique(links, (a.payload as LinkPayload).target);
    else if (a.kind === 'topic') {
      const p = a.payload as TopicPayload;
      pushUnique(topics, p.existingTopicId ?? p.name);
    }
  }
  const ai: AiFrontmatter = { v: 1, model, applied: appliedAt };
  if (tags.length) ai.tags = tags;
  if (links.length) ai.links = links;
  if (topics.length) ai.topics = topics;
  return ai;
}
