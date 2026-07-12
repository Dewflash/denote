// src/services/appSupportStore.ts — the guarded JSON IO surface for app-support-level stores
// (spend ledger S27, batch durability S27, cross-vault ai-similar S24). Same shape as the
// `.denote/` InternalStoreIO the vault stores use, so every store is testable with an in-memory
// IO (no Tauri) and production wires it to `tauriStorage` against `appSupportRoot()` — which is
// an S22-contained root, so there is still no generic file-access escape hatch.

import type { StorageBackend } from './storage';

export interface AppSupportIO {
  read(name: string): Promise<string | null>;
  write(name: string, content: string): Promise<void>;
  list?(prefix: string): Promise<{ name: string; isDir: boolean }[]>;
  delete?(name: string): Promise<void>;
}

/** Adapt a StorageBackend + resolved app-support root into the AppSupportIO the stores consume. */
export function createAppSupportIO(backend: StorageBackend, appRoot: string): AppSupportIO {
  return {
    async read(name) {
      if (!(await backend.exists(appRoot, name))) return null;
      try {
        return await backend.readNote(appRoot, name);
      } catch {
        return null;
      }
    },
    write: (name, content) => backend.writeNote(appRoot, name, content),
    async list(prefix) {
      const entries = await backend.listDir(appRoot, prefix);
      return entries.map((e) => ({
        name: e.relPath,
        isDir: e.isDir,
      }));
    },
    delete: (name) => backend.deletePath(appRoot, name),
  };
}
