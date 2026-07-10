// Pass-06 integration tests: the full AI loop against a REAL Repository over a temp-dir vault
// (no Tauri), driven with the deterministic mock backend. Covers the R1 loop guarantee, takeover
// apply/demote (S10), accept/reject + rejection memory (D10/S11), the accept undo op (D38), and
// the D18 localOnly boundary (zero network-backend calls).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Repository } from '../../src/state/repository';
import { VaultAiEngine } from '../../src/state/vaultAiEngine';
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

async function open(opts: { router?: AiRouter; localOnly?: boolean } = {}): Promise<Harness> {
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
    pushOp: (op) => ops.push(op),
    disableTimers: true, // drive enrichNow() explicitly for determinism
  });
  holder.engine = engine;
  await engine.attach();
  return { repo, engine, ops, clock };
}

describe('VaultAiEngine — enrichment + takeover', () => {
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
  constructor(
    private readonly inner: AiClient,
    readonly id: AiClient['id'] = 'mock',
    readonly isNetwork = false,
  ) {}
  get modelId() {
    return this.inner.modelId;
  }
  capabilities() {
    return this.inner.capabilities();
  }
  summarize(req: Parameters<AiClient['summarize']>[0]) {
    return this.inner.summarize(req);
  }
  enrichNote(req: Parameters<AiClient['enrichNote']>[0]) {
    this.enrichCalls++;
    return this.inner.enrichNote(req);
  }
  labelSimilarity(req: Parameters<AiClient['labelSimilarity']>[0]) {
    return this.inner.labelSimilarity(req);
  }
}
