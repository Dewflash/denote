// Pass-08 vision-corpus proof (EXPECTED.md "AI layer" / "Ontology (D14)" lines). Runs the REAL
// enrichment→ontology wiring (VaultAiEngine feeds existingTopics + onEnrichResult into
// VaultOntologyEngine) over the canonical vision-vault notes copied into a temp Repository, with a
// concept-aware stub LLM + stub embedding backend standing in for the on-device backends the
// EXPECTED file says these behaviors need. Asserts:
//   - a Finance parent topic emerges with a Banking child; Japan / Yen Intervention / Interest
//     Rates / Untitled Capture are members (D14; "Japan note lands in Banking under Finance");
//   - near-duplicate banking phrasing yields exactly ONE Banking topic (anti-sprawl, R3);
//   - Miso Soup scatters into its own (Cooking) cluster — NOT the banking notes;
//   - De-dollarization + Gold cohere into a reserve-currency theme topic under Finance;
//   - `_topics/Finance.md` materializes with member wikilinks (D8c/S18);
//   - Miso Soup is flagged a folder MISFIT (never moved).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Repository } from '../../src/state/repository';
import { VaultOntologyEngine } from '../../src/state/vaultOntologyEngine';
import { VaultAiEngine } from '../../src/state/vaultAiEngine';
import { TopicStore } from '../../src/services/topicStore';
import { AnnotationStore } from '../../src/services/annotationStore';
import { AiRouter, DEFAULT_ROUTING } from '../../src/services/aiClient';
import type { AiClient, EnrichRequest, EnrichResult, SuggestedTopic } from '../../src/services/aiClient';
import type {
  EmbeddingIndex,
  EmbeddingNeighbor,
  EmbeddingPutEntry,
  EmbeddingsBackend,
  EmbedResult,
  EmbeddingVectorRow,
} from '../../src/services/embeddings';
import { dominantTopic } from '../../src/domain/ontology';
import { readTopicFile } from '../../src/domain/topicFile';
import { cleanup, makeTempVault, nodeStorage } from '../helpers/nodeStorage';

const MODEL = 'intfloat/multilingual-e5-small';
const here = fileURLToPath(new URL('.', import.meta.url));
const corpusDir = join(here, '..', 'fixtures', 'vision-vault', 'daily-learnings');

// The daily-learnings notes we exercise (church vault is unrelated to this ontology).
const NOTES = [
  'Inbox/Untitled Capture.md',
  'Japan/Japan.md',
  'Japan/Yen Intervention.md',
  'Japan/Miso Soup Recipe.md',
  'Economics/Interest Rates.md',
  'Economics/Gold.md',
  'Economics/De-dollarization.md',
  'Tech/Embeddings.md',
  'Tech/Local First Software.md',
];

// Concept → orthogonal basis vector (distinct concepts never centroid-collapse; every banking
// phrasing shares one vector).
const CONCEPTS: [RegExp, number[]][] = [
  [/miso|soup|recipe|dashi|tofu|broth|cook/i, [0, 0, 0, 1, 0, 0]], // cooking (checked first)
  [/embedding|vector|local.first|files on disk|retrieval|offline/i, [0, 0, 0, 0, 0, 1]], // tech
  [/de-?dollar|\bgold\b|reserve|stablecoin|bullion/i, [0, 0, 1, 0, 0, 0]], // reserve currencies
  [/bank|monetary|boj|central|interest|\brate|yen|japan|policy/i, [1, 0, 0, 0, 0, 0]], // finance
  [/finance/i, [0, 1, 0, 0, 0, 0]],
];
const conceptVec = (text: string): number[] => CONCEPTS.find(([re]) => re.test(text))?.[1] ?? [0, 0, 0, 0, 0, 0];

/** The topic proposals a real on-device model would return for each note category. */
function proposalsFor(text: string, title: string): SuggestedTopic[] {
  const hay = `${title}\n${text}`;
  const t = (name: string, parentName?: string): SuggestedTopic => ({
    name,
    existingTopicId: null,
    reason: `"${title}" engages the ${name} concept in substance.`,
    confidence: 0.9,
    ...(parentName ? { parentName } : {}),
  });
  if (/miso|soup|recipe|dashi|tofu|broth|cook/i.test(hay)) return [t('Cooking')];
  if (/embedding|vector|local.first|files on disk|retrieval|offline/i.test(hay)) return [t('Technology')];
  if (/de-?dollar|\bgold\b|reserve|stablecoin|bullion/i.test(hay)) return [t('Finance'), t('Reserve Currencies', 'Finance')];
  if (/bank|monetary|boj|central|interest|\brate|yen|japan|policy/i.test(hay)) return [t('Finance'), t('Banking', 'Finance')];
  return [];
}

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
  async enrichNote(req: EnrichRequest): Promise<EnrichResult> {
    const topics = proposalsFor(req.text, req.title).map((p) => {
      const existing = req.existingTopics.find((e) => e.name.toLowerCase() === p.name.toLowerCase());
      return { ...p, existingTopicId: existing?.id ?? null };
    });
    return { topics, links: [], tags: [], summary: null, aliases: [] };
  }
  async labelSimilarity() {
    return { related: false, reason: 'no shared concept', confidence: 0.2 };
  }
}

class StubBackend implements EmbeddingsBackend {
  rows = new Map<string, { contentHash: string; vector: number[] }>();
  async embed(texts: string[]): Promise<EmbedResult> {
    return { model: MODEL, dim: 6, vectors: texts.map(conceptVec) };
  }
  async index(): Promise<EmbeddingIndex> {
    const rows = [...this.rows.entries()].map(([relPath, v], i) => ({ row: i, relPath, contentHash: v.contentHash }));
    return { version: 1, model: rows.length ? MODEL : '', dim: 6, rows, free: [] };
  }
  async put(_r: string, _m: string, _d: number, entries: EmbeddingPutEntry[]): Promise<void> {
    for (const e of entries) this.rows.set(e.relPath, { contentHash: e.contentHash, vector: e.vector });
  }
  async remove(_r: string, relPath: string): Promise<void> {
    this.rows.delete(relPath);
  }
  async remap(_r: string, from: string, to: string): Promise<void> {
    const v = this.rows.get(from);
    if (v) {
      this.rows.delete(from);
      this.rows.set(to, v);
    }
  }
  async topK(): Promise<EmbeddingNeighbor[]> {
    return [];
  }
  async vectors(_r: string, relPaths: string[]): Promise<EmbeddingVectorRow[]> {
    return relPaths.flatMap((p) => {
      const v = this.rows.get(p);
      return v ? [{ relPath: p, vector: v.vector }] : [];
    });
  }
}

const storage = nodeStorage();
let root: string;
beforeEach(async () => {
  root = await makeTempVault();
});
afterEach(async () => {
  await cleanup(root);
});

async function buildVault() {
  const holder: { ai?: VaultAiEngine; onto?: VaultOntologyEngine } = {};
  const repo = await Repository.openVault(storage, root, {
    onIndexChange: (rel, note) => {
      holder.ai?.noteChanged(rel, note);
      holder.onto?.noteChanged(rel, note);
    },
  });
  const backend = new StubBackend();
  const router = new AiRouter([new StubLlm()], { ...DEFAULT_ROUTING, summarize: 'mock', 'label-similarity': 'mock' });
  const topicStore = new TopicStore({ read: (p) => repo.readInternal(p), write: (p, c) => repo.writeInternal(p, c) });
  const onto = new VaultOntologyEngine(repo, backend, router, topicStore, {});
  await onto.attach();
  const annStore = new AnnotationStore({ read: (p) => repo.readInternal(p), write: (p, c) => repo.writeInternal(p, c) });
  const ai = new VaultAiEngine(repo, router, annStore, {
    disableTimers: true,
    existingTopics: () => onto.topicStubs(),
    onEnrichResult: (rel, hash, result) => onto.onEnrichResult(rel, hash, result),
  });
  await ai.attach();
  holder.ai = ai;
  holder.onto = onto;

  for (const rel of NOTES) {
    await repo.createNote(rel, readFileSync(join(corpusDir, rel), 'utf8'));
    await backend.put(repo.root, MODEL, 6, [{ relPath: rel, contentHash: repo.getHash(rel)!, vector: conceptVec(readFileSync(join(corpusDir, rel), 'utf8')) }]);
  }
  // Enrich every note through the REAL pipeline (D14 canonicalization runs inside onEnrichResult).
  for (const rel of NOTES) await ai.enrichNow(rel);

  return { repo, onto, topicStore, backend };
}

describe('vision corpus — ontology layer (pass 8)', () => {
  it('emerges a Finance parent with a Banking child holding the right members (D14)', async () => {
    const { topicStore } = await buildVault();
    const banking = topicStore.byFoldedName('banking')!;
    const finance = topicStore.byFoldedName('finance')!;
    expect(banking).toBeDefined();
    expect(finance).toBeDefined();
    expect(banking.parentId).toBe(finance.id); // "Japan note lands in Banking under Finance parent"

    const members = banking.members.map((m) => m.notePath).sort();
    expect(members).toEqual(
      ['Economics/Interest Rates.md', 'Inbox/Untitled Capture.md', 'Japan/Japan.md', 'Japan/Yen Intervention.md'].sort(),
    );
  });

  it('collapses banking phrasing to exactly ONE topic (anti-sprawl R3 / anti-goal)', async () => {
    const { topicStore } = await buildVault();
    const bankish = topicStore.all().filter((t) => /bank/i.test(t.name));
    expect(bankish).toHaveLength(1); // never both "Banking" and "Banks"
  });

  it('scatters Miso Soup into its own cluster — not the banking notes', async () => {
    const { topicStore, onto } = await buildVault();
    const banking = topicStore.byFoldedName('banking')!;
    const finance = topicStore.byFoldedName('finance')!;
    const misoInBankish = [banking, finance].some((t) => t.members.some((m) => m.notePath === 'Japan/Miso Soup Recipe.md'));
    expect(misoInBankish).toBe(false);

    const misoDom = dominantTopic(onto.membershipsForNote('Japan/Miso Soup Recipe.md'));
    const japanDom = dominantTopic(onto.membershipsForNote('Japan/Japan.md'));
    expect(misoDom?.name).toBe('Cooking');
    expect(japanDom?.name).not.toBe('Cooking'); // different cluster color/group
  });

  it('coheres De-dollarization + Gold into a reserve-currency theme under Finance', async () => {
    const { topicStore } = await buildVault();
    const reserve = topicStore.byFoldedName('reserve currencies')!;
    const finance = topicStore.byFoldedName('finance')!;
    expect(reserve).toBeDefined();
    expect(reserve.parentId).toBe(finance.id);
    expect(reserve.members.map((m) => m.notePath).sort()).toEqual(['Economics/De-dollarization.md', 'Economics/Gold.md']);
  });

  it('materializes _topics/Finance.md with member wikilinks (D8c/S18)', async () => {
    const { repo } = await buildVault();
    const file = await repo.readNote('_topics/Finance.md');
    const parsed = readTopicFile(file);
    expect(parsed.source).toBe('ai');
    expect(file).toContain('# Finance');
    expect(file).toContain('[[Japan]]');
    expect(file).toContain('[[Interest Rates]]');
  });

  it('flags Miso Soup as a folder misfit (never moved)', async () => {
    const { onto, topicStore, repo } = await buildVault();
    await onto.organizeVault();
    const misfits = topicStore.allMisfits().map((m) => m.relPath);
    expect(misfits).toContain('Japan/Miso Soup Recipe.md');
    // Anti-goal: the note is never moved.
    expect(await repo.readNote('Japan/Miso Soup Recipe.md')).toContain('Dashi stock');
  });
});

// ── Architect checkpoint-C addition: variant-name anti-sprawl through the REAL engine wiring.
// The corpus stub always proposes the canonical name "Banking", which proves exact-match
// collapse only; the pass-8 brief demands "banking"/"banks"/"the banking system" → ONE topic.
// This drives the same VaultAiEngine→VaultOntologyEngine path with a variant-emitting stub.

class VariantStub extends StubLlm {
  private i = 0;
  override async enrichNote(): ReturnType<StubLlm['enrichNote']> {
    const variants = ['Banking', 'banks', 'The Banking System'];
    const name = variants[this.i++ % variants.length];
    return {
      topics: [{ name, existingTopicId: null, reason: `discusses ${name} substantively`, confidence: 0.9 }],
      links: [], tags: [], aliases: [],
      summary: 'stub',
    };
  }
}

describe('architect probe — variant topic names collapse via the real pipeline (R3)', () => {
  it('"Banking" / "banks" / "The Banking System" yield exactly ONE topic with aliases', async () => {
    const holder: { ai?: VaultAiEngine; onto?: VaultOntologyEngine } = {};
    const repo = await Repository.openVault(storage, root, {
      onIndexChange: (rel, note) => {
        holder.ai?.noteChanged(rel, note);
        holder.onto?.noteChanged(rel, note);
      },
    });
    const backend = new StubBackend();
    const router = new AiRouter([new VariantStub()], { ...DEFAULT_ROUTING, summarize: 'mock', 'label-similarity': 'mock' });
    const topicStore = new TopicStore({ read: (p) => repo.readInternal(p), write: (p, c) => repo.writeInternal(p, c) });
    const onto = new VaultOntologyEngine(repo, backend, router, topicStore, {});
    await onto.attach();
    const annStore = new AnnotationStore({ read: (p) => repo.readInternal(p), write: (p, c) => repo.writeInternal(p, c) });
    const ai = new VaultAiEngine(repo, router, annStore, {
      disableTimers: true,
      existingTopics: () => onto.topicStubs(),
      onEnrichResult: (rel, hash, result) => onto.onEnrichResult(rel, hash, result),
    });
    await ai.attach();
    holder.ai = ai;
    holder.onto = onto;

    // Three notes, same finance concept vector, three different proposed names.
    const bodies = [
      ['a.md', '# A\nThe banking sector consolidates under zero rates.\n'],
      ['b.md', '# B\nJapanese banks merge as monetary policy bites.\n'],
      ['c.md', '# C\nThe banking system faces a structural interest rate squeeze.\n'],
    ] as const;
    for (const [rel, body] of bodies) {
      await repo.createNote(rel, body);
      await backend.put(repo.root, MODEL, 6, [{ relPath: rel, contentHash: repo.getHash(rel)!, vector: [1, 0, 0, 0, 0, 0] }]);
    }
    for (const [rel] of bodies) await ai.enrichNow(rel);

    const bankish = topicStore.all().filter((t) => /bank/i.test(t.name) || t.aliases.some((a) => /bank/i.test(a)));
    expect(bankish).toHaveLength(1);
    const topic = bankish[0];
    // All three notes are members of the ONE topic; variant names became aliases.
    for (const [rel] of bodies) expect(topic.members.some((m) => m.notePath === rel)).toBe(true);
    expect(topic.aliases.length).toBeGreaterThanOrEqual(1);
  });
});
