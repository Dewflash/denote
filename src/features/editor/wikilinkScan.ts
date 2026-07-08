// src/features/editor/wikilinkScan.ts — shared PRESENTATION-ONLY approximation of S2 wikilink
// tokens + S26 asset-path resolution, used by both the live-preview decorations (visible-range
// text) and the reading-view renderer (per mdast text-node value). Not authoritative: the real
// scanner is domain/parser.ts, exercised on save.

export interface WikilinkToken {
  start: number;
  end: number;
  bang: boolean;
  target: string;
  alias?: string;
}

const WIKILINK_RE = /(!)?\[\[([^\]]*?)\]\]/g;

function splitInner(inner: string): { target: string; alias?: string } {
  const pipeIdx = inner.indexOf('|');
  const beforeAlias = pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner;
  const alias = pipeIdx >= 0 ? inner.slice(pipeIdx + 1) : undefined;
  const hashIdx = beforeAlias.indexOf('#');
  const target = (hashIdx >= 0 ? beforeAlias.slice(0, hashIdx) : beforeAlias).trim();
  return { target, alias };
}

/** Find `[[...]]`/`![[...]]` tokens in `text`; offsets are relative to `base`. */
export function findWikilinks(text: string, base = 0): WikilinkToken[] {
  const out: WikilinkToken[] = [];
  for (const m of text.matchAll(WIKILINK_RE)) {
    const { target, alias } = splitInner(m[2]);
    if (!target) continue;
    const start = base + (m.index ?? 0);
    out.push({ start, end: start + m[0].length, bang: m[1] === '!', target, alias });
  }
  return out;
}

/** S26: asset embed resolution is steps 1-2 of S4 only (exact relPath, then filename) — no
 *  title matching, since assets aren't parsed for headings. */
export function resolveAssetPath(target: string, assets: readonly string[]): string | null {
  const fold = (s: string): string => s.normalize('NFC').toLowerCase();
  const tf = fold(target);
  const exact = assets.find((a) => fold(a) === tf);
  if (exact) return exact;
  const byName = assets.find((a) => fold(a.split('/').pop() ?? a) === tf);
  return byName ?? null;
}
