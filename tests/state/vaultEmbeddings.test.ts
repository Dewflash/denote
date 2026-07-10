// Pass-07 integration: the embedding + ai-similar pipeline against a REAL temp-dir Repository,
// with a mock embeddings backend (in-memory store + topK) and the deterministic mock LLM. Proves
// the D6a two-gate flow (embedding proposes → LLM names a concept), S15 rejection memory, and
// S14 incremental re-embedding.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Repository } from '../../src/state/repository';
import { VaultEmbeddingEngine } from '../../src/state/vaultEmbeddings';
import { SimilarStore } from '../../src/services/similarStore';
import { AiRouter, DEFAULT_ROUTING, MockAiClient } from '../../src/services/aiClient';
import type {
  AiClient,
  LabelSimilarityRequest,
} from '../../src/services/aiClient';
import type {
  EmbeddingIndex,
  EmbeddingNeighbor,
  EmbeddingPutEntry,
  EmbeddingsBackend,
  EmbedResult,
} from '../../src/services/embeddings';
import { cleanup, makeTempVault, nodeStorage } from '../helpers/nodeStorage';

const MODEL = 'intfloat/multilingual-e5-small';

/** In-memory embeddings backend: stores what it's given and proposes every OTHER note as a
 *  neighbor (cos 0.7) so the LLM gate is what actually decides edges. Counts embed calls. */
class MockBackend implements EmbeddingsBackend {
  rows = new Map<string, { contentHash: string; vector: number[] }>();
  embedCalls: string[][] = [];

  async embed(texts: string[]): Promise<EmbedResult> {
    this.embedCalls.push(texts);
    return { model: MODEL, dim: 4, vectors: texts.map(() => [1, 0, 0, 0]) };
  }
  async index(): Promise<EmbeddingIndex> {
    const rows = [...this.rows.entries()].map(([relPath, v], i) => ({ row: i, relPath, contentHash: v.contentHash }));
    return { version: 1, model: rows.length ? MODEL : '', dim: 4, rows, free: [] };
  }
  async put(_root: string, _model: string, _dim: number, entries: EmbeddingPutEntry[]): Promise<void> {
    for (const e of entries) this.rows.set(e.relPath, { contentHash: e.contentHash, vector: e.vector });
  }
  async remove(_root: string, relPath: string): Promise<void> {
    this.rows.delete(relPath);
  }
  async remap(_root: string, from: string, to: string): Promise<void> {
    const v = this.rows.get(from);
    if (v) {
      this.rows.delete(from);
      this.rows.set(to, v);
    }
  }
  async topK(_root: string, relPath: string, k: number): Promise<EmbeddingNeighbor[]> {
    return [...this.rows.keys()]
      .filter((p) => p !== relPath)
      .slice(0, k)
      .map((p) => ({ relPath: p, cos: 0.7 }));
  }
}

class CountingLlm implements AiClient {
  readonly id = 'mock' as const;
  readonly modelId = 'mock@1';
  readonly isNetwork = false;
  labelCalls = 0;
  private inner = new MockAiClient();
  capabilities() {
    return this.inner.capabilities();
  }
  summarize(r: Parameters<AiClient['summarize']>[0]) {
    return this.inner.summarize(r);
  }
  enrichNote(r: Parameters<AiClient['enrichNote']>[0]) {
    return this.inner.enrichNote(r);
  }
  labelSimilarity(r: LabelSimilarityRequest) {
    this.labelCalls++;
    return this.inner.labelSimilarity(r);
  }
}

const backendStorage = nodeStorage();
let root: string;
beforeEach(async () => {
  root = await makeTempVault();
});
afterEach(async () => {
  await cleanup(root);
});

async function open(llm: AiClient) {
  const holder: { engine?: VaultEmbeddingEngine } = {};
  const repo = await Repository.openVault(backendStorage, root, {
    onIndexChange: (relPath, note) => holder.engine?.noteChanged(relPath, note),
  });
  const backend = new MockBackend();
  const router = new AiRouter([llm], { ...DEFAULT_ROUTING, 'label-similarity': 'mock' });
  const store = new SimilarStore({ read: (p) => repo.readInternal(p), write: (p, c) => repo.writeInternal(p, c) });
  const engine = new VaultEmbeddingEngine(repo, backend, router, store, { disableTimers: true });
  holder.engine = engine;
  await engine.attach();
  return { repo, engine, backend };
}

describe('VaultEmbeddingEngine — embeddings + ai-similar (D6a/S15)', () => {
  it('draws an ai-similar edge only when the LLM names a shared concept', async () => {
    const { repo, engine } = await open(new MockAiClient());
    await repo.createNote('a.md', '# BOJ Policy\nThe Bank of Japan set interest rates.\n');
    await repo.createNote('b.md', '# Fed Banking\nThe central bank adjusted monetary policy.\n');
    await repo.createNote('c.md', '# Miso Soup\nSimmer dashi, add miso and tofu.\n');

    await engine.syncAll();

    const pairs = engine.similarPairs();
    // a/b share the "Banking" concept → one edge with a specific reason; the soup note joins none.
    expect(pairs).toHaveLength(1);
    const p = pairs[0];
    expect([p.aRelPath, p.bRelPath].sort()).toEqual(['a.md', 'b.md']);
    expect(p.reason.length).toBeGreaterThan(15);
    expect(p.aVaultId).toBe(repo.vaultId);
  });

  it('does not re-ask the LLM about a rejected pair on the next sync (S15 memory)', async () => {
    const llm = new CountingLlm();
    const { repo, engine } = await open(llm);
    await repo.createNote('bank.md', '# Bank\nMonetary policy and interest rates.\n');
    await repo.createNote('soup.md', '# Soup\nMiso and tofu recipe.\n');
    await engine.syncAll();
    const first = llm.labelCalls;
    expect(first).toBeGreaterThan(0);
    expect(engine.similarPairs()).toHaveLength(0); // no shared concept → rejected

    await engine.syncAll(); // nothing changed
    expect(llm.labelCalls).toBe(first); // rejected pair not re-asked
  });

  it('re-embeds only changed notes (S14 incremental)', async () => {
    const { repo, engine, backend } = await open(new MockAiClient());
    await repo.createNote('a.md', '# A\nbanking one\n');
    await repo.createNote('b.md', '# B\nbanking two\n');
    await engine.syncAll();
    backend.embedCalls.length = 0;

    await repo.saveNote('a.md', '# A\nbanking one edited\n');
    await engine.syncAll();
    const embedded = backend.embedCalls.flat();
    expect(embedded).toHaveLength(1); // only a.md re-embedded
  });

  it('drops a deleted note from the embedding store and its edges', async () => {
    const { repo, engine, backend } = await open(new MockAiClient());
    await repo.createNote('a.md', '# A\nbanking one\n');
    await repo.createNote('b.md', '# B\nbanking two\n');
    await engine.syncAll();
    expect(engine.similarPairs()).toHaveLength(1);

    await repo.deleteNote('b.md');
    await engine.settle();
    expect(backend.rows.has('b.md')).toBe(false);
    expect(engine.similarPairs()).toHaveLength(0);
  });
});
