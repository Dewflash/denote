// src/domain/aiPayloads.ts — PURE. Per-kind AiAnnotation payload schemas (pass-06 brief) and the
// rejection fingerprint (S11). `AiAnnotation.payload` is typed `unknown` in types.ts; these are
// the concrete shapes each `kind` carries, plus typed guards so the store/UI don't cast blindly.

import { sha256Hex } from './sha256';
import type { AiAnnotation } from './types';

/** topic {name, existingTopicId|null} — attach to an existing topic or (pass 8) create one. */
export interface TopicPayload {
  name: string;
  existingTopicId: string | null;
}
/** link {target, targetPath?, span?} — `target` is the wikilink text; `targetPath` is the
 *  resolved relPath when the suggestion points at a real note (used for the fingerprint, S11);
 *  `span` (optional) is a body offset range to link in place instead of appending to `## Related`. */
export interface LinkPayload {
  target: string;
  targetPath?: string;
  span?: { from: number; to: number };
}
/** tag {name} — a provisional/real `#tag` (stored lowercased for identity, S3). */
export interface TagPayload {
  name: string;
}
/** summary {text} — a one-paragraph note summary. */
export interface SummaryPayload {
  text: string;
}
/** alias {name} — an alternate title for the note. */
export interface AliasPayload {
  name: string;
}

export type AiPayloadFor<K extends AiAnnotation['kind']> = K extends 'topic'
  ? TopicPayload
  : K extends 'link'
    ? LinkPayload
    : K extends 'tag'
      ? TagPayload
      : K extends 'summary'
        ? SummaryPayload
        : K extends 'alias'
          ? AliasPayload
          : never;

export function payloadOf<K extends AiAnnotation['kind']>(
  ann: AiAnnotation & { kind: K },
): AiPayloadFor<K> {
  return ann.payload as AiPayloadFor<K>;
}

const foldNfc = (s: string): string => s.normalize('NFC').toLowerCase();

/**
 * The normalized target string a rejection fingerprint is computed over (S11): lowercase-NFC of
 * the topic name / resolved-or-raw link target / tag name / first 64 chars of summary / alias
 * name. Reason and confidence are deliberately NOT part of it — a reworded reason must not
 * resurrect a rejected suggestion (pass-06 pitfall).
 */
export function fingerprintTarget(kind: AiAnnotation['kind'], payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  switch (kind) {
    case 'topic':
      return foldNfc(String(p.name ?? ''));
    case 'link':
      return foldNfc(String(p.targetPath ?? p.target ?? ''));
    case 'tag':
      return foldNfc(String(p.name ?? ''));
    case 'summary':
      return foldNfc(String(p.text ?? '').slice(0, 64));
    case 'alias':
      return foldNfc(String(p.name ?? ''));
    default:
      return '';
  }
}

/** `sha256(kind + "\x1f" + normalizedTarget)` (S11). Suppression is keyed on (fingerprint,
 *  contentHash): identical content never re-asks; any content edit gives the suggestion a fresh
 *  chance (the contentHash side of the key lives in the rejection store, not here). */
export function rejectionFingerprint(kind: AiAnnotation['kind'], payload: unknown): string {
  return sha256Hex(`${kind}\x1f${fingerprintTarget(kind, payload)}`);
}
