// src/domain/parser.ts — block structure via unified/remark (D20) + a custom inline
// scanner for [[wikilinks]] and #tags over a code-region mask (S5). PURE, deterministic,
// never throws (best-effort + warnings[]).

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import { visit } from 'unist-util-visit';
import { toString as mdastToString } from 'mdast-util-to-string';
import { parse as parseYaml } from 'yaml';
import type { AiFrontmatter, ParsedNote, WikiLink } from './types';
import { normalize } from './hashing';

const processor = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']);

/** Half-open [start, end) offset range excluded from inline scanning. */
interface MaskRange {
  start: number;
  end: number;
}

/** basename of a relPath without the .md extension (S6). */
function filenameTitle(relPath: string): string {
  const base = relPath.split('/').pop() ?? relPath;
  return base.replace(/\.md$/i, '');
}

function isMasked(offset: number, mask: MaskRange[]): boolean {
  // mask is sorted by start; small n per note, linear scan is fine.
  for (const r of mask) {
    if (offset < r.start) return false; // sorted: no later range can contain it
    if (offset < r.end) return true;
  }
  return false;
}

/**
 * Scan wikilinks per S2. Manual scanner (not a single regex) so that `[[a]]b]]`
 * parses `[[a]]` then plain text, and an unclosed `[[foo` stays plain text.
 */
function scanWikiLinks(text: string, mask: MaskRange[]): WikiLink[] {
  const links: WikiLink[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('[[', i);
    if (open === -1) break;
    const embed = open > 0 && text[open - 1] === '!';
    const tokenStart = embed ? open - 1 : open;
    if (isMasked(tokenStart, mask)) {
      i = open + 2;
      continue;
    }
    const close = text.indexOf(']]', open + 2);
    if (close === -1) break; // unclosed -> rest is plain text
    const inner = text.slice(open + 2, close);
    const parsed = parseInner(inner);
    if (parsed) {
      links.push({
        ...parsed,
        embed,
        offsetStart: tokenStart,
        offsetEnd: close + 2,
      });
    }
    i = close + 2;
  }
  return links;
}

/** Parse the inside of `[[ ... ]]` into target/heading/alias. Empty target ⇒ null. */
function parseInner(inner: string): Pick<WikiLink, 'targetTitle' | 'heading' | 'alias'> | null {
  const hash = inner.indexOf('#');
  const pipe = inner.indexOf('|');
  let target: string;
  let heading: string | undefined;
  let alias: string | undefined;

  const firstSpecial =
    hash === -1 ? pipe : pipe === -1 ? hash : Math.min(hash, pipe);

  if (firstSpecial === -1) {
    target = inner.trim();
  } else if (firstSpecial === hash) {
    // heading present: target#heading(|alias)?
    target = inner.slice(0, hash).trim();
    const rest = inner.slice(hash + 1);
    const restPipe = rest.indexOf('|');
    if (restPipe === -1) {
      heading = rest.trim();
    } else {
      heading = rest.slice(0, restPipe).trim();
      alias = rest.slice(restPipe + 1).trim();
    }
  } else {
    // pipe first: target|alias  (alias may contain further | and #)
    target = inner.slice(0, pipe).trim();
    alias = inner.slice(pipe + 1).trim();
  }

  if (target === '') return null;
  const link: Pick<WikiLink, 'targetTitle' | 'heading' | 'alias'> = { targetTitle: target };
  if (heading !== undefined && heading !== '') link.heading = heading;
  if (alias !== undefined && alias !== '') link.alias = alias;
  return link;
}

// S3 tag grammar (verified). `gmu`; capture group 1 = name without `#`. Exported so presentation
// code (editor live-preview decorations) can scan for tag spans using the exact same grammar
// instead of duplicating the regex — this file remains the sole source of truth for it.
export const TAG_RE = /(?<=^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gmu;

/** Scan tags per S3, skipping masked regions. Returns display casing, deduped by lowercase. */
function scanTags(text: string, mask: MaskRange[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(TAG_RE)) {
    const at = m.index ?? 0; // index of '#'
    if (isMasked(at, mask)) continue;
    const name = m[1];
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Parse a note. `relPath` supplies the filename title fallback (S4 step reference).
 * Never throws; on malformed frontmatter it records a warning and yields best-effort.
 */
export function parseNote(relPath: string, rawText: string): ParsedNote {
  const warnings: string[] = [];
  const text = normalize(rawText);

  const mask: MaskRange[] = [];
  const headings: { depth: number; text: string }[] = [];
  let frontmatter: Record<string, unknown> = {};
  let aiFrontmatter: AiFrontmatter | null = null;
  let bodyText = text.trim(); // parse-error fallback: still something for search to index

  try {
    const tree = processor.parse(text);
    bodyText = (tree as { children: { type: string }[] }).children
      .filter((c) => c.type !== 'yaml')
      .map((c) => mdastToString(c))
      .filter((s) => s !== '')
      .join('\n')
      .trim();
    visit(tree, (node) => {
      const pos = node.position;
      if (!pos || pos.start.offset == null || pos.end.offset == null) return;
      switch (node.type) {
        // Math regions (S5) are masked only when a math plugin is present; none is wired
        // in this pass, so `math`/`inlineMath` node types never appear.
        case 'code': // fenced AND indented code blocks
        case 'inlineCode':
        case 'html':
        case 'yaml': // frontmatter region — never scan for links/tags
          mask.push({ start: pos.start.offset, end: pos.end.offset });
          break;
        case 'heading':
          headings.push({
            depth: (node as { depth: number }).depth,
            text: mdastToString(node).trim(),
          });
          break;
        default:
          break;
      }
    });

    // Frontmatter: first top-level yaml node.
    const yamlNode = (tree as { children: { type: string; value?: string }[] }).children.find(
      (c) => c.type === 'yaml',
    );
    if (yamlNode?.value != null) {
      const parsed = parseFrontmatter(yamlNode.value, warnings);
      frontmatter = parsed.user;
      aiFrontmatter = parsed.ai;
    }
  } catch (err) {
    warnings.push(`parse error: ${err instanceof Error ? err.message : String(err)}`);
  }

  mask.sort((a, b) => a.start - b.start);

  const links = scanWikiLinks(text, mask);
  const tags = scanTags(text, mask);

  const h1 = headings.find((h) => h.depth === 1 && h.text !== '');
  const title = h1 ? h1.text : filenameTitle(relPath);

  return { relPath, title, frontmatter, aiFrontmatter, headings, links, tags, warnings, bodyText };
}

/** Parse frontmatter YAML, splitting the reserved `ai:` key (D28) into aiFrontmatter. */
function parseFrontmatter(
  yamlText: string,
  warnings: string[],
): { user: Record<string, unknown>; ai: AiFrontmatter | null } {
  let doc: unknown;
  try {
    doc = parseYaml(yamlText);
  } catch (err) {
    warnings.push(`malformed frontmatter: ${err instanceof Error ? err.message : String(err)}`);
    return { user: {}, ai: null };
  }
  if (doc == null) return { user: {}, ai: null };
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    warnings.push('frontmatter is not a mapping; ignored');
    return { user: {}, ai: null };
  }
  const obj = { ...(doc as Record<string, unknown>) };
  let ai: AiFrontmatter | null = null;
  if ('ai' in obj) {
    const raw = obj.ai;
    delete obj.ai;
    if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
      ai = normalizeAiFrontmatter(raw as Record<string, unknown>);
    } else {
      warnings.push('ai: frontmatter is not a mapping; ignored');
    }
  }
  return { user: obj, ai };
}

function normalizeAiFrontmatter(raw: Record<string, unknown>): AiFrontmatter {
  const asStringArray = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.map((x) => String(x)) : undefined;
  const ai: AiFrontmatter = { v: typeof raw.v === 'number' ? raw.v : 1 };
  const tags = asStringArray(raw.tags);
  const links = asStringArray(raw.links);
  const topics = asStringArray(raw.topics);
  if (tags) ai.tags = tags;
  if (links) ai.links = links;
  if (topics) ai.topics = topics;
  if (typeof raw.applied === 'string') ai.applied = raw.applied;
  if (typeof raw.model === 'string') ai.model = raw.model;
  return ai;
}
