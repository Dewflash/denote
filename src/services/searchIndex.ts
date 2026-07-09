// src/services/searchIndex.ts — full-text search over one vault (D15: MiniSearch, ONE instance
// per open vault — dropped on close, never a single global index). Boosted fields: title >
// headings > tags > body (pass-05 brief). Search indexes both user and provisional (`ai:`)
// tags (S26) so takeover-applied tags are findable too.
//
// This module owns the MiniSearch wrapper + pure query-string parsing (`tag:`/`folder:`/
// `vault:`/`has:ghosts`) + snippet building. Combining results across multiple open vaults (the
// `vault:` filter needs the registry's name↔id mapping) is orchestration and lives in the
// search UI (features/search/SearchPanel.tsx), which owns one NoteSearchIndex per open vault.

import MiniSearch from 'minisearch';
import type { ParsedNote } from '../domain';

export interface SearchDoc {
  id: string; // relPath
  title: string;
  headings: string;
  tags: string; // space-joined (tag grammar, S3, never contains whitespace)
  body: string;
  folder: string;
  hasGhost: boolean;
}

export interface SearchHit {
  relPath: string;
  title: string;
  folder: string;
  tags: string[];
  score: number;
  snippet: string;
}

export interface SearchFilters {
  tag?: string;
  folder?: string;
  hasGhosts?: boolean;
}

const INDEXED_FIELDS = ['title', 'headings', 'tags', 'body'];
const STORED_FIELDS = ['title', 'body', 'tags', 'folder', 'hasGhost'];
// title > headings > tags > body (pass-05 brief boost order).
const FIELD_BOOST = { title: 8, headings: 4, tags: 3, body: 1 };

function folderOf(relPath: string): string {
  const i = relPath.lastIndexOf('/');
  return i === -1 ? '' : relPath.slice(0, i);
}

/** Build the indexable doc for a note. `hasGhost` is computed by the caller from the vault's
 *  link index (a note-level "does any outbound link fail to resolve" flag for `has:ghosts`). */
export function docFromNote(note: ParsedNote, hasGhost: boolean): SearchDoc {
  const provisionalTags = note.aiFrontmatter?.tags ?? [];
  return {
    id: note.relPath,
    title: note.title,
    headings: note.headings.map((h) => h.text).join(' '),
    tags: [...note.tags, ...provisionalTags].join(' '),
    body: note.bodyText,
    folder: folderOf(note.relPath),
    hasGhost,
  };
}

function buildSnippet(body: string, title: string, matchedTerms: string[], radius = 60): string {
  const source = body.trim() !== '' ? body : title;
  if (source === '') return '';
  const lower = source.toLowerCase();
  let idx = -1;
  for (const term of matchedTerms) {
    const found = lower.indexOf(term.toLowerCase());
    if (found !== -1 && (idx === -1 || found < idx)) idx = found;
  }
  if (idx === -1) {
    return source.length > radius * 2 ? `${source.slice(0, radius * 2).trim()}…` : source;
  }
  const start = Math.max(0, idx - radius);
  const end = Math.min(source.length, idx + radius);
  return `${start > 0 ? '…' : ''}${source.slice(start, end).trim()}${end < source.length ? '…' : ''}`;
}

/** One MiniSearch instance per vault (D15 pitfall: never one global index across vaults). */
export class NoteSearchIndex {
  private mini = new MiniSearch<SearchDoc>({
    idField: 'id',
    fields: INDEXED_FIELDS,
    storeFields: STORED_FIELDS,
    searchOptions: { boost: FIELD_BOOST, prefix: true, fuzzy: 0.2 },
  });

  /** Full rebuild (vault open / owner-triggered reindex). Chunked + async (MiniSearch's own
   *  `addAllAsync`) per the pass-05 brief's pitfall: rebuild-on-load must not block the UI on a
   *  large vault. Incremental `upsert`/`remove` stay synchronous — a single document is cheap. */
  async rebuild(docs: readonly SearchDoc[]): Promise<void> {
    this.mini.removeAll();
    await this.mini.addAllAsync(docs);
  }

  /** Incremental add/update (note created/saved/externally edited). */
  upsert(doc: SearchDoc): void {
    if (this.mini.has(doc.id)) this.mini.discard(doc.id);
    this.mini.add(doc);
  }

  /** Incremental remove (note deleted, or the "old" side of a rename/move). */
  remove(relPath: string): void {
    if (this.mini.has(relPath)) this.mini.discard(relPath);
  }

  has(relPath: string): boolean {
    return this.mini.has(relPath);
  }

  get size(): number {
    return this.mini.documentCount;
  }

  /** Free-text search (empty text ⇒ MiniSearch.wildcard, so a filter-only query like `tag:x`
   *  still returns every matching note) with the already-parsed structured filters applied. */
  search(text: string, filters: SearchFilters = {}, limit = 50): SearchHit[] {
    const query = text.trim() === '' ? MiniSearch.wildcard : text;
    const results = this.mini.search(query, {
      filter: (r) => {
        if (filters.tag) {
          const tags = String(r.tags).toLowerCase().split(/\s+/).filter(Boolean);
          if (!tags.includes(filters.tag.toLowerCase())) return false;
        }
        if (filters.folder !== undefined) {
          const folder = String(r.folder);
          if (folder !== filters.folder && !folder.startsWith(`${filters.folder}/`)) return false;
        }
        if (filters.hasGhosts && !r.hasGhost) return false;
        return true;
      },
    });
    return results.slice(0, limit).map((r) => ({
      relPath: String(r.id),
      title: String(r.title),
      folder: String(r.folder),
      tags: String(r.tags).split(/\s+/).filter(Boolean),
      score: r.score,
      snippet: buildSnippet(String(r.body), String(r.title), Object.keys(r.match)),
    }));
  }
}

// ── query-string parsing (pure) ─────────────────────────────────────────────────

export interface ParsedSearchQuery {
  text: string;
  tag?: string;
  folder?: string;
  vault?: string;
  hasGhosts: boolean;
}

const FILTER_TOKEN_RE = /(^|\s)(tag|folder|vault|has):(\S+)/gi;

/** Extracts `tag:x`, `folder:x`, `vault:x`, `has:ghosts` tokens from a raw query string; the
 *  remainder (whitespace-collapsed) is the free-text search term. */
export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const out: ParsedSearchQuery = { text: '', hasGhosts: false };
  const remainder = raw.replace(FILTER_TOKEN_RE, (_match, _pre: string, key: string, value: string) => {
    const k = key.toLowerCase();
    if (k === 'tag') out.tag = value.toLowerCase();
    else if (k === 'folder') out.folder = value.replace(/\/+$/, '');
    else if (k === 'vault') out.vault = value;
    else if (k === 'has' && value.toLowerCase() === 'ghosts') out.hasGhosts = true;
    return ' ';
  });
  out.text = remainder.replace(/\s+/g, ' ').trim();
  return out;
}
