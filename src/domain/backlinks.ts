// src/domain/backlinks.ts — backlinks are NEVER stored (D5); computed from the link index.
// PURE.

import type { WikiLink } from './types';
import type { ResolvedLink } from './links';

export interface Backlink {
  fromPath: string;
  link: WikiLink;
}

/**
 * Reverse the resolved link index into a map: target relPath → inbound links.
 * Only links that resolve to a real note produce backlinks (ghosts have no target note).
 * Deterministic: entries sorted by fromPath, then link offset.
 */
export function computeBacklinks(index: ResolvedLink[]): Map<string, Backlink[]> {
  const map = new Map<string, Backlink[]>();
  for (const entry of index) {
    if (entry.resolution.kind !== 'note') continue;
    const target = entry.resolution.relPath;
    const list = map.get(target) ?? [];
    list.push({ fromPath: entry.fromPath, link: entry.link });
    map.set(target, list);
  }
  for (const list of map.values()) {
    list.sort(
      (a, b) =>
        (a.fromPath < b.fromPath ? -1 : a.fromPath > b.fromPath ? 1 : 0) ||
        a.link.offsetStart - b.link.offsetStart,
    );
  }
  return map;
}
