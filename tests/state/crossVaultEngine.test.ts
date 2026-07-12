// Cross-vault ai-similar engine (S24): the two-gate pipeline (D6a) across vaults, D18 exclusion.
import { describe, expect, it, vi } from 'vitest';
import { CrossVaultEngine, type CrossVaultRef } from '../../src/state/crossVaultEngine';
import { CrossVaultStore } from '../../src/services/crossVaultStore';
import { AiRouter, APPLE_ROUTING } from '../../src/services/aiClient/router';
import { MockAiClient } from '../../src/services/aiClient/mock';
import type { EmbeddingsBackend, EmbeddingNeighbor } from '../../src/services/embeddings';
import { memIO } from '../helpers/memIO';

// Route label-similarity to the deterministic mock (local, always allowed).
const router = new AiRouter([new MockAiClient()], { ...APPLE_ROUTING, 'label-similarity': 'mock' });

/** A backend where every note has the same vector and topKVector returns the other vault's note. */
function backend(neighborRel: string): EmbeddingsBackend {
  const stub = vi.fn();
  return {
    embed: stub as never,
    index: stub as never,
    put: stub as never,
    remove: stub as never,
    remap: stub as never,
    topK: stub as never,
    vectors: vi.fn(async (_root, rels) => rels.map((relPath) => ({ relPath, vector: [1, 0, 0] }))),
    topKVector: vi.fn(async (): Promise<EmbeddingNeighbor[]> => [{ relPath: neighborRel, cos: 0.9 }]),
  };
}

function ref(vaultId: string, localOnly: boolean, rel: string, title: string, summary?: string): CrossVaultRef {
  return {
    vaultId,
    root: `/tmp/${vaultId}`,
    localOnly,
    notePaths: () => [rel],
    getHash: () => `hash-${rel}`,
    stub: () => ({ relPath: rel, title, summary: summary ?? `${title} discusses central-bank policy` }),
  };
}

describe('CrossVaultEngine (S24)', () => {
  it('creates a cross-vault edge when the LLM names a shared concept (D6a two-gate)', async () => {
    const store = new CrossVaultStore(memIO());
    await store.load();
    const engine = new CrossVaultEngine({
      backend: backend('b.md'),
      router,
      store,
      vaults: () => [ref('va', false, 'a.md', 'Bank of Japan'), ref('vb', false, 'b.md', 'Federal Reserve Banking')],
      disableTimers: true,
    });
    await engine.syncAll();
    const pairs = store.all();
    expect(pairs).toHaveLength(1);
    expect(pairs[0].aVaultId).not.toBe(pairs[0].bVaultId); // genuinely cross-vault
    expect(pairs[0].reason.length).toBeGreaterThanOrEqual(15); // passed the S15 vacuity gate
    // Renders only when both vaults are in the selected set.
    expect(engine.pairs(['va', 'vb'])).toHaveLength(1);
    expect(engine.pairs(['va'])).toHaveLength(0);
  });

  it('records a rejection (no shared concept) and never re-asks at the same hashes', async () => {
    const store = new CrossVaultStore(memIO());
    await store.load();
    const engine = new CrossVaultEngine({
      backend: backend('b.md'),
      router,
      store,
      // No shared concept (a soup recipe vs a banking note) → MockAiClient returns related:false.
      vaults: () => [
        ref('va', false, 'a.md', 'Miso Soup Recipe', 'a broth recipe with tofu and miso paste'),
        ref('vb', false, 'b.md', 'Federal Reserve Banking', 'central-bank interest rate policy'),
      ],
      disableTimers: true,
    });
    await engine.syncAll();
    expect(store.all()).toHaveLength(0);
    expect(store.isRejectedFresh({ vaultId: 'va', relPath: 'a.md' }, 'hash-a.md', { vaultId: 'vb', relPath: 'b.md' }, 'hash-b.md')).toBe(true);
  });

  it('does nothing when fewer than two non-localOnly vaults are open (D18)', async () => {
    const store = new CrossVaultStore(memIO());
    await store.load();
    const b = backend('b.md');
    const engine = new CrossVaultEngine({
      backend: b,
      router,
      store,
      // One vault is local-only → only one eligible vault → no cross-vault work at all.
      vaults: () => [ref('va', false, 'a.md', 'Bank of Japan'), ref('vb', true, 'b.md', 'Federal Reserve Banking')],
      disableTimers: true,
    });
    await engine.syncAll();
    expect(store.all()).toHaveLength(0);
    expect(b.topKVector).not.toHaveBeenCalled(); // never even queried the local-only vault
  });
});
