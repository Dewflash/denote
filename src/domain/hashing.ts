// src/domain/hashing.ts — S1 normalization + contentHash (D3a). PURE.
//
// LOAD-BEARING (R1): contentHash EXCLUDES the `ai:` frontmatter block. If it did not,
// the takeover policy's own `ai:` writes would change the hash, re-trigger enrichment,
// and loop forever. The strip is TEXTUAL, line-based — never parse/re-serialize YAML
// (round-tripping is not byte-stable). This is a verbatim port of
// docs/reference/hash_spec_test.mjs (architect-verified 2026-07-07). If your code
// disagrees with that script, your code is wrong.

import { sha256Hex } from './sha256';

/** Strip BOM, normalize newlines to \n, NFC. */
export function normalize(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  text = text.replace(/\r\n?/g, '\n'); // CRLF/CR -> LF
  return text.normalize('NFC');
}

/**
 * Remove the top-level `ai:` frontmatter block (S1). Returns normalized text with the
 * `ai:` key and its indented children removed; if the frontmatter becomes empty the
 * delimiters are dropped entirely.
 */
export function stripAiBlock(text: string): string {
  const t = normalize(text);
  if (!t.startsWith('---\n')) return t;
  const lines = t.split('\n');
  // closing delimiter: first line after 0 that is exactly '---' or '...'
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---' || lines[i] === '...') {
      close = i;
      break;
    }
  }
  if (close === -1) return t; // unterminated frontmatter -> treat as body
  const fm = lines.slice(1, close);
  // locate top-level `ai:` line (indented `  ai:` and `aim:` never match)
  let start = -1;
  for (let i = 0; i < fm.length; i++) {
    if (/^ai:(\s|$)/.test(fm[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return t;
  // block extends through indented lines; blank lines are included only if a later
  // consecutive blank-run is followed by an indented line
  let end = start; // inclusive
  let i = start + 1;
  while (i < fm.length) {
    if (/^[ \t]/.test(fm[i])) {
      end = i;
      i++;
      continue;
    }
    if (fm[i] === '') {
      // lookahead across blank run
      let j = i;
      while (j < fm.length && fm[j] === '') j++;
      if (j < fm.length && /^[ \t]/.test(fm[j])) {
        end = j;
        i = j + 1;
        continue;
      }
    }
    break;
  }
  const remaining = [...fm.slice(0, start), ...fm.slice(end + 1)];
  const body = lines.slice(close + 1).join('\n');
  if (remaining.every((l) => l === '')) return body; // fm now empty -> drop delimiters
  return ['---', ...remaining, '---'].join('\n') + '\n' + body;
}

/** SHA-256 hex of the note's normalized content, ai: block excluded (D3a). */
export function contentHash(text: string): string {
  return sha256Hex(stripAiBlock(text));
}
