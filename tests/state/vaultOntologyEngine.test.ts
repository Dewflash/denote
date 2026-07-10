// Pass-08 integration: the ontology engine against a REAL temp-dir Repository with a concept-aware
// stub embedding backend + a controllable LLM. Proves the D14/R3 anti-sprawl canonicalization
// (near-duplicate names → ONE topic), soft membership, recurrence-gated hierarchy, `_topics`
// materialization + S18 freeze, folder misfit, and the cancellable Organize-vault sweep.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Repository } from '../../src/state/repository';
import { VaultOntologyEngine } from '../../src/state/vaultOntologyEngine';
import { TopicStore } from '../../src/services/topicStore';
import { AiRouter, DEFAULT_ROUTING } from '../../src/services/aiClient';
import type { AiClient, EnrichResult, SuggestedTopic } from '../../src/services/aiClient';
import type {
  EmbeddingIndex,
  EmbeddingNeighbor,
  EmbeddingPutEntry,
  EmbeddingsBackend,
  EmbedResult,
  EmbeddingVectorRow,
} from '../../src/services/embeddings';
import { readTopicFile } from '../../src/domain/topicFile';
import { cleanup, makeTempVault, nodeStorage } from '../helpers/nodeStorage';

const MODEL = 'intfloat/multilingual-e5-small';

// Concept → orthogonal basis vector, so distinct concepts never centroid-collapse but every
// "banking" phrasing lands on the same vector (the point of the R3 test).
const CONCEPTS: [RegExp, number[]][] = [
  [/bank/i, [1, 0, 0, 0, 0]],
  [/financ/i, [0, 1, 0, 0, 0]],
  [/interest|rate/i, [0, 0, 1, 0, 0]],
  [/japan|yen/i, [0, 0, 0, 1, 0]],
  [/cook|soup|miso|food|recipe/i, [0, 0, 0, 0, 1]],
];
const conceptVec = (text: string): number[] => CONCEPTS.find(([re]) => re.test(text))?.[1] ?? [0, 0, 0, 0, 0];

class StubBackend implements EmbeddingsBackend {
  rows = new Map<string, { contentHash: string; vector: number[] }>();
  async embed(texts: string[]): Promise<EmbedResult> {
    return { model: MODEL, dim: 5, vectors: texts.map(conceptVec) };
  }
  async index(): Promise<EmbeddingIndex> {
    const rows = [...this.rows.entries()].map(([relPath, v], i) => ({ row: i, relPath, contentHash: v.contentHash }));
    return { version: 1, model: rows.length ? MODEL : '', dim: 5, rows, free: [] };
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
  async topK(_root: string, relPath: string, k: number, minCos: number): Promise<EmbeddingNeighbor[]> {
    const q = this.rows.get(relPath)?.vector;
    if (!q) return [];
    const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
    return [...this.rows.entries()]
      .filter(([p]) => p !== relPath)
      .map(([p, v]) => ({ relPath: p, cos: cos(q, v.vector) }))
      .filter((n) => n.cos >= minCos)
      .sort((a, b) => b.cos - a.cos)
      .slice(0, k);
  }
  async vectors(_root: string, relPaths: string[]): Promise<EmbeddingVectorRow[]> {
    return relPaths.flatMap((p) => {
      const v = this.rows.get(p);
      return v ? [{ relPath: p, vector: v.vector }] : [];
    });
  }
}

/** A trivial LLM whose only job in these tests is summarize (folder profiles) + label-similarity
 *  (merge sweep). Enrichment is fed to the ontology engine directly via onEnrichResult. */
class StubLlm implements AiClient {
  readonly id = 'mock' as const;
  readonly modelId = 'mock@1';
  readonly isNetwork = false;
  async capabilities() {
    return { available: true, maxInputTokens: 8000, supportsGuidedJson: true, modelVersion: this.modelId };
  }
  async summarize(req: { text: string; maxWords: number }) {
    return { summary: req.text.split(/\s+/).slice(0, req.maxWords).join(' ') };
  }
  async enrichNote(): Promise<EnrichResult> {
    return { topics: [], links: [], tags: [], summary: null, aliases: [] };
  }
  async labelSimilarity() {
    return { related: false, reason: 'no shared concept', confidence: 0.2 };
  }
}

function res(topics: Partial<SuggestedTopic>[]): EnrichResult {
  return {
    topics: topics.map((t) => ({
      name: t.name ?? 'Topic',
      existingTopicId: t.existingTopicId ?? null,
      reason: t.reason ?? 'shared concept in substance',
      confidence: t.confidence ?? 0.9,
      ...(t.parentName ? { parentName: t.parentName } : {}),
      ...(t.relatedNames ? { relatedNames: t.relatedNames } : {}),
    })),
    links: [],
    tags: [],
    summary: null,
    aliases: [],
  };
}

const backendStorage = nodeStorage();
let root: string;
beforeEach(async () => {
  root = await makeTempVault();
});
afterEach(async () => {
  await cleanup(root);
});

async function open() {
  const repo = await Repository.openVault(backendStorage, root, {});
  const backend = new StubBackend();
  const router = new AiRouter([new StubLlm()], { ...DEFAULT_ROUTING, summarize: 'mock', 'label-similarity': 'mock' });
  const store = new TopicStore({ read: (p) => repo.readInternal(p), write: (p, c) => repo.writeInternal(p, c) });
  const engine = new VaultOntologyEngine(repo, backend, router, store, {});
  await engine.attach();
  return { repo, backend, store, engine };
}

async function enrich(engine: VaultOntologyEngine, repo: Repository, rel: string, topics: Partial<SuggestedTopic>[]) {
  await engine.onEnrichResult(rel, repo.getHash(rel)!, res(topics));
}

describe('VaultOntologyEngine — canonicalization (D14/R3)', () => {
  it('collapses banking / banks / banking system to ONE topic with all three as members', async () => {
    const { repo, engine, store } = await open();
    await repo.createNote('a.md', '# A\nThe banking sector.\n');
    await repo.createNote('b.md', '# B\nCommercial banks.\n');
    await repo.createNote('c.md', '# C\nThe banking system.\n');
    await enrich(engine, repo, 'a.md', [{ name: 'Banking' }]);
    await enrich(engine, repo, 'b.md', [{ name: 'Banks' }]);
    await enrich(engine, repo, 'c.md', [{ name: 'Banking System' }]);

    const bank = store.all().filter((t) => /bank/i.test(t.name) || t.aliases.some((x) => /bank/i.test(x)));
    expect(bank).toHaveLength(1);
    expect(bank[0].members.map((m) => m.notePath).sort()).toEqual(['a.md', 'b.md', 'c.md']);
    // The other two names survive as aliases (traceability).
    expect(bank[0].aliases.map((a) => a.toLowerCase()).sort()).toEqual(['banking system', 'banks']);
  });

  it('keeps genuinely different concepts as separate topics', async () => {
    const { repo, engine, store } = await open();
    await repo.createNote('bank.md', '# Bank\nbanking\n');
    await repo.createNote('soup.md', '# Soup\nmiso soup recipe\n');
    await enrich(engine, repo, 'bank.md', [{ name: 'Banking' }]);
    await enrich(engine, repo, 'soup.md', [{ name: 'Cooking' }]);
    expect(store.all()).toHaveLength(2);
  });
});

describe('VaultOntologyEngine — hierarchy + membership', () => {
  it('applies a parent edge once it recurs ≥2 times', async () => {
    const { repo, engine, store } = await open();
    await repo.createNote('a.md', '# A\nbanking\n');
    await repo.createNote('b.md', '# B\nbanking\n');
    await enrich(engine, repo, 'a.md', [{ name: 'Banking', parentName: 'Finance' }]);
    const banking = store.byFoldedName('banking')!;
    expect(banking.parentId).toBeNull(); // proposed once — not yet applied
    await enrich(engine, repo, 'b.md', [{ name: 'Banking', parentName: 'Finance' }]);
    const finance = store.byFoldedName('finance')!;
    expect(store.get(banking.id)!.parentId).toBe(finance.id);
  });

  it('folder co-location adds to the membership weight but is never decisive', async () => {
    const { repo, engine, store } = await open();
    await repo.createNote('Japan/one.md', '# One\nbanking\n');
    await repo.createNote('Japan/two.md', '# Two\nbanking\n');
    await enrich(engine, repo, 'Japan/one.md', [{ name: 'Banking', confidence: 0.7 }]);
    await enrich(engine, repo, 'Japan/two.md', [{ name: 'Banking', confidence: 0.7 }]);
    const banking = store.byFoldedName('banking')!;
    const two = banking.members.find((m) => m.notePath === 'Japan/two.md')!;
    expect(two.weight).toBeCloseTo(0.8); // 0.7 + 0.1 folder bonus (one.md already a member)
  });
});

describe('VaultOntologyEngine — _topics materialization + freeze (D8c/S18)', () => {
  async function threeBankNotes() {
    const ctx = await open();
    for (const n of ['a', 'b', 'c']) {
      await ctx.repo.createNote(`${n}.md`, `# ${n}\nbanking\n`);
      await enrich(ctx.engine, ctx.repo, `${n}.md`, [{ name: 'Banking' }]);
    }
    return ctx;
  }

  it('materializes a topic note once it reaches 3 members', async () => {
    const { repo } = await threeBankNotes();
    const file = await repo.readNote('_topics/Banking.md');
    expect(file).toContain('# Banking');
    expect(file).toContain('source: ai');
    expect(file).toContain('- [[a]]');
    expect(file).toContain('- [[b]]');
    expect(file).toContain('- [[c]]');
  });

  it('regenerating an unchanged ontology is byte-stable (no churn)', async () => {
    const { repo, engine, store } = await threeBankNotes();
    const before = await repo.readNote('_topics/Banking.md');
    await engine.materializeTopic(store.byFoldedName('banking')!.id);
    const after = await repo.readNote('_topics/Banking.md');
    expect(after).toBe(before);
  });

  it('freezes a user-edited topic file (source: user-modified) and stops regenerating', async () => {
    const { repo, engine, store } = await threeBankNotes();
    const bankingId = store.byFoldedName('banking')!.id;
    // Simulate a user editing the body (frontmatter still source: ai).
    const edited = '---\nsource: ai\ntopic_id: x\ngenerated_hash: stale\n---\n# Banking\n\nMy own notes here.\n';
    await repo.saveNote('_topics/Banking.md', edited);

    await engine.materializeTopic(bankingId);
    const frozen = readTopicFile(await repo.readNote('_topics/Banking.md'));
    expect(frozen.source).toBe('user-modified');
    expect(frozen.body).toContain('My own notes here.'); // user work preserved

    // A further ontology change never overwrites it.
    await repo.createNote('d.md', '# d\nbanking\n');
    await enrich(engine, repo, 'd.md', [{ name: 'Banking' }]);
    const still = readTopicFile(await repo.readNote('_topics/Banking.md'));
    expect(still.source).toBe('user-modified');
    expect(still.body).toContain('My own notes here.');
  });
});

describe('VaultOntologyEngine — Organize-vault (misfit, cancel)', () => {
  it('flags a note that does not fit its folder as a misfit suggestion (never a move)', async () => {
    const { repo, engine, store, backend } = await open();
    const notes: [string, string, Partial<SuggestedTopic>[], number[]][] = [
      ['Japan/one.md', 'banking', [{ name: 'Banking' }], [1, 0, 0, 0, 0]],
      ['Japan/two.md', 'banking', [{ name: 'Banking' }], [1, 0, 0, 0, 0]],
      ['Japan/three.md', 'banking', [{ name: 'Banking' }], [1, 0, 0, 0, 0]],
      ['Japan/miso.md', 'miso soup recipe', [{ name: 'Cooking' }], [0, 0, 0, 0, 1]],
    ];
    for (const [rel, body, topics, vec] of notes) {
      await repo.createNote(rel, `# ${rel}\n${body}\n`);
      await backend.put(repo.root, MODEL, 5, [{ relPath: rel, contentHash: repo.getHash(rel)!, vector: vec }]);
      await enrich(engine, repo, rel, topics);
    }

    const result = await engine.organizeVault();
    expect(result.cancelled).toBe(false);
    const misfits = store.allMisfits();
    expect(misfits.map((m) => m.relPath)).toContain('Japan/miso.md');
    // The banking notes are NOT misfits in their own folder.
    expect(misfits.map((m) => m.relPath)).not.toContain('Japan/one.md');
    // Files are never moved — the note still lives where it was.
    expect(await repo.readNote('Japan/miso.md')).toContain('miso soup');
  });

  it('is cancellable via the signal', async () => {
    const { engine } = await open();
    const result = await engine.organizeVault({ signal: { aborted: true } });
    expect(result.cancelled).toBe(true);
  });
});
