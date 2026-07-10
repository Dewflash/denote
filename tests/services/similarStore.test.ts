// SimilarStore tests (S15 ownership, freshness, rejection memory, D4a remap) — in-memory IO.
import { describe, expect, it } from 'vitest';
import { SimilarStore } from '../../src/services/similarStore';
import type { InternalStoreIO } from '../../src/services/annotationStore';

function memIo(): InternalStoreIO & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    read: async (p) => files.get(p) ?? null,
    write: async (p, c) => void files.set(p, c),
  };
}

describe('SimilarStore (S15)', () => {
  it('stores an accepted pair owned by the smaller relPath', async () => {
    const store = new SimilarStore(memIo());
    await store.load();
    await store.upsertAccepted('z.md', 'hz', 'a.md', 'ha', 'Both cover BOJ policy.', 0.82);
    const [p] = store.all();
    expect(p.owner).toBe('a.md');
    expect(p.other).toBe('z.md');
    expect(p.ownerHash).toBe('ha');
    expect(p.otherHash).toBe('hz');
    expect(store.hasFresh('a.md', 'ha', 'z.md', 'hz')).toBe(true);
    expect(store.hasFresh('a.md', 'ha2', 'z.md', 'hz')).toBe(false); // hash changed → stale
  });

  it('dedupes: one edge per pair regardless of endpoint order', async () => {
    const store = new SimilarStore(memIo());
    await store.load();
    await store.upsertAccepted('a.md', 'ha', 'b.md', 'hb', 'r1', 0.8);
    await store.upsertAccepted('b.md', 'hb', 'a.md', 'ha', 'r2', 0.9); // same pair, other order
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0].reason).toBe('r2'); // refreshed in place
  });

  it('remembers rejected pairs at their hashes; a content edit clears the freshness', async () => {
    const store = new SimilarStore(memIo());
    await store.load();
    const a = { vaultId: 'v', relPath: 'a.md' };
    const b = { vaultId: 'v', relPath: 'b.md' };
    await store.recordRejected(a, 'ha', b, 'hb');
    expect(store.isRejectedFresh(a, 'ha', b, 'hb')).toBe(true);
    expect(store.isRejectedFresh(b, 'hb', a, 'ha')).toBe(true); // symmetric
    expect(store.isRejectedFresh(a, 'ha2', b, 'hb')).toBe(false); // edited → re-askable
  });

  it('drops pairs touching a deleted note', async () => {
    const store = new SimilarStore(memIo());
    await store.load();
    await store.upsertAccepted('a.md', 'ha', 'b.md', 'hb', 'r', 0.8);
    await store.removeForPath('b.md');
    expect(store.all()).toHaveLength(0);
  });

  it('remaps a moved path and re-normalizes ownership (D4a)', async () => {
    const store = new SimilarStore(memIo());
    await store.load();
    await store.upsertAccepted('a.md', 'ha', 'm.md', 'hm', 'r', 0.8); // owner a.md
    await store.remapPath('a.md', 'zzz.md'); // now owner should flip to m.md
    const [p] = store.all();
    expect(p.owner).toBe('m.md');
    expect(p.other).toBe('zzz.md');
  });

  it('persists and reloads', async () => {
    const io = memIo();
    const store = new SimilarStore(io);
    await store.load();
    await store.upsertAccepted('a.md', 'ha', 'b.md', 'hb', 'shared concept named clearly', 0.8);
    const reloaded = new SimilarStore(io);
    await reloaded.load();
    expect(reloaded.all()).toHaveLength(1);
  });
});
