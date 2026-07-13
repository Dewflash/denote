// src/state/vaultIndex.ts — the live, in-memory derived index for one vault. Everything here
// is a rebuildable cache over the files on disk (tier 2, D3); the `.md` bytes remain the sole
// source of truth. Backlinks are NEVER stored — they are recomputed from the link index on
// every change (D5).

import type { ParsedNote, VaultId } from '../domain/types';
import { buildLinkIndex, type ResolvedLink } from '../domain/links';
import { computeBacklinks, type Backlink } from '../domain/backlinks';
import type { FileStat } from '../services/storage';

export class VaultIndex {
  /** relPath → parsed note. Insertion order is preserved for deterministic derivation. */
  readonly notes = new Map<string, ParsedNote>();
  readonly hashes = new Map<string, string>();
  readonly mtimes = new Map<string, number>();
  /** First-seen creation time per note (S26 `created` fallback). Preserved across edits —
   *  set once, never overwritten by a later `setNote` unless the note is removed first (rename
   *  carries it over explicitly; see repository.ts `relocate`). */
  readonly btimes = new Map<string, number>();
  /** Non-`.md` files, indexed by path only (S26). */
  readonly assets = new Map<string, FileStat>();
  /** User-visible directories. Empty folders must survive reloads, unlike UI session state. */
  readonly folders = new Set<string>();

  private linkIndex: ResolvedLink[] = [];
  private backlinks = new Map<string, Backlink[]>();

  constructor(readonly vaultId: VaultId) {}

  /** Upsert a note. Pass `rebuild: false` during bulk load, then call rebuildDerived() once.
   *  `btime`, if given, seeds the creation time ONLY if this relPath has none recorded yet. */
  setNote(
    parsed: ParsedNote,
    hash: string,
    mtime: number,
    opts: { rebuild?: boolean; btime?: number } = {},
  ): void {
    this.notes.set(parsed.relPath, parsed);
    this.hashes.set(parsed.relPath, hash);
    this.mtimes.set(parsed.relPath, mtime);
    if (!this.btimes.has(parsed.relPath)) {
      this.btimes.set(parsed.relPath, opts.btime ?? mtime);
    }
    if (opts.rebuild !== false) this.rebuildDerived();
  }

  removeNote(relPath: string, opts: { rebuild?: boolean } = {}): void {
    this.notes.delete(relPath);
    this.hashes.delete(relPath);
    this.mtimes.delete(relPath);
    this.btimes.delete(relPath);
    if (opts.rebuild !== false) this.rebuildDerived();
  }

  getBtime(relPath: string): number | undefined {
    return this.btimes.get(relPath);
  }

  setAsset(relPath: string, stat: FileStat): void {
    this.assets.set(relPath, stat);
  }

  removeAsset(relPath: string): void {
    this.assets.delete(relPath);
  }

  addFolder(relPath: string): void {
    const segments = relPath.split('/').filter(Boolean);
    let current = '';
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      this.folders.add(current);
    }
  }

  allFolders(): string[] {
    return [...this.folders].sort((a, b) => a.localeCompare(b));
  }

  /** Recompute the link index + backlinks from the current note set. O(total links). */
  rebuildDerived(): void {
    this.linkIndex = buildLinkIndex([...this.notes.values()], this.vaultId);
    this.backlinks = computeBacklinks(this.linkIndex);
  }

  getNote(relPath: string): ParsedNote | undefined {
    return this.notes.get(relPath);
  }

  getHash(relPath: string): string | undefined {
    return this.hashes.get(relPath);
  }

  allNotes(): ParsedNote[] {
    return [...this.notes.values()];
  }

  getLinkIndex(): readonly ResolvedLink[] {
    return this.linkIndex;
  }

  /** Inbound links (backlinks) for a note — computed, never stored (D5). */
  getBacklinks(relPath: string): Backlink[] {
    return this.backlinks.get(relPath) ?? [];
  }

  /** All resolved outbound links that currently resolve to `relPath` (used by refactors). */
  inboundResolved(relPath: string): ResolvedLink[] {
    return this.linkIndex.filter(
      (r) => r.resolution.kind === 'note' && r.resolution.relPath === relPath,
    );
  }
}
