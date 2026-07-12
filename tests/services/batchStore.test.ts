// Batch durability store (S27): persist a batch's id + manifest, list pending, mark terminal.
import { describe, expect, it } from 'vitest';
import { BatchStore, type PersistedBatch } from '../../src/services/batchStore';
import { memIO } from '../helpers/memIO';

const batch = (id: string): PersistedBatch => ({
  batchId: id,
  submittedAt: '2026-07-12T00:00:00Z',
  estimatedCostUsd: 1.5,
  model: 'claude-opus-4-8',
  status: 'submitted',
  manifest: [{ customId: 'note:v:a.md', kind: 'note', ref: 'a.md', vaultId: 'v' }],
});

describe('BatchStore (S27)', () => {
  it('persists a batch before polling and lists it as pending', async () => {
    const io = memIO();
    const store = new BatchStore(io);
    await store.load();
    await store.add(batch('bx'));
    expect(store.pending().map((b) => b.batchId)).toEqual(['bx']);

    // Survives a restart (S27: batches outlive the process).
    const reloaded = new BatchStore(io);
    await reloaded.load();
    expect(reloaded.get('bx')?.manifest[0].ref).toBe('a.md');
    expect(reloaded.pending()).toHaveLength(1);
  });

  it('a reconciled/expired batch is no longer pending', async () => {
    const io = memIO();
    const store = new BatchStore(io);
    await store.load();
    await store.add(batch('b1'));
    await store.add(batch('b2'));
    await store.setStatus('b1', 'reconciled');
    await store.setStatus('b2', 'expired');
    expect(store.pending()).toHaveLength(0);
  });
});
