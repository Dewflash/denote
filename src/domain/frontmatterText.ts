// src/domain/frontmatterText.ts — PURE textual frontmatter surgery.
//
// This is the ONE place note frontmatter is edited by line, never by YAML round-trip.
// Rationale is the same load-bearing rule as S1/hashing.ts: re-serializing YAML is not
// byte-stable (key order, quoting, indentation drift), and for the `ai:` block that instability
// would change contentHash and re-trigger enrichment forever (R1). So every mutation here is a
// surgical line edit that leaves all OTHER frontmatter lines and the body verbatim.
//
// `hashing.ts` (frozen, architect-verified) keeps its own inlined copy of the ai-block range
// scan; this module re-derives the same scan for the WRITE side. The invariant that ties them
// together — stripAiBlock(writeAiFrontmatter(text, ai)) === stripAiBlock(text) for all ai — is
// asserted by tests, not by shared code, so hashing.ts never has to change.

/** A note split into its frontmatter lines (the content strictly between the `---` delimiters)
 *  and its body. `fmLines === null` means the note has no (terminated) frontmatter block. */
export interface FrontmatterSplit {
  fmLines: string[] | null;
  body: string;
}

/** Split normalized text into frontmatter lines + body. Mirrors hashing.ts's delimiter scan:
 *  frontmatter exists only if the text starts with `---\n` AND a later line is exactly `---`
 *  or `...`. An unterminated `---` is treated as plain body (never as frontmatter). */
export function splitFrontmatter(normalizedText: string): FrontmatterSplit {
  if (!normalizedText.startsWith('---\n')) return { fmLines: null, body: normalizedText };
  const lines = normalizedText.split('\n');
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---' || lines[i] === '...') {
      close = i;
      break;
    }
  }
  if (close === -1) return { fmLines: null, body: normalizedText };
  return { fmLines: lines.slice(1, close), body: lines.slice(close + 1).join('\n') };
}

/** Reassemble text from frontmatter lines + body. An empty/`null` frontmatter drops the
 *  delimiters entirely (a note that had only an `ai:` block becomes plain body again). */
export function joinFrontmatter(fmLines: string[] | null, body: string): string {
  if (!fmLines || fmLines.length === 0) return body;
  return `---\n${fmLines.join('\n')}\n---\n${body}`;
}

/** Locate the top-level `ai:` block within frontmatter lines (S1 semantics). Indented `  ai:`
 *  and near-miss keys like `aim:` never match. Returns the inclusive `[start, end]` line range,
 *  or null if there is no `ai:` block. */
export function findAiBlockRange(fmLines: string[]): { start: number; end: number } | null {
  let start = -1;
  for (let i = 0; i < fmLines.length; i++) {
    if (/^ai:(\s|$)/.test(fmLines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  let end = start;
  let i = start + 1;
  while (i < fmLines.length) {
    if (/^[ \t]/.test(fmLines[i])) {
      end = i;
      i++;
      continue;
    }
    if (fmLines[i] === '') {
      // A blank line stays in the block only if a later consecutive blank-run is followed by
      // an indented (still-in-block) line.
      let j = i;
      while (j < fmLines.length && fmLines[j] === '') j++;
      if (j < fmLines.length && /^[ \t]/.test(fmLines[j])) {
        end = j;
        i = j + 1;
        continue;
      }
    }
    break;
  }
  return { start, end };
}

/** Remove the top-level `ai:` block from frontmatter lines (no-op if absent). */
export function removeAiBlock(fmLines: string[]): string[] {
  const range = findAiBlockRange(fmLines);
  if (!range) return fmLines;
  return [...fmLines.slice(0, range.start), ...fmLines.slice(range.end + 1)];
}

/** YAML-emit a scalar: leave simple tokens bare (`finance`, `nested/tag-2`), double-quote
 *  anything with spaces or punctuation (`"Banking Policy"`, `"mock@1"`, ISO timestamps). */
export function yamlScalar(s: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(s) ? s : JSON.stringify(s);
}

/** Emit a YAML flow sequence: `[a, "b c"]`. */
export function yamlFlowSeq(items: string[]): string {
  return `[${items.map(yamlScalar).join(', ')}]`;
}

const foldNfc = (s: string): string => s.normalize('NFC').toLowerCase();

/**
 * Add `value` to a top-level sequence key in the (user) frontmatter, creating the key if
 * absent, de-duplicating case-insensitively. Handles the three shapes a user might already have:
 *   - absent            → append `key: [value]` (flow)
 *   - flow  `key: [a]`  → merge into the flow list
 *   - block `key:\n - a`→ append a new `  - value` block item after the last item
 * Returns a NEW frontmatter-lines array (input untouched). Only the target key's line(s) change.
 */
export function addSeqItem(fmLines: string[], key: string, value: string): string[] {
  const keyRe = new RegExp(`^${escapeRe(key)}:(\\s*)(.*)$`);
  let keyIdx = -1;
  let inlineValue = '';
  for (let i = 0; i < fmLines.length; i++) {
    const m = keyRe.exec(fmLines[i]);
    if (m) {
      keyIdx = i;
      inlineValue = m[2];
      break;
    }
  }

  if (keyIdx === -1) {
    return [...fmLines, `${key}: ${yamlFlowSeq([value])}`];
  }

  const flow = inlineValue.trim();
  if (flow.startsWith('[') && flow.endsWith(']')) {
    const inner = flow.slice(1, -1).trim();
    const items = inner === '' ? [] : splitFlowItems(inner);
    if (items.some((it) => foldNfc(stripQuotes(it)) === foldNfc(value))) return [...fmLines];
    const merged = [...items.map(stripQuotes), value];
    const out = [...fmLines];
    out[keyIdx] = `${key}: ${yamlFlowSeq(merged)}`;
    return out;
  }

  // Block sequence: collect following `  - item` lines.
  const blockItems: string[] = [];
  let lastBlockIdx = keyIdx;
  for (let i = keyIdx + 1; i < fmLines.length; i++) {
    const bm = /^\s+-\s+(.*)$/.exec(fmLines[i]);
    if (!bm) break;
    blockItems.push(bm[1].trim());
    lastBlockIdx = i;
  }
  if (flow === '' && blockItems.length > 0) {
    if (blockItems.some((it) => foldNfc(stripQuotes(it)) === foldNfc(value))) return [...fmLines];
    const out = [...fmLines];
    out.splice(lastBlockIdx + 1, 0, `  - ${yamlScalar(value)}`);
    return out;
  }

  // A scalar (`key: something`) or an empty `key:` with no block items → normalize to flow.
  const existing = flow === '' ? [] : [stripQuotes(flow)];
  if (existing.some((it) => foldNfc(it) === foldNfc(value))) return [...fmLines];
  const out = [...fmLines];
  out[keyIdx] = `${key}: ${yamlFlowSeq([...existing, value])}`;
  return out;
}

/** Set (or replace) a top-level scalar key in the frontmatter. */
export function setScalar(fmLines: string[], key: string, value: string): string[] {
  const keyRe = new RegExp(`^${escapeRe(key)}:(\\s|$)`);
  const line = `${key}: ${yamlScalar(value)}`;
  const idx = fmLines.findIndex((l) => keyRe.test(l));
  if (idx === -1) return [...fmLines, line];
  const out = [...fmLines];
  out[idx] = line;
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split flow-sequence inner text on commas that are not inside quotes. */
function splitFlowItems(inner: string): string[] {
  const out: string[] = [];
  let buf = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      buf += c;
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      buf += c;
    } else if (c === ',') {
      out.push(buf.trim());
      buf = '';
    } else {
      buf += c;
    }
  }
  if (buf.trim() !== '') out.push(buf.trim());
  return out;
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    try {
      return t.startsWith('"') ? JSON.parse(t) : t.slice(1, -1);
    } catch {
      return t.slice(1, -1);
    }
  }
  return t;
}
