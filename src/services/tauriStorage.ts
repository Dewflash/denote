// src/services/tauriStorage.ts — the production StorageBackend: a thin bridge that invokes
// the Rust fs commands (src-tauri/src/fs_commands.rs). Kept in its own module so that node
// integration tests can depend on `storage.ts` (the interface) without importing any
// `@tauri-apps/*` runtime.

import { invoke } from '@tauri-apps/api/core';
import type { DirEntry, FileStat, StorageBackend } from './storage';

export const tauriStorage: StorageBackend = {
  registerVaultRoot: (root) => invoke('register_vault_root', { root }),
  listVaultFiles: (root) => invoke<DirEntry[]>('list_vault_files', { root }),
  listDir: (root, relPath) => invoke<DirEntry[]>('list_dir', { root, relPath }),
  readNote: (root, relPath) => invoke<string>('read_note', { root, relPath }),
  writeNote: (root, relPath, content) => invoke('write_note', { root, relPath, content }),
  createDir: (root, relPath) => invoke('create_dir', { root, relPath }),
  deletePath: (root, relPath) => invoke('delete_path', { root, relPath }),
  renamePath: (root, from, to) => invoke('rename_path', { root, from, to }),
  stat: (root, relPath) => invoke<FileStat | null>('stat_path', { root, relPath }),
  exists: (root, relPath) => invoke<boolean>('path_exists', { root, relPath }),
};
