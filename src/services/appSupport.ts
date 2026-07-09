// src/services/appSupport.ts — resolves + registers the OS app-support directory (D17/S24/S26
// home of `vaults.json`, and future `settings.json`/`crossvault.json`) as a StorageBackend root.
// A "separate, equally-guarded command" per S22 resolves the path; the actual reads/writes reuse
// the same `register_vault_root`/`read_note`/`write_note` containment boundary as any vault
// (services/storage.ts, tauriStorage.ts) — there is still no generic file-access escape hatch.

import { invoke } from '@tauri-apps/api/core';
import { tauriStorage } from './tauriStorage';

let cachedRoot: Promise<string> | null = null;

/** Resolves (and mkdir's, and registers as a containment root) the app-support directory.
 *  Cached for the process lifetime — the directory can't move while the app is running. */
export function appSupportRoot(): Promise<string> {
  if (!cachedRoot) {
    cachedRoot = invoke<string>('app_support_dir').then(async (dir) => {
      await tauriStorage.registerVaultRoot(dir);
      return dir;
    });
  }
  return cachedRoot;
}
