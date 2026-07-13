// Pass-06 integration tests: the full AI loop against a REAL Repository over a temp-dir vault
// (no Tauri), driven with the deterministic mock backend. Covers the R1 loop guarantee, takeover
// apply/demote (S10), accept/reject + rejection memory (D10/S11), the accept undo op (D38), and
// the D18 localOnly boundary (zero network-backend calls).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Repository } from '../../src/state/repository';
import { VaultAiEngine, type VaultAiEngineDeps } from '../../src/state/vaultAiEngine';
import { AnnotationStore } from '../../src/services/annotationStore';
import { AiRouter, DEFAULT_ROUTING, MockAiClient } from '../../src/services/aiClient';
import type { AiClient } from '../../src/services/aiClient';
import { contentHash, parseNote } from '../../src/domain';
import type { Op } from '../../src/state/opLog';
import { cleanup, makeClock, makeTempVault, nodeStorage } from '../helpers/nodeStorage';

const backend = nodeStorage();
let root: string;

beforeEach(async () => {
  root = await makeTempVault();
});
afterEach(async () => {
  await cleanup(root);
});

interface Harness {
  repo: Repository;
  engine: VaultAiEngine;
  ops: Op[];
  clock: ReturnType<typeof makeClock>;
}

async function open(opts: { router?: AiRouter; localOnly?: boolean; candidateNotes?: VaultAiEngineDeps['candidateNotes'] } = {}): Promise<Harness> {
  const clock = makeClock();
  const ops: Op[] = [];
  const holder: { engine?: VaultAiEngine } = {};
  const repo = await Repository.openVault(backend, root, {
    now: clock.now,
    onIndexChange: (relPath, note) => holder.engine?.noteChanged(relPath, note),
  });
  const router = opts.router ?? new AiRouter([new MockAiClient()], DEFAULT_ROUTING);
  const store = new AnnotationStore(
    { read: (p) => repo.readInternal(p), write: (p, c) => repo.writeInternal(p, c) },
    clock.now,
  );
  const engine = new VaultAiEngine(repo, router, store, {
    now: clock.now,
    localOnly: () => opts.localOnly ?? false,
    threshold: () => 0.75,
    candidateNotes: opts.candidateNotes,
    pushOp: (op) => ops.push(op),
    disableTimers: true, // drive enrichNow() explicitly for determinism
  });
  holder.engine = engine;
  await engine.attach();
  return { repo, engine, ops, clock };
}

describe('VaultAiEngine — enrichment + takeover', () => {
  it('seeds existing notes when a vault opens', async () => {
    await backend.writeNote(root, 'Existing.md', '# Existing\nBanking and interest rates.\n');
    const { repo, engine } = await open();

    expect(engine['queue'].get('Existing.md')).toMatchObject({
      relPath: 'Existing.md',
      contentHash: repo.getHash('Existing.md'),
      state: 'pending',
    });
    expect(engine.queueStateFor('Existing.md')).toBe('queued');
  });

  it('passes embedding-ranked neighbor summaries to the enrichment backend', async () => {
    const counter = new CountingClient(new MockAiClient());
    const router = new AiRouter([counter], DEFAULT_ROUTING);
    await backend.writeNote(root, 'Current.md', '# Current\nA note about policy.\n');
    await backend.writeNote(root, 'Neighbor.md', '# Neighbor\nA concise policy summary.\n');
    const { engine } = await open({
      router,
      candidateNotes: () => [{ relPath: 'Neighbor.md', title: 'Neighbor', summary: 'policy summary' }],
    });

    await engine.enrichNow('Current.md');

    expect(counter.lastEnrichRequest?.candidateNotes).toEqual([
      { relPath: 'Neighbor.md', title: 'Neighbor', summary: 'policy summary' },
    ]);
  });

  it('publishes resolvable AI link suggestions for the graph without editing markdown', async () => {
    await backend.writeNote(root, 'Yen.md', '# Yen\nThe BOJ discussed interest rates and the yen.\n');
    await backend.writeNote(root, 'Rates.md', '# Rates\nInterest rates and bond yields.\n');
    const { repo, engine } = await open();
    const before = await repo.readNote('Yen.md');

    await engine.enrichNow('Yen.md', { linksOnly: true });

    expect(engine.graphLinkSuggestions()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        relPath: 'Yen.md',
        targetPath: 'Rates.md',
        vaultId: repo.vaultId,
        reason: expect.stringContaining('Interest Rates'),
      }),
    ]));
    expect(await repo.readNote('Yen.md')).toBe(before);
  });

  it('deduplicates repeated model links before they reach the graph and suggestions panel', async () => {
    await backend.writeNote(root, 'Current.md', '# Current\nA note about offline design.\n');
    await backend.writeNote(root, 'Neighbor.md', '# Neighbor\nOffline design patterns.\n');
    const router = new AiRouter([new DuplicateResultClient()], { ...DEFAULT_ROUTING, enrich: 'mock' });
    const { engine } = await open({ router });

    await engine.enrichNow('Current.md', { linksOnly: true });

    const links = engine.suggestionsFor('Current.md').filter((a) => a.kind === 'link');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ confidence: 0.9, payload: { targetPath: 'Neighbor.md' } });
    expect(engine.graphLinkSuggestions()).toHaveLength(1);
  });

  it('hash-gates an empty full result and clears the manual queue job', async () => {
    const empty = new EmptyResultClient();
    const router = new AiRouter([empty], { ...DEFAULT_ROUTING, enrich: 'mock' });
    await backend.writeNote(root, 'Plain.md', '# Plain\nA note with no model-specific suggestions.\n');
    const { engine } = await open({ router });

    await engine.enrichNow('Plain.md');

    expect(empty.enrichCalls).toBe(1);
    expect(engine.hasProcessed('Plain.md')).toBe(true);
    expect(engine['queue'].get('Plain.md')).toBeUndefined();
    await engine['runEnrichment']('Plain.md');
    expect(empty.enrichCalls).toBe(1);
  });

  it('keeps a link-only pass from marking full enrichment complete', async () => {
    const linkOnly = new LinksOnlyResultClient();
    const router = new AiRouter([linkOnly], { ...DEFAULT_ROUTING, enrich: 'mock' });
    await backend.writeNote(root, 'Current.md', '# Current\nOffline design notes.\n');
    await backend.writeNote(root, 'Neighbor.md', '# Neighbor\nOffline design patterns.\n');
    const { engine } = await open({ router });

    await engine.enrichNow('Current.md', { linksOnly: true });

    expect(engine.hasProcessed('Current.md')).toBe(true);
    expect(engine['seedMissingNotes']()).toBe(true);
    expect(engine['queue'].get('Current.md')).toMatchObject({ state: 'pending' });
  });

  it('parks the whole batch after one unavailable capability check and resumes on retry', async () => {
    const unavailable = new CountingClient(new MockAiClient(), 'apple');
    unavailable.available = false;
    const router = new AiRouter([unavailable], { ...DEFAULT_ROUTING, enrich: 'apple' });
    await backend.writeNote(root, 'One.md', '# One\nBanking policy.\n');
    await backend.writeNote(root, 'Two.md', '# Two\nInterest rates.\n');
    const { engine } = await open({ router });

    await engine['runPump']();

    expect(unavailable.capabilitiesCalls).toBe(1);
    expect(unavailable.enrichCalls).toBe(0);
    expect(engine.queueStateFor('One.md')).toBe('parked');
    expect(engine.queueStateFor('Two.md')).toBe('parked');

    unavailable.available = true;
    engine.retry();
    await engine['runPump']();

    expect(unavailable.capabilitiesCalls).toBe(2);
    expect(unavailable.enrichCalls).toBe(2);
  });

  it('a bare note gets provisional ai: structure without changing contentHash (R1)', async () => {
    const body = '# Yen Intervention\nThe BOJ defended the yen as interest rates diverged.\n';
    await backend.writeNote(root, 'Yen.md', '');
    const { repo, engine } = await open();
    await repo.saveNote('Yen.md', body);
    const hashBefore = repo.getHash('Yen.md')!;

    await engine.enrichNow('Yen.md');

    // The ai: block was written (bare note → takeover applied).
    const onDisk = await repo.readNote('Yen.md');
    expect(onDisk).toMatch(/^---\n[\s\S]*\bai:/m);
    expect(onDisk).toContain('japan');
    // contentHash is unchanged (D3a): the ai: block is excluded from the hash.
    expect(contentHash(onDisk)).toBe(hashBefore);
    expect(repo.getHash('Yen.md')).toBe(hashBefore);
    // The note is still "bare" as far as the parser sees user structure.
    const parsed = parseNote('Yen.md', onDisk);
    expect(parsed.aiFrontmatter?.tags).toContain('japan');
    expect(parsed.tags).toEqual([]);

    const provisional = engine.suggestionsFor('Yen.md').filter((a) => a.status === 'applied-provisional');
    expect(provisional.length).toBeGreaterThan(0);
  });

  it('rejecting a provisional suggestion removes its ai metadata as well as its live row', async () => {
    await backend.writeNote(root, 'Yen.md', '# Yen\nBOJ defended the yen; interest rates diverged.\n');
    const { repo, engine } = await open();
    await engine.enrichNow('Yen.md');

    const provisional = engine.suggestionsFor('Yen.md').find(
      (a) => a.status === 'applied-provisional' && a.kind === 'tag',
    );
    expect(provisional).toBeDefined();
    const tag = (provisional!.payload as { name: string }).name;

    await engine.reject(provisional!.id);

    expect(engine.suggestionsFor('Yen.md').some((a) => a.id === provisional!.id)).toBe(false);
    expect(repo.getParsed('Yen.md')?.aiFrontmatter?.tags ?? []).not.toContain(tag);
  });

  it('R1: enriching twice runs the mock exactly once (hash-gated, no re-trigger loop)', async () => {
    const counter = new CountingClient(new MockAiClient());
    const router = new AiRouter([counter], DEFAULT_ROUTING);
    await backend.writeNote(root, 'Yen.md', '# Yen\nBOJ and the yen and interest rates.\n');
    const { repo, engine } = await open({ router });

    await engine.enrichNow('Yen.md'); // force run #1 → writes ai: block
    const callsAfterFirst = counter.enrichCalls;

    // Simulate the watcher echo of our OWN takeover write coming back.
    await repo.onWatcherEvent({ relPath: 'Yen.md', kind: 'modify' });
    // And a normal ambient enqueue for the same (unchanged) content.
    await engine['runEnrichment']('Yen.md'); // ambient path respects the hash gate

    expect(counter.enrichCalls).toBe(callsAfterFirst); // no additional enrichment
    expect(callsAfterFirst).toBe(1);
  });

  it('adding a real tag demotes the provisional ai: block (S10)', async () => {
    await backend.writeNote(root, 'Yen.md', '# Yen\nBOJ defended the yen; interest rates diverged.\n');
    const { repo, engine } = await open();
    await engine.enrichNow('Yen.md');
    expect(await repo.readNote('Yen.md')).toContain('ai:');

    // The user adds their own tag → the note is no longer bare.
    await repo.saveNote('Yen.md', '# Yen\nBOJ defended the yen; interest rates diverged.\n\n#macro\n');
    await engine.settle(); // await the automatic demotion triggered by the change

    const onDisk = await repo.readNote('Yen.md');
    expect(onDisk).not.toContain('\nai:');
    expect(parseNote('Yen.md', onDisk).aiFrontmatter).toBeNull();
  });
});

describe('VaultAiEngine — accept / reject', () => {
  it('accept writes a real wikilink under ## Related and is undoable (D38)', async () => {
    await backend.writeNote(root, 'Interest Rates.md', '# Interest Rates\nCentral bank rate policy.\n');
    await backend.writeNote(root, 'Yen.md', '# Yen\nBOJ defended the yen; interest rates matter.\n');
    const { repo, engine, ops } = await open();
    await engine.enrichNow('Yen.md');

    const link = engine.suggestionsFor('Yen.md').find((a) => a.kind === 'link');
    expect(link).toBeDefined();
    await engine.accept(link!.id);

    const afterAccept = await repo.readNote('Yen.md');
    expect(afterAccept).toContain('## Related');
    expect(afterAccept).toMatch(/\[\[.+\]\]/);
    expect(ops.length).toBe(1);

    // Undo restores the body and the suggestion.
    await ops[0].undo();
    expect(await repo.readNote('Yen.md')).not.toContain('## Related');
  });

  it('reject is remembered for identical content and cleared by a content edit (S11)', async () => {
    await backend.writeNote(root, 'Note.md', '# Gold\nGold and bullion pricing.\n');
    const { repo, engine } = await open();
    await engine.enrichNow('Note.md');

    const tag = engine.suggestionsFor('Note.md').find((a) => a.kind === 'tag' && a.payload && (a.payload as { name: string }).name === 'gold');
    expect(tag).toBeDefined();
    await engine.reject(tag!.id);

    // Re-enriching identical content never re-surfaces the rejected 'gold' tag.
    await engine.enrichNow('Note.md');
    expect(engine.suggestionsFor('Note.md').some((a) => a.kind === 'tag' && (a.payload as { name: string }).name === 'gold')).toBe(false);

    // A content edit gives it a fresh chance.
    await repo.saveNote('Note.md', '# Gold\nGold and bullion pricing, plus commodity trends.\n');
    await engine.enrichNow('Note.md');
    expect(engine.suggestionsFor('Note.md').some((a) => a.kind === 'tag' && (a.payload as { name: string }).name === 'gold')).toBe(true);
  });
});

describe('VaultAiEngine — D18 localOnly', () => {
  it('a localOnly vault makes ZERO calls to a network backend', async () => {
    const net = new CountingClient(new MockAiClient(), 'anthropic', true);
    const router = new AiRouter([new MockAiClient(), net], { ...DEFAULT_ROUTING, enrich: 'anthropic' });
    await backend.writeNote(root, 'Secret.md', '# Secret\nSensitive banking notes.\n');
    const { engine } = await open({ router, localOnly: true });

    await engine.enrichNow('Secret.md'); // routed to network backend, but localOnly → blocked

    expect(net.enrichCalls).toBe(0); // never reached the network backend (D18)
  });

  it('a NON-localOnly vault DOES reach the routed network backend', async () => {
    const net = new CountingClient(new MockAiClient(), 'anthropic', true);
    const router = new AiRouter([new MockAiClient(), net], { ...DEFAULT_ROUTING, enrich: 'anthropic' });
    await backend.writeNote(root, 'Public.md', '# Public\nBanking notes.\n');
    const { engine } = await open({ router, localOnly: false });

    await engine.enrichNow('Public.md');
    expect(net.enrichCalls).toBe(1);
  });
});

// A backend that counts enrichNote calls and can masquerade as any id / network flag.
class CountingClient implements AiClient {
  enrichCalls = 0;
  capabilitiesCalls = 0;
  lastEnrichRequest: Parameters<AiClient['enrichNote']>[0] | undefined;
  available = true;
  constructor(
    private readonly inner: AiClient,
    readonly id: AiClient['id'] = 'mock',
    readonly isNetwork = false,
  ) {}
  get modelId() {
    return this.inner.modelId;
  }
  async capabilities() {
    this.capabilitiesCalls++;
    const caps = await this.inner.capabilities();
    return {
      ...caps,
      available: this.available,
      ...(this.available ? {} : { reason: 'test backend unavailable' }),
    };
  }
  summarize(req: Parameters<AiClient['summarize']>[0]) {
    return this.inner.summarize(req);
  }
  enrichNote(req: Parameters<AiClient['enrichNote']>[0]) {
    this.enrichCalls++;
    this.lastEnrichRequest = req;
    return this.inner.enrichNote(req);
  }
  labelSimilarity(req: Parameters<AiClient['labelSimilarity']>[0]) {
    return this.inner.labelSimilarity(req);
  }
}

class DuplicateResultClient implements AiClient {
  readonly id = 'mock' as const;
  readonly modelId = 'mock-duplicate@1';
  readonly isNetwork = false;

  async capabilities() {
    return { available: true, maxInputTokens: 8000, supportsGuidedJson: true, modelVersion: this.modelId };
  }
  async summarize() {
    return { summary: '' };
  }
  async enrichNote() {
    return {
      topics: [],
      links: [
        { target: 'Neighbor', targetPath: 'Neighbor.md', reason: 'Offline design is shared.', confidence: 0.55 },
        { target: 'Neighbor', targetPath: 'Neighbor.md', reason: 'Offline design is shared clearly.', confidence: 0.9 },
      ],
      tags: [],
      summary: null,
      aliases: [],
    };
  }
  async labelSimilarity() {
    return { related: false, reason: '', confidence: 0 };
  }
}

class EmptyResultClient implements AiClient {
  readonly id = 'mock' as const;
  readonly modelId = 'mock-empty@1';
  readonly isNetwork = false;
  enrichCalls = 0;

  async capabilities() {
    return { available: true, maxInputTokens: 8000, supportsGuidedJson: true, modelVersion: this.modelId };
  }
  async summarize() {
    return { summary: '' };
  }
  async enrichNote() {
    this.enrichCalls += 1;
    return { topics: [], links: [], tags: [], summary: null, aliases: [] };
  }
  async labelSimilarity() {
    return { related: false, reason: '', confidence: 0 };
  }
}

class LinksOnlyResultClient implements AiClient {
  readonly id = 'mock' as const;
  readonly modelId = 'mock-links-only@1';
  readonly isNetwork = false;

  async capabilities() {
    return { available: true, maxInputTokens: 8000, supportsGuidedJson: true, modelVersion: this.modelId };
  }
  async summarize() {
    return { summary: '' };
  }
  async enrichNote() {
    return {
      topics: [],
      links: [{ target: 'Neighbor', targetPath: 'Neighbor.md', reason: 'Both describe offline design.', confidence: 0.8 }],
      tags: [],
      summary: null,
      aliases: [],
    };
  }
  async labelSimilarity() {
    return { related: false, reason: '', confidence: 0 };
  }
}

// ── Architect checkpoint-B additions: S23 deferral + S28 consent (implementations existed
//    untested; these lock the two most race/trust-critical behaviors) ────────────────────

describe('VaultAiEngine — S23 dirty-buffer deferral (architect checkpoint B)', () => {
  it('never writes ai: frontmatter into a dirty open buffer; applies after the buffer is clean', async () => {
    let dirty = true;
    const clock = makeClock();
    const holder: { engine?: VaultAiEngine } = {};
    const repo = await Repository.openVault(backend, root, {
      now: clock.now,
      onIndexChange: (relPath, note) => holder.engine?.noteChanged(relPath, note),
    });
    const store = new AnnotationStore(
      { read: (p) => repo.readInternal(p), write: (p, c) => repo.writeInternal(p, c) },
      clock.now,
    );
    const engine = new VaultAiEngine(repo, new AiRouter([new MockAiClient()], DEFAULT_ROUTING), store, {
      now: clock.now,
      localOnly: () => false,
      threshold: () => 0.75,
      isDirty: () => dirty,
      disableTimers: true,
    });
    holder.engine = engine;
    await engine.attach();

    await repo.saveNote('Yen.md', '# Yen\nBOJ and interest rates.\n');
    await engine.enrichNow('Yen.md');
    await engine.settle();

    // Dirty buffer: the file must NOT have been touched by takeover (S23).
    expect(await repo.readNote('Yen.md')).not.toMatch(/^---/);

    // Buffer becomes clean; the deferred apply runs on the next trigger.
    dirty = false;
    await engine.enrichNow('Yen.md');
    await engine.settle();
    expect(await repo.readNote('Yen.md')).toMatch(/^---\n[\s\S]*\bai:/m);
  });
});

describe('VaultAiEngine — S28 consent gate (architect checkpoint B)', () => {
  it('pauses bulk takeover past the threshold, prompts once, and applies all on consent', async () => {
    const clock = makeClock();
    const consentPrompts: number[] = [];
    const holder: { engine?: VaultAiEngine } = {};
    const repo = await Repository.openVault(backend, root, {
      now: clock.now,
      onIndexChange: (relPath, note) => holder.engine?.noteChanged(relPath, note),
    });
    const store = new AnnotationStore(
      { read: (p) => repo.readInternal(p), write: (p, c) => repo.writeInternal(p, c) },
      clock.now,
    );
    const engine = new VaultAiEngine(repo, new AiRouter([new MockAiClient()], DEFAULT_ROUTING), store, {
      now: clock.now,
      localOnly: () => false,
      threshold: () => 0.5, // low threshold so every mock note takes over
      onConsentNeeded: (n) => consentPrompts.push(n),
      disableTimers: true,
    });
    holder.engine = engine;
    await engine.attach();

    // 25 bare notes (> CONSENT_THRESHOLD = 20), each with enrichable content.
    for (let i = 0; i < 25; i++) {
      await repo.saveNote(`n${i}.md`, `# Note ${i}\nBOJ banking policy and interest rates ${i}.\n`);
    }
    for (let i = 0; i < 25; i++) await engine.enrichNow(`n${i}.md`);
    await engine.settle();

    // Past the threshold the gate must have paused applies and prompted at least once.
    expect(consentPrompts.length).toBeGreaterThan(0);
    const withAi = async () => {
      let c = 0;
      for (let i = 0; i < 25; i++) if ((await repo.readNote(`n${i}.md`)).includes('ai:')) c++;
      return c;
    };
    const before = await withAi();
    expect(before).toBeLessThanOrEqual(20); // bulk apply held at the gate (S28)

    await engine.setTakeoverConsent('apply');
    await engine.settle();
    expect(await withAi()).toBe(25); // consent releases every held apply

    // The prompt is once-per-vault: consenting again is a no-op, no re-prompt storm.
    const prompts = consentPrompts.length;
    await engine.enrichNow('n0.md');
    await engine.settle();
    expect(consentPrompts.length).toBe(prompts);
  }, 15_000);
});
