// Cross-vault ai-similar store (S24/D36): pair identity, freshness, rejection memory, render gate.
import { describe, expect, it } from 'vitest';
import { CrossVaultStore } from '../../src/services/crossVaultStore';
import { memIO } from '../helpers/memIO';

const A = { vaultId: 'va', relPath: 'a.md' };
const B = { vaultId: 'vb', relPath: 'b.md' };

describe('CrossVaultStore (S24)', () => {
  it('stores a pair once regardless of query order and reports it fresh', async () => {
    const io = memIO();
    const store = new CrossVaultStore(io);
    await store.load();
    await store.upsertAccepted(A, 'ha', B, 'hb', 'Both cover reserve-currency policy.', 0.8);
    expect(store.all()).toHaveLength(1);
    // Same pair, reversed order + reversed hashes → still fresh (canonical ordering).
    expect(store.hasFresh(B, 'hb', A, 'ha')).toBe(true);
    // Re-upsert doesn't duplicate.
    await store.upsertAccepted(B, 'hb', A, 'ha', 'refined reason', 0.9);
    expect(store.all()).toHaveLength(1);
  });

  it('remembers a declined pair until a hash changes', async () => {
    const io = memIO();
    const store = new CrossVaultStore(io);
    await store.load();
    await store.recordRejected(A, 'ha', B, 'hb');
    expect(store.isRejectedFresh(A, 'ha', B, 'hb')).toBe(true);
    expect(store.isRejectedFresh(A, 'ha2', B, 'hb')).toBe(false); // content edited → fresh chance
  });

  it('only renders pairs whose BOTH endpoints are open', async () => {
    const io = memIO();
    const store = new CrossVaultStore(io);
    await store.load();
    await store.upsertAccepted(A, 'ha', B, 'hb', 'A concrete shared concept spanning vaults.', 0.75);
    expect(store.renderablePairs(new Set(['va', 'vb']))).toHaveLength(1);
    expect(store.renderablePairs(new Set(['va']))).toHaveLength(0); // vb closed → not rendered
  });

  it('drops a vault\'s edges when it leaves the registry (D36)', async () => {
    const io = memIO();
    const store = new CrossVaultStore(io);
    await store.load();
    await store.upsertAccepted(A, 'ha', B, 'hb', 'A concrete shared concept spanning vaults.', 0.75);
    await store.removeForVault('vb');
    expect(store.all()).toHaveLength(0);
  });
});
