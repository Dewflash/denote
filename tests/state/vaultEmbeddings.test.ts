// Pass-07 integration: the embedding + ai-similar pipeline against a REAL temp-dir Repository,
// with a mock embeddings backend (in-memory store + topK) and the deterministic mock LLM. Proves
// the D6a two-gate flow (embedding proposes → LLM names a concept), S15 rejection memory, and
// S14 incremental re-embedding.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Repository } from '../../src/state/repository';
import { VaultEmbeddingEngine, type VaultEmbeddingDeps } from '../../src/state/vaultEmbeddings';
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
  failPut = false;

  async embed(texts: string[]): Promise<EmbedResult> {
    this.embedCalls.push(texts);
    return { model: MODEL, dim: 4, vectors: texts.map(() => [1, 0, 0, 0]) };
  }
  async index(): Promise<EmbeddingIndex> {
    const rows = [...this.rows.entries()].map(([relPath, v], i) => ({ row: i, relPath, contentHash: v.contentHash }));
    return { version: 1, model: rows.length ? MODEL : '', dim: 4, rows, free: [] };
  }
  async put(_root: string, _model: string, _dim: number, entries: EmbeddingPutEntry[]): Promise<void> {
    if (this.failPut) throw new Error('embedding store unavailable');
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
  async vectors(_root: string, relPaths: string[]) {
    return relPaths.flatMap((p) => {
      const v = this.rows.get(p);
      return v ? [{ relPath: p, vector: v.vector }] : [];
    });
  }
}

class CountingLlm implements AiClient {
  readonly id = 'mock' as const;
  readonly modelId = 'mock@1';
  readonly isNetwork = false;
  labelCalls = 0;
  failLabels = false;
  refuseOnce = false;
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
  async labelSimilarity(r: LabelSimilarityRequest) {
    this.labelCalls++;
    if (this.failLabels) throw new Error('sidecar unavailable');
    if (this.refuseOnce) {
      this.refuseOnce = false;
      throw new Error('ai-invalid-output: refusal (sensitive content)');
    }
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

async function open(llm: AiClient, deps: Partial<VaultEmbeddingDeps> = {}) {
  const holder: { engine?: VaultEmbeddingEngine } = {};
  const repo = await Repository.openVault(backendStorage, root, {
    onIndexChange: (relPath, note) => holder.engine?.noteChanged(relPath, note),
  });
  const backend = new MockBackend();
  const router = new AiRouter([llm], { ...DEFAULT_ROUTING, 'label-similarity': 'mock' });
  const store = new SimilarStore({ read: (p) => repo.readInternal(p), write: (p, c) => repo.writeInternal(p, c) });
  const engine = new VaultEmbeddingEngine(repo, backend, router, store, { disableTimers: true, ...deps });
  holder.engine = engine;
  await engine.attach();
  return { repo, engine, backend };
}

/** "Relaunch the app": a FRESH Repository + engine + SimilarStore over the same on-disk vault.
 *  disableTimers means no similarity pass runs — whatever diagnostics the new engine reports
 *  must come purely from the persisted store (R-1 restart hydration). */
async function reopen(llm: AiClient = new MockAiClient()) {
  const repo = await Repository.openVault(backendStorage, root, {});
  const backend = new MockBackend();
  const router = new AiRouter([llm], { ...DEFAULT_ROUTING, 'label-similarity': 'mock' });
  const store = new SimilarStore({ read: (p) => repo.readInternal(p), write: (p, c) => repo.writeInternal(p, c) });
  const engine = new VaultEmbeddingEngine(repo, backend, router, store, { disableTimers: true });
  await engine.attach();
  return { repo, engine };
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
    expect(engine.similarityDiagnosticsFor('a.md')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relPath: 'b.md', gate: 'accepted' }),
        expect.objectContaining({ relPath: 'c.md', gate: 'llm-unrelated' }),
      ]),
    );
  });

  it('exposes embedding-ranked neighbor summaries for enrichment retrieval', async () => {
    const { repo, engine } = await open(new MockAiClient());
    await repo.createNote('a.md', '# Current\nA note about central-bank policy.\n');
    await repo.createNote('b.md', '# Neighbor\nA short note about rate policy.\n');
    await engine.syncAll();

    await expect(engine.candidateNotesFor('a.md')).resolves.toEqual([
      expect.objectContaining({
        relPath: 'b.md',
        title: 'Neighbor',
        summary: expect.stringContaining('rate policy'),
      }),
    ]);
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

  it('retries unresolved similarity after the sidecar recovers without an edit', async () => {
    const llm = new CountingLlm();
    llm.failLabels = true;
    const { repo, engine } = await open(llm);
    await repo.createNote('a.md', '# Bank\nMonetary policy and interest rates.\n');
    await repo.createNote('b.md', '# Central bank\nThe central bank changed rates.\n');
    await engine.syncAll();
    expect(engine.similarPairs()).toHaveLength(0);
    expect(llm.labelCalls).toBe(1);

    llm.failLabels = false;
    engine.retry();
    await engine.settle();
    expect(engine.similarPairs()).toHaveLength(1);
  });

  it('remembers a permanent model refusal and continues judging other pairs', async () => {
    const llm = new CountingLlm();
    llm.refuseOnce = true;
    const { repo, engine } = await open(llm);
    await repo.createNote('a.md', '# Bank Policy\nMonetary policy and interest rates.\n');
    await repo.createNote('b.md', '# Soup\nMiso and tofu recipe.\n');
    await repo.createNote('c.md', '# Central Bank\nThe central bank changed rates.\n');

    await engine.syncAll();

    expect(llm.labelCalls).toBeGreaterThan(1);
    expect(engine.similarPairs()).toHaveLength(1);
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

  it('R-1: candidate diagnostics survive a restart via the persisted store', async () => {
    const { repo, engine } = await open(new MockAiClient());
    await repo.createNote('a.md', '# BOJ Policy\nThe Bank of Japan set interest rates.\n');
    await repo.createNote('b.md', '# Fed Banking\nThe central bank adjusted monetary policy.\n');
    await repo.createNote('c.md', '# Miso Soup\nSimmer dashi, add miso and tofu.\n');
    await engine.syncAll();
    const before = engine.similarityDiagnosticsFor('a.md');
    expect(before.length).toBeGreaterThan(0);

    const { engine: relaunched } = await reopen();
    expect(relaunched.similarityDiagnosticsFor('a.md')).toEqual(before);
    expect(relaunched.similarityDiagnosticsFor('b.md')).toEqual(engine.similarityDiagnosticsFor('b.md'));
  });

  it('R-1: the cosine-floor gate is persisted too, and an edit invalidates hydrated diagnostics', async () => {
    const counting = new CountingLlm();
    // Floor above the mock backend's 0.7 → every candidate is rejected before the LLM gate.
    const { repo, engine } = await open(counting, { minCos: () => 0.9 });
    await repo.createNote('a.md', '# A\nbanking one\n');
    await repo.createNote('b.md', '# B\nbanking two\n');
    await engine.syncAll();
    expect(counting.labelCalls).toBe(0);
    const floored = [{ relPath: 'b.md', cosine: 0.7, gate: 'cosine-floor' }];
    expect(engine.similarityDiagnosticsFor('a.md')).toEqual(floored);

    const { repo: repo2, engine: relaunched } = await reopen();
    expect(relaunched.similarityDiagnosticsFor('a.md')).toEqual(floored);

    // A content edit changes the hash → the persisted list is stale and must NOT be shown.
    await repo2.saveNote('a.md', '# A\nbanking one, edited\n');
    expect(relaunched.similarityDiagnosticsFor('a.md')).toEqual([]);
  });

  it('reports embedding store failures instead of leaving a sync stuck', async () => {
    const { repo, engine, backend } = await open(new MockAiClient());
    await repo.createNote('a.md', '# A\nbanking one\n');
    backend.failPut = true;

    await engine.syncAll();

    expect(engine.status()).toEqual(expect.objectContaining({ state: 'error', error: 'embedding store unavailable' }));
    expect(engine.noteState('a.md')).toBe('error');
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
