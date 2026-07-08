// src/domain/links.ts — link resolution & ghost identity (S4). PURE.
// Resolution is vault-scoped (D17). Comparisons are case-insensitive (APFS default, S6)
// over NFC-normalized text; stored casing is preserved.

import type { ParsedNote, VaultId, WikiLink } from './types';

export type LinkMatchType = 'path' | 'filename' | 'title';

export interface ResolvedTarget {
  kind: 'note';
  relPath: string; // the matched note's relPath (stored casing)
  matchType: LinkMatchType;
}
export interface GhostTarget {
  kind: 'ghost';
  id: `ghost:${string}`; // ghost:{vaultId}/{lowercased NFC target}
}
export type LinkResolution = ResolvedTarget | GhostTarget;

/** Minimal note shape needed to resolve links (S4). */
export interface NoteRef {
  relPath: string;
  title: string; // first H1 → filename fallback
}

const fold = (s: string): string => s.normalize('NFC').toLowerCase();
const stripMd = (s: string): string => s.replace(/\.md$/i, '');
const basename = (relPath: string): string => stripMd(relPath.split('/').pop() ?? relPath);

/** Pick the winner among candidate relPaths: shortest relPath, then lexicographic. */
function pickTie(relPaths: string[]): string {
  return [...relPaths].sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))[0];
}

/**
 * Resolve a wikilink target within one vault (S4). First matching step wins; ties broken
 * by shortest-then-lexicographic relPath. No hit ⇒ ghost node keyed by lowercased target.
 * `heading` is ignored for resolution (navigation only, S2).
 */
export function resolveLink(
  target: string,
  notes: NoteRef[],
  vaultId: VaultId,
): LinkResolution {
  const t = target.normalize('NFC').trim();
  const tf = fold(t);
  const tfNoMd = stripMd(tf);

  // Step 1: exact relPath match, with or without .md (case-insensitive).
  const pathHits = notes
    .filter((n) => {
      const rf = fold(n.relPath);
      return rf === tf || stripMd(rf) === tfNoMd;
    })
    .map((n) => n.relPath);
  if (pathHits.length) return { kind: 'note', relPath: pickTie(pathHits), matchType: 'path' };

  // Step 2: filename (basename without .md) match, case-insensitive.
  const nameHits = notes.filter((n) => fold(basename(n.relPath)) === tfNoMd).map((n) => n.relPath);
  if (nameHits.length) return { kind: 'note', relPath: pickTie(nameHits), matchType: 'filename' };

  // Step 3: title (first H1) match, case-insensitive.
  const titleHits = notes.filter((n) => fold(n.title) === tf).map((n) => n.relPath);
  if (titleHits.length) return { kind: 'note', relPath: pickTie(titleHits), matchType: 'title' };

  return { kind: 'ghost', id: `ghost:${vaultId}/${fold(t)}` };
}

export interface ResolvedLink {
  fromPath: string;
  link: WikiLink;
  resolution: LinkResolution;
}

/**
 * Resolve every outbound link of every note in a vault. Used to build the link index that
 * backlinks (D5) and the graph builder consume. Deterministic (input order preserved).
 */
export function buildLinkIndex(notes: ParsedNote[], vaultId: VaultId): ResolvedLink[] {
  const refs: NoteRef[] = notes.map((n) => ({ relPath: n.relPath, title: n.title }));
  const out: ResolvedLink[] = [];
  for (const note of notes) {
    for (const link of note.links) {
      out.push({
        fromPath: note.relPath,
        link,
        resolution: resolveLink(link.targetTitle, refs, vaultId),
      });
    }
  }
  return out;
}
