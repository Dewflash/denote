// src/domain/aiFrontmatter.ts — PURE. Write / remove the reserved `ai:` frontmatter block
// (D28, schema S10) into note text.
//
// LOAD-BEARING (R1): `writeAiFrontmatter` only ever adds or removes the `ai:` block; it leaves
// every user frontmatter line and the whole body byte-for-byte unchanged. Because contentHash
// (D3a/S1) strips the `ai:` block textually, this guarantees
//     contentHash(writeAiFrontmatter(text, ai)) === contentHash(text)     for all `ai`
// so a takeover write never changes the hash and never re-triggers enrichment. That invariant
// is asserted directly in the tests.

import { normalize } from './hashing';
import {
  joinFrontmatter,
  removeAiBlock,
  splitFrontmatter,
  yamlFlowSeq,
  yamlScalar,
} from './frontmatterText';
import type { AiFrontmatter } from './types';

/** Render the `ai:` block as YAML lines (deterministic key order, S10 schema). */
export function renderAiBlock(ai: AiFrontmatter): string[] {
  const lines = ['ai:', `  v: ${ai.v}`];
  if (ai.tags && ai.tags.length) lines.push(`  tags: ${yamlFlowSeq(ai.tags)}`);
  if (ai.links && ai.links.length) lines.push(`  links: ${yamlFlowSeq(ai.links)}`);
  if (ai.topics && ai.topics.length) lines.push(`  topics: ${yamlFlowSeq(ai.topics)}`);
  if (ai.applied) lines.push(`  applied: ${yamlScalar(ai.applied)}`);
  if (ai.model) lines.push(`  model: ${yamlScalar(ai.model)}`);
  return lines;
}

/**
 * Return `text` with its `ai:` block replaced by `ai` (or removed entirely when `ai === null`).
 * User frontmatter lines are preserved in order; the `ai:` block is always emitted LAST among
 * frontmatter keys. The result is normalized (BOM/CRLF/NFC per S1).
 */
export function writeAiFrontmatter(text: string, ai: AiFrontmatter | null): string {
  const t = normalize(text);
  // When there is no frontmatter, splitFrontmatter returns body === t, so a new block is simply
  // prepended before the existing body.
  const { fmLines, body } = splitFrontmatter(t);
  const cleaned = fmLines ? removeAiBlock(fmLines) : [];

  if (ai === null) {
    // No frontmatter survives → the note is body-only again.
    return joinFrontmatter(cleaned.length ? cleaned : null, body);
  }
  const fm = [...cleaned, ...renderAiBlock(ai)];
  return joinFrontmatter(fm, body);
}

/** True iff writing `ai` would produce byte-identical text (S10 idempotency: skip the write). */
export function aiBlockUnchanged(text: string, ai: AiFrontmatter | null): boolean {
  return writeAiFrontmatter(text, ai) === normalize(text);
}
