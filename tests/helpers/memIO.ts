// tests/helpers/memIO.ts — an in-memory AppSupportIO for the app-support-level stores (spend
// ledger, batch durability, cross-vault). Lets the S27/S24 stores be unit-tested with no Tauri
// and no filesystem.

import type { AppSupportIO } from '../../src/services/appSupportStore';

export function memIO(): AppSupportIO & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async read(name) {
      return files.get(name) ?? null;
    },
    async write(name, content) {
      files.set(name, content);
    },
    async list(prefix) {
      return [...files.keys()]
        .filter((name) => name.startsWith(prefix))
        .map((name) => ({ name, isDir: false }));
    },
    async delete(name) {
      files.delete(name);
    },
  };
}
