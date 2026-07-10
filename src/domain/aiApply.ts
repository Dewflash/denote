// src/domain/aiApply.ts — PURE. Turn an ACCEPTED AiAnnotation into a real note-body/frontmatter
// edit (pass-06 brief: "Accept: writes the real wikilink … tag (frontmatter tags:), etc."). Unlike
// the `ai:` block (aiFrontmatter.ts), these writes ARE user structure and DO change contentHash
// on purpose — accepting a suggestion counts as curation and demotes the note's remaining
// provisional entries (D30/S10), which the caller handles.

import { normalize } from './hashing';
import { addSeqItem, joinFrontmatter, setScalar, splitFrontmatter } from './frontmatterText';
import type { AliasPayload, LinkPayload, SummaryPayload, TagPayload, TopicPayload } from './aiPayloads';
import type { AiAnnotation } from './types';

const RELATED_HEADING = '## Related';

/** Apply an accepted annotation to note text, returning the new text. Kinds:
 *   - link    → `[[target]]` appended under a `## Related` section (created if absent), unless a
 *               body span is given (in which case the span text is wrapped in `[[ ]]` in place);
 *   - tag     → added to the user frontmatter `tags:` sequence;
 *   - topic   → added to the user frontmatter `topics:` sequence;
 *   - alias   → added to the user frontmatter `aliases:` sequence;
 *   - summary → set as the user frontmatter `summary:` scalar.
 * The result is normalized. If the edit would be a no-op (e.g. the link already exists) the
 * original normalized text is returned. */
export function applyAcceptedAnnotation(text: string, ann: AiAnnotation): string {
  const t = normalize(text);
  switch (ann.kind) {
    case 'link':
      return applyLink(t, ann.payload as LinkPayload);
    case 'tag':
      return applyToFrontmatterSeq(t, 'tags', (ann.payload as TagPayload).name);
    case 'topic':
      return applyToFrontmatterSeq(t, 'topics', (ann.payload as TopicPayload).name);
    case 'alias':
      return applyToFrontmatterSeq(t, 'aliases', (ann.payload as AliasPayload).name);
    case 'summary':
      return applyScalar(t, 'summary', (ann.payload as SummaryPayload).text);
    default:
      return t;
  }
}

function applyLink(t: string, payload: LinkPayload): string {
  const target = payload.target.trim();
  if (target === '') return t;

  if (payload.span && payload.span.from >= 0 && payload.span.to <= t.length && payload.span.from < payload.span.to) {
    const { from, to } = payload.span;
    return t.slice(0, from) + `[[${t.slice(from, to)}]]` + t.slice(to);
  }

  const token = `[[${target}]]`;
  if (t.includes(token)) return t; // already linked
  const headingIdx = t.indexOf(RELATED_HEADING);
  if (headingIdx !== -1) {
    // Append under the existing section, after any lines already there.
    const trimmed = t.replace(/\n+$/, '');
    return `${trimmed}\n- ${token}\n`;
  }
  const base = t.replace(/\n+$/, '');
  const sep = base === '' ? '' : '\n\n';
  return `${base}${sep}${RELATED_HEADING}\n\n- ${token}\n`;
}

function applyToFrontmatterSeq(t: string, key: string, value: string): string {
  const { fmLines, body } = splitFrontmatter(t);
  const nextFm = addSeqItem(fmLines ?? [], key, value);
  return joinFrontmatter(nextFm, fmLines ? body : t);
}

function applyScalar(t: string, key: string, value: string): string {
  const { fmLines, body } = splitFrontmatter(t);
  const nextFm = setScalar(fmLines ?? [], key, value);
  return joinFrontmatter(nextFm, fmLines ? body : t);
}
