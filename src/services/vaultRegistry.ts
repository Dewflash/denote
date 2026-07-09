// src/services/vaultRegistry.ts — the multi-vault registry (D17/D18): id, name, path, color,
// localOnly, persisted as `vaults.json` in the app-support directory (S26: versioned). Pure
// CRUD + (de)serialization here; the glue functions accept a StorageBackend + root so this is
// testable with the same node:fs backend the Repository integration tests use (no Tauri
// runtime required) — production wiring (state/vaultStore.ts) supplies `tauriStorage` +
// `appSupportRoot()`.

import type { StorageBackend } from './storage';

export interface VaultRegistryEntry {
  id: string; // vaultId (uuid, from .denote/meta.json) — the join key with the open Repository
  name: string;
  path: string;
  color: string;
  localOnly: boolean; // D18: enforced at the AiClient router in pass 6+; persisted now
}

export interface VaultsFile {
  version: 1;
  vaults: VaultRegistryEntry[];
}

export const EMPTY_VAULTS_FILE: VaultsFile = { version: 1, vaults: [] };

const VAULTS_FILE_NAME = 'vaults.json';

function isValidEntry(v: unknown): v is VaultRegistryEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.name === 'string' &&
    typeof e.path === 'string' &&
    typeof e.color === 'string' &&
    typeof e.localOnly === 'boolean'
  );
}

/** Parse `vaults.json` text. Malformed/corrupt content never throws — falls back to empty
 *  (a corrupt registry should not block the app from opening any vault at all). */
export function parseVaultsFile(raw: string): VaultsFile {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_VAULTS_FILE;
    const vaults = (parsed as { vaults?: unknown }).vaults;
    if (!Array.isArray(vaults)) return EMPTY_VAULTS_FILE;
    return { version: 1, vaults: vaults.filter(isValidEntry) };
  } catch {
    return EMPTY_VAULTS_FILE;
  }
}

export function serializeVaultsFile(file: VaultsFile): string {
  return JSON.stringify(file, null, 2) + '\n';
}

/** Insert or replace an entry by id, preserving existing order (new entries append). */
export function upsertVault(file: VaultsFile, entry: VaultRegistryEntry): VaultsFile {
  const idx = file.vaults.findIndex((v) => v.id === entry.id);
  if (idx === -1) return { version: 1, vaults: [...file.vaults, entry] };
  const vaults = [...file.vaults];
  vaults[idx] = entry;
  return { version: 1, vaults };
}

export function removeVaultEntry(file: VaultsFile, id: string): VaultsFile {
  return { version: 1, vaults: file.vaults.filter((v) => v.id !== id) };
}

// ── glue (I/O) ────────────────────────────────────────────────────────────────

export async function loadVaultsFile(backend: StorageBackend, appRoot: string): Promise<VaultsFile> {
  if (!(await backend.exists(appRoot, VAULTS_FILE_NAME))) return EMPTY_VAULTS_FILE;
  try {
    return parseVaultsFile(await backend.readNote(appRoot, VAULTS_FILE_NAME));
  } catch {
    return EMPTY_VAULTS_FILE;
  }
}

export async function saveVaultsFile(
  backend: StorageBackend,
  appRoot: string,
  file: VaultsFile,
): Promise<void> {
  await backend.writeNote(appRoot, VAULTS_FILE_NAME, serializeVaultsFile(file));
}

/** Deterministic-ish palette rotation for a newly-added vault's default color (distinct from
 *  the fnv1a hash the graph uses for hull/topic coloring — this only needs to look sensible in
 *  a rail of a handful of icons, not be collision-proof). */
export const VAULT_COLOR_PALETTE = [
  '#3b6fd6',
  '#d6763b',
  '#3bd6a0',
  '#a03bd6',
  '#d63b6f',
  '#6f9bef',
  '#7bb87b',
  '#c9a227',
];

export function nextVaultColor(existing: readonly VaultRegistryEntry[]): string {
  return VAULT_COLOR_PALETTE[existing.length % VAULT_COLOR_PALETTE.length];
}
