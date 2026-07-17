// tests/state/vaultStoreAiStatus.test.ts — R-1: the vaultStore aggregators the ⚡ AI status
// panel reads (`aiVaultStatuses`, `activeNoteAiStatus`, `retryAiVault`), exercised through a REAL
// vault open. The whole Tauri boundary is one mocked `invoke` dispatcher: filesystem commands go
// to the node storage backend (temp-dir vault), the embedding commands to an in-memory store, and
// `sidecar_capabilities` reports a fixed unavailable reason — so the test can assert that the
// panel's data path carries that reason VERBATIM from the backend to the per-note answer.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { cleanup, externalWrite, makeTempVault, nodeStorage } from '../helpers/nodeStorage';

const MODEL = 'intfloat/multilingual-e5-small';
const SIDECAR_REASON = 'sidecar offline (test)';

const storage = nodeStorage();
const appSupportDir = path.join(
  os.tmpdir(),
  `denote-appsupport-${process.pid}-${Math.random().toString(36).slice(2)}`,
);
const embedRows = new Map<string, { contentHash: string; vector: number[] }>();

async function tauriInvoke(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  const a = args as {
    root: string; relPath: string; content: string; from: string; to: string;
    texts: string[]; entries: { relPath: string; contentHash: string; vector: number[] }[];
  };
  switch (cmd) {
    case 'register_vault_root': return undefined;
    case 'list_vault_files': return storage.listVaultFiles(a.root);
    case 'list_dir': return storage.listDir(a.root, a.relPath);
    case 'read_note': return storage.readNote(a.root, a.relPath);
    case 'write_note': return storage.writeNote(a.root, a.relPath, a.content);
    case 'create_dir': return storage.createDir(a.root, a.relPath);
    case 'delete_path': return storage.deletePath(a.root, a.relPath);
    case 'rename_path': return storage.renamePath(a.root, a.from, a.to);
    case 'stat_path': return storage.stat(a.root, a.relPath);
    case 'path_exists': return storage.exists(a.root, a.relPath);
    case 'watch_vault':
    case 'unwatch_vault': return undefined;
    case 'app_support_dir':
      await fs.mkdir(appSupportDir, { recursive: true });
      return appSupportDir;
    case 'git_history_status': return { enabled: false };
    case 'keychain_has': return false;
    case 'sidecar_capabilities':
      return {
        available: false,
        spawned: false,
        reason: SIDECAR_REASON,
        maxInputTokens: 0,
        supportsGuidedJson: false,
      };
    case 'embed_texts':
      return { model: MODEL, dim: 4, vectors: a.texts.map(() => [1, 0, 0, 0]) };
    case 'embeddings_index': {
      const rows = [...embedRows.entries()].map(([relPath, v], i) => ({
        row: i,
        relPath,
        contentHash: v.contentHash,
      }));
      return { version: 1, model: rows.length ? MODEL : '', dim: 4, rows, free: [] };
    }
    case 'embeddings_put':
      for (const e of a.entries) embedRows.set(e.relPath, { contentHash: e.contentHash, vector: e.vector });
      return undefined;
    case 'embeddings_remove':
      embedRows.delete(a.relPath);
      return undefined;
    case 'embeddings_topk':
    case 'embeddings_topk_vector':
    case 'embeddings_vectors': return [];
    case 'embedding_model_status': return { status: 'not-downloaded', modelId: MODEL };
    default: throw new Error(`unmocked tauri command in test: ${cmd}`);
  }
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => tauriInvoke(cmd, args ?? {}),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: async () => () => {},
}));

type VaultStoreModule = typeof import('../../src/state/vaultStore');
let vaultStore: VaultStoreModule;
let root: string;

beforeAll(async () => {
  // uiStore/graphStore read localStorage + document at import time (browser-only); stub the
  // boundary and test the real store — same approach as setActiveNoteReveal.test.ts.
  const backing = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  };
  (globalThis as Record<string, unknown>).document = {
    documentElement: {
      setAttribute: () => {},
      removeAttribute: () => {},
      style: { setProperty: () => {}, removeProperty: () => {} },
    },
  };
  root = await makeTempVault();
  await externalWrite(root, 'a.md', '# Alpha\nBanking policy notes.\n');
  vaultStore = await import('../../src/state/vaultStore');
});

afterAll(async () => {
  const state = vaultStore.useVaultStore.getState();
  for (const id of [...state.openVaultIds]) await state.closeVault(id);
  await cleanup(root);
  await fs.rm(appSupportDir, { recursive: true, force: true });
});

describe('vaultStore — R-1 AI status aggregators', () => {
  it('reports no vaults and no active note before anything is open', () => {
    expect(vaultStore.useVaultStore.getState().aiVaultStatuses()).toEqual([]);
    expect(vaultStore.useVaultStore.getState().activeNoteAiStatus()).toBeNull();
  });

  it('aggregates queue, embedding, and per-note diagnostics for an open vault; retry wakes parked work', async () => {
    const store = vaultStore.useVaultStore;
    await store.getState().openVaultAt(root);
    const vaultId = store.getState().vaultId!;

    // Background work: the pump parks the seeded job against the unavailable sidecar; the
    // embedding engine syncs through the mocked Rust backend. Both run on real timers → poll.
    await vi.waitFor(() => {
      const [status] = store.getState().aiVaultStatuses();
      expect(status).toBeTruthy();
      expect(status.queue.counts.parked).toBeGreaterThan(0);
      expect(status.embedding.state).toBe('ready');
    }, { timeout: 8000 });

    const [status] = store.getState().aiVaultStatuses();
    expect(status.vaultId).toBe(vaultId);
    expect(status.embedding.model).toBe(MODEL);
    expect(
      status.queue.jobs.some(
        (job) => job.relPath === 'a.md' && job.state === 'parked' && job.lastError === SIDECAR_REASON,
      ),
    ).toBe(true);

    await store.getState().setActiveNote('a.md');
    const note = store.getState().activeNoteAiStatus();
    expect(note).toMatchObject({ relPath: 'a.md', title: 'Alpha', embedding: 'ready' });
    expect(note!.enrichment).toMatchObject({
      enrichmentState: 'parked',
      error: SIDECAR_REASON, // the verbatim backend reason, end to end
    });
    // Similarity labelling never ran (sidecar down) → no fabricated candidate list.
    expect(note!.similarity).toEqual([]);

    // retryAiVault wakes the parked queue synchronously and bumps the UI revision.
    const revisionBefore = store.getState().revision;
    store.getState().retryAiVault(vaultId);
    expect(store.getState().revision).toBeGreaterThan(revisionBefore);
    const [after] = store.getState().aiVaultStatuses();
    expect(after.queue.counts.parked).toBe(0);
    expect(after.queue.counts.pending).toBeGreaterThan(0);
    expect(store.getState().activeNoteAiStatus()!.enrichment.enrichmentState).toBe('queued');
  }, 20000);
});
