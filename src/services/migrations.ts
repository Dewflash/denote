// src/services/migrations.ts — S26 pass-10 store version dispatch + corruption quarantine.

import type { AppSupportIO } from './appSupportStore';

export interface VersionedJson {
  version?: number;
  schemaVersion?: number;
  [key: string]: unknown;
}

export type Migration = (data: VersionedJson) => VersionedJson;

export interface MigrationRegistry {
  current: number;
  migrations: Record<number, Migration>;
}

export type MigrateResult = {
  ok: true;
  data: VersionedJson;
  migrated: boolean;
} | {
  ok: false;
  quarantinePath: string;
  error: string;
};

export const NOOP_V1_MIGRATION: MigrationRegistry = {
  current: 1,
  migrations: {
    1: (data) => ({ ...data, version: data.version ?? data.schemaVersion ?? 1 }),
  },
};

function storeVersion(data: VersionedJson): number {
  const v = data.version ?? data.schemaVersion;
  return typeof v === 'number' && Number.isInteger(v) ? v : 1;
}

export function migrateJson(data: VersionedJson, registry: MigrationRegistry = NOOP_V1_MIGRATION): { data: VersionedJson; migrated: boolean } {
  let version = storeVersion(data);
  let cur = { ...data };
  let migrated = false;
  while (version < registry.current) {
    const migration = registry.migrations[version];
    if (!migration) throw new Error(`no migration registered for v${version}`);
    cur = migration(cur);
    version = storeVersion(cur);
    migrated = true;
  }
  if (version > registry.current) throw new Error(`store version ${version} is newer than this app`);
  if (version === registry.current && cur.version !== registry.current && cur.schemaVersion !== registry.current) {
    cur.version = registry.current;
    migrated = true;
  }
  return { data: cur, migrated };
}

export async function loadMigratedJson(
  io: AppSupportIO,
  path: string,
  registry: MigrationRegistry = NOOP_V1_MIGRATION,
): Promise<MigrateResult | null> {
  const raw = await io.read(path);
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as VersionedJson;
    const result = migrateJson(parsed, registry);
    if (result.migrated) await io.write(path, JSON.stringify(result.data, null, 2) + '\n');
    return { ok: true, ...result };
  } catch (err) {
    const quarantinePath = `${path}.corrupt-${Date.now()}`;
    await io.write(quarantinePath, raw);
    if (io.delete) await io.delete(path);
    return { ok: false, quarantinePath, error: err instanceof Error ? err.message : String(err) };
  }
}
