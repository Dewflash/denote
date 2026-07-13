import type { ParsedNote } from '../domain/types';
import type { ResolvedLink } from '../domain/links';

export interface OrphanNote {
  relPath: string;
  title: string;
}

export interface UnresolvedLink {
  fromPath: string;
  target: string;
  id: string;
}

export interface GraphHealth {
  orphans: OrphanNote[];
  unresolvedLinks: UnresolvedLink[];
}

/** Derive the status-bar affordances from the same live link index the graph uses. */
export function deriveGraphHealth(
  notes: readonly ParsedNote[],
  links: readonly ResolvedLink[],
): GraphHealth {
  const outbound = new Set(links.map((link) => link.fromPath));
  const inbound = new Set(
    links
      .filter((link) => link.resolution.kind === 'note')
      .map((link) => (link.resolution.kind === 'note' ? link.resolution.relPath : '')),
  );
  const orphans = notes
    .filter((note) => !inbound.has(note.relPath) && !outbound.has(note.relPath))
    .map((note) => ({ relPath: note.relPath, title: note.title }))
    .sort((a, b) => a.title.localeCompare(b.title) || a.relPath.localeCompare(b.relPath));
  const unresolvedLinks = links
    .filter((link) => link.resolution.kind === 'ghost')
    .map((link) => ({
      fromPath: link.fromPath,
      target: link.link.targetTitle,
      id: `${link.fromPath}:${link.link.offsetStart}:${link.link.offsetEnd}`,
    }))
    .sort((a, b) => a.target.localeCompare(b.target) || a.fromPath.localeCompare(b.fromPath));
  return { orphans, unresolvedLinks };
}
