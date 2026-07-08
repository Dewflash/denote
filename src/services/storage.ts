// src/services/storage.ts — the storage contract (a thin typed bridge over the Rust fs
// commands). The Repository depends only on this interface, so it can be driven by the real
// Tauri backend in the app and by a plain node:fs backend in integration tests.
//
// Containment (S22) is enforced in Rust: every command canonicalizes its path and verifies
// it is inside a registered vault root. This TS layer carries no security guarantees of its
// own — it is the transport shape only.

/** Result of stat()-ing a vault-relative path. */
export interface FileStat {
  mtime: number; // epoch ms
  size: number; // bytes
}

/** A single entry from a vault listing. Assets (non-`.md`) are indexed by path only (S26). */
export interface DirEntry {
  relPath: string; // vault-relative, forward slashes, NFC (S6)
  isDir: boolean;
  isMarkdown: boolean;
  mtime: number;
  size: number;
}

export type WatcherEventKind = 'create' | 'modify' | 'delete';

/** A raw filesystem event as delivered by the Rust watcher (already ignore-filtered, S22). */
export interface RawWatcherEvent {
  relPath: string;
  kind: WatcherEventKind;
}

/**
 * The full storage surface the Repository needs. All paths are vault-relative; `root` is the
 * absolute vault directory. Every write is atomic (tmp file + rename, S7) on the backend side.
 */
export interface StorageBackend {
  /** Register a vault root so its file commands pass the Rust containment check (S22). */
  registerVaultRoot(root: string): Promise<void>;
  /** Recursive listing of the vault, excluding the ignore set (`.denote/`, `.git/`, dotfiles). */
  listVaultFiles(root: string): Promise<DirEntry[]>;
  /** Non-recursive listing of one directory (used for `.denote/` stores + snapshot dirs). */
  listDir(root: string, relPath: string): Promise<DirEntry[]>;
  readNote(root: string, relPath: string): Promise<string>;
  writeNote(root: string, relPath: string, content: string): Promise<void>;
  createDir(root: string, relPath: string): Promise<void>;
  deletePath(root: string, relPath: string): Promise<void>;
  renamePath(root: string, from: string, to: string): Promise<void>;
  stat(root: string, relPath: string): Promise<FileStat | null>;
  exists(root: string, relPath: string): Promise<boolean>;
}

/** The shared ignore set (S22): dotfiles/dot-dirs anywhere in the path (covers `.denote/`,
 *  `.git/`). Rust drops these before they reach the frontend; mirrored here as defense in
 *  depth for backends and event handling. */
export function isIgnoredPath(relPath: string): boolean {
  return relPath.split('/').some((seg) => seg.startsWith('.'));
}
