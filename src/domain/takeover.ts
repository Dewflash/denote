// src/domain/takeover.ts — PURE decision function for the takeover policy (D9/S10).
// Decides which provisional entries to APPLY or DEMOTE. It does NOT write anything —
// applying/demoting (the `ai:` frontmatter write) is the repository's job in pass 6.

import type { AiAnnotation, ParsedNote } from './types';

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
