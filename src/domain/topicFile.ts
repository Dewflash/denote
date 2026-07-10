// src/domain/topicFile.ts — PURE `_topics/*.md` rendering + the freeze decision (S18/D8c).
//
// The generated file is BYTE-STABLE for an unchanged ontology: no timestamps anywhere, members
// sorted deterministically, so re-rendering the same ontology yields identical bytes and never
// churns snapshots/commits. `generated_hash` (sha256 of the rendered BODY) is the lineage marker:
// if a materialized file's current body hash no longer matches the stored lineage, the USER edited
// it → the generator freezes it (`source: user-modified`) and never regenerates (preserve user work).

import { sha256Hex } from './sha256';
import { splitFrontmatter } from './frontmatterText';
import { normalize } from './hashing';

/** Where a topic's materialized hub note lives (D8c). Name is used verbatim (spaces allowed). */
export function topicFilePath(topicName: string): string {
  return `_topics/${topicName}.md`;
}

export interface TopicFileMember {
  title: string;
  reason: string;
  weight: number;
  relPath: string;
}

export interface TopicFileInput {
  id: string;
  name: string;
  description: string;
  parentName?: string | null;
  relatedNames?: readonly string[];
  members: readonly TopicFileMember[];
}

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Render the topic note BODY (everything from the `# Name` heading down), S18. Deterministic:
 *  members sorted by weight desc then relPath asc; related topics sorted by name. Ends with `\n`. */
export function renderTopicBody(topic: TopicFileInput): string {
  const lines: string[] = [];
  lines.push(`# ${topic.name}`);
  lines.push('');
  lines.push(oneLine(topic.description));
  lines.push('');

  if (topic.parentName) {
    lines.push(`**Parent:** [[_topics/${topic.parentName}]]`);
  }
  const related = [...(topic.relatedNames ?? [])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (related.length > 0) {
    lines.push(`**Related:** ${related.map((n) => `[[_topics/${n}]]`).join(', ')}`);
  }
  if (topic.parentName || related.length > 0) lines.push('');

  lines.push('## Notes');
  const members = [...topic.members].sort((a, b) =>
    b.weight === a.weight ? (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0) : b.weight - a.weight,
  );
  for (const m of members) {
    const reason = oneLine(m.reason);
    lines.push(reason ? `- [[${m.title}]] — ${reason}` : `- [[${m.title}]]`);
  }
  return lines.join('\n') + '\n';
}

/** sha256 of the rendered body (S18 `generated_hash`). */
export function topicBodyHash(body: string): string {
  return sha256Hex(body);
}

/** Assemble the full `_topics/*.md` file: `ai` frontmatter (source/topic_id/generated_hash) + body.
 *  `source` defaults to `ai`; the freeze path re-assembles with `user-modified` (never regenerated
 *  again). */
export function assembleTopicFile(
  topic: TopicFileInput,
  source: 'ai' | 'user-modified' = 'ai',
): { body: string; generatedHash: string; content: string } {
  const body = renderTopicBody(topic);
  const generatedHash = topicBodyHash(body);
  const content = `---\nsource: ${source}\ntopic_id: ${topic.id}\ngenerated_hash: ${generatedHash}\n---\n${body}`;
  return { body, generatedHash, content };
}

/** Read `source` / `topic_id` / `generated_hash` from an existing `_topics` file, plus its body
 *  (for the current-body-hash comparison). Tolerant: a missing/short frontmatter yields nulls. */
export function readTopicFile(text: string): {
  source: string | null;
  topicId: string | null;
  generatedHash: string | null;
  body: string;
} {
  const { fmLines, body } = splitFrontmatter(normalize(text));
  const scalar = (key: string): string | null => {
    if (!fmLines) return null;
    const line = fmLines.find((l) => l.startsWith(`${key}:`));
    if (!line) return null;
    return line.slice(key.length + 1).trim() || null;
  };
  return {
    source: scalar('source'),
    topicId: scalar('topic_id'),
    generatedHash: scalar('generated_hash'),
    body: fmLines ? body : normalize(text),
  };
}

export type TopicFileAction = 'create' | 'regenerate' | 'freeze' | 'skip';

/**
 * Decide what to do when materializing a topic (S18 freeze rule):
 *  - no file → `create`;
 *  - file already `user-modified` → `skip` (frozen forever);
 *  - file's current body hash ≠ stored lineage → the user edited it → `freeze` (mark once);
 *  - unchanged since generation, and the desired body differs → `regenerate`;
 *  - otherwise byte-stable → `skip`.
 */
export function decideTopicFile(input: {
  exists: boolean;
  currentSource: string | null;
  currentBodyHash: string | null;
  storedGeneratedHash: string | null;
  desiredBody: string;
}): { action: TopicFileAction; desiredHash: string } {
  const desiredHash = topicBodyHash(input.desiredBody);
  if (!input.exists) return { action: 'create', desiredHash };
  if (input.currentSource === 'user-modified') return { action: 'skip', desiredHash };

  // The lineage we compare against: prefer the store's record, fall back to the file's own field.
  const lineage = input.storedGeneratedHash;
  if (lineage !== null && input.currentBodyHash !== null && input.currentBodyHash !== lineage) {
    return { action: 'freeze', desiredHash };
  }
  if (desiredHash !== (lineage ?? input.currentBodyHash)) return { action: 'regenerate', desiredHash };
  return { action: 'skip', desiredHash };
}
