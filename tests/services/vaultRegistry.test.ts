import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EMPTY_VAULTS_FILE,
  loadVaultsFile,
  nextVaultColor,
  parseVaultsFile,
  removeVaultEntry,
  saveVaultsFile,
  serializeVaultsFile,
  upsertVault,
  type VaultRegistryEntry,
} from '../../src/services/vaultRegistry';
import { cleanup, makeTempVault, nodeStorage } from '../helpers/nodeStorage';

const backend = nodeStorage();

function entry(over: Partial<VaultRegistryEntry> = {}): VaultRegistryEntry {
  return {
    id: 'v1',
    name: 'Personal',
    path: '/vaults/personal',
    color: '#3b6fd6',
    localOnly: false,
    ...over,
  };
}

describe('vaults.json parsing (pure)', () => {
  it('parses a well-formed file', () => {
    const raw = serializeVaultsFile({ version: 1, vaults: [entry()] });
    expect(parseVaultsFile(raw)).toEqual({ version: 1, vaults: [entry()] });
  });

  it('malformed JSON falls back to empty rather than throwing', () => {
    expect(parseVaultsFile('not json{')).toEqual(EMPTY_VAULTS_FILE);
  });

  it('a non-array vaults field falls back to empty', () => {
    expect(parseVaultsFile(JSON.stringify({ version: 1, vaults: 'nope' }))).toEqual(EMPTY_VAULTS_FILE);
  });

  it('drops individually malformed entries but keeps valid ones', () => {
    const raw = JSON.stringify({ version: 1, vaults: [entry({ id: 'ok' }), { id: 'bad' }] });
    expect(parseVaultsFile(raw).vaults.map((v) => v.id)).toEqual(['ok']);
  });
});

describe('upsertVault / removeVaultEntry (pure CRUD)', () => {
  it('appends a new entry', () => {
    const file = upsertVault(EMPTY_VAULTS_FILE, entry());
    expect(file.vaults).toEqual([entry()]);
  });

  it('replaces an existing entry in place (order preserved)', () => {
    let file = upsertVault(EMPTY_VAULTS_FILE, entry({ id: 'a', name: 'A' }));
    file = upsertVault(file, entry({ id: 'b', name: 'B' }));
    file = upsertVault(file, entry({ id: 'a', name: 'A renamed', color: '#fff' }));
    expect(file.vaults.map((v) => v.id)).toEqual(['a', 'b']);
    expect(file.vaults[0].name).toBe('A renamed');
  });

  it('removeVaultEntry drops by id', () => {
    let file = upsertVault(EMPTY_VAULTS_FILE, entry({ id: 'a' }));
    file = upsertVault(file, entry({ id: 'b' }));
    file = removeVaultEntry(file, 'a');
    expect(file.vaults.map((v) => v.id)).toEqual(['b']);
  });
});

describe('nextVaultColor', () => {
  it('rotates through the palette deterministically', () => {
    const c0 = nextVaultColor([]);
    const c1 = nextVaultColor([entry({ id: 'a' })]);
    expect(c0).not.toBe(c1);
  });
});

describe('load/saveVaultsFile (glue, temp-dir "app support" root)', () => {
  let appRoot: string;
  beforeEach(async () => {
    appRoot = await makeTempVault();
  });
  afterEach(async () => {
    await cleanup(appRoot);
  });

  it('loading a missing file returns empty', async () => {
    expect(await loadVaultsFile(backend, appRoot)).toEqual(EMPTY_VAULTS_FILE);
  });

  it('round-trips through save/load', async () => {
    const file = upsertVault(EMPTY_VAULTS_FILE, entry());
    await saveVaultsFile(backend, appRoot, file);
    expect(await loadVaultsFile(backend, appRoot)).toEqual(file);
  });

  it('a second save fully replaces the first (no merge)', async () => {
    await saveVaultsFile(backend, appRoot, upsertVault(EMPTY_VAULTS_FILE, entry({ id: 'a' })));
    await saveVaultsFile(backend, appRoot, upsertVault(EMPTY_VAULTS_FILE, entry({ id: 'b' })));
    const loaded = await loadVaultsFile(backend, appRoot);
    expect(loaded.vaults.map((v) => v.id)).toEqual(['b']);
  });
});
