// Pass-06 tests: the mock backend is deterministic and plausible; the router enforces D18.

import { describe, expect, it } from 'vitest';
import { MockAiClient } from '../../src/services/aiClient/mock';
import { AiRouter, DEFAULT_ROUTING } from '../../src/services/aiClient/router';
import type { AiClient, EnrichRequest } from '../../src/services/aiClient/types';
import { DenoteError } from '../../src/services/errors';

const enrichReq = (over: Partial<EnrichRequest> = {}): EnrichRequest => ({
  text: 'The BOJ intervened to defend the yen as interest rates diverged.',
  title: 'Yen Intervention',
  folderPath: 'daily-learnings/Inbox',
  existingTopics: [],
  candidateNotes: [
    { relPath: 'daily-learnings/Economics/Interest Rates.md', title: 'Interest Rates' },
    { relPath: 'daily-learnings/Japan/Miso Soup Recipe.md', title: 'Miso Soup Recipe' },
  ],
  ...over,
});

describe('MockAiClient', () => {
  const mock = new MockAiClient();

  it('is deterministic — same content yields identical output', async () => {
    const a = await mock.enrichNote(enrichReq());
    const b = await mock.enrichNote(enrichReq());
    expect(a).toEqual(b);
  });

  it('emits concept-relevant tags/topics with specific reasons and varied confidence', async () => {
    const res = await mock.enrichNote(enrichReq());
    const tagNames = res.tags.map((t) => t.name);
    expect(tagNames).toContain('japan');
    expect(tagNames).toContain('interest-rates');
    // At least one tag is above the 0.75 takeover threshold, and the folder tag is below it.
    expect(res.tags.some((t) => t.confidence >= 0.75)).toBe(true);
    expect(res.tags.some((t) => t.confidence < 0.75)).toBe(true);
    // Every reason is specific (>= 15 chars) — no vacuous "related content".
    for (const t of [...res.tags, ...res.topics]) expect(t.reason.length).toBeGreaterThanOrEqual(15);
  });

  it('suggests links that point at real candidate notes (resolvable)', async () => {
    const res = await mock.enrichNote(enrichReq());
    expect(res.links.length).toBeGreaterThan(0);
    for (const l of res.links) {
      expect(l.targetPath).toBeDefined();
      expect(res.links.map(() => l.reason.length).every((n) => n >= 15)).toBe(true);
    }
    // The interest-rates neighbor shares a concept; the miso soup note does not.
    expect(res.links.some((l) => l.target === 'Interest Rates')).toBe(true);
    expect(res.links.some((l) => l.target === 'Miso Soup Recipe')).toBe(false);
  });

  it('labelSimilarity passes the vacuity gate only on a real shared concept', async () => {
    const related = await mock.labelSimilarity({
      a: { relPath: 'a.md', title: 'Yen Intervention', summary: 'BOJ and the yen' },
      b: { relPath: 'b.md', title: 'Interest Rates', summary: 'central bank rate policy' },
    });
    expect(related.related).toBe(true);
    expect(related.reason.length).toBeGreaterThanOrEqual(15);

    const unrelated = await mock.labelSimilarity({
      a: { relPath: 'a.md', title: 'Yen Intervention', summary: 'BOJ and the yen' },
      b: { relPath: 'b.md', title: 'Miso Soup Recipe', summary: 'broth and tofu' },
    });
    expect(unrelated.related).toBe(false);
  });
});

// A fake network-class backend to prove the D18 boundary without a real Anthropic client.
class FakeNetworkClient implements AiClient {
  readonly id = 'anthropic' as const;
  readonly modelId = 'fake-net@1';
  readonly isNetwork = true;
  calls = 0;
  async capabilities() {
    this.calls++;
    return { available: true, maxInputTokens: 100000, supportsGuidedJson: true, modelVersion: this.modelId };
  }
  async summarize() {
    this.calls++;
    return { summary: 'x' };
  }
  async enrichNote() {
    this.calls++;
    return { topics: [], links: [], tags: [], summary: null, aliases: [] };
  }
  async labelSimilarity() {
    this.calls++;
    return { related: false, reason: '', confidence: 0 };
  }
}

describe('AiRouter (D18)', () => {
  it('routes to the local mock by default', () => {
    const router = new AiRouter([new MockAiClient()]);
    expect(router.route('enrich', { localOnly: false }).id).toBe('mock');
    expect(router.route('enrich', { localOnly: true }).id).toBe('mock'); // mock is local → allowed
  });

  it('refuses a network backend for a localOnly vault (no network call ever happens)', () => {
    const net = new FakeNetworkClient();
    const router = new AiRouter([new MockAiClient(), net], { ...DEFAULT_ROUTING, enrich: 'anthropic' });

    expect(() => router.route('enrich', { localOnly: true })).toThrowError(DenoteError);
    try {
      router.route('enrich', { localOnly: true });
    } catch (e) {
      expect((e as DenoteError).kind).toBe('local-only-blocked');
    }
    expect(net.calls).toBe(0);

    // A non-localOnly vault CAN use it.
    expect(router.route('enrich', { localOnly: false }).id).toBe('anthropic');
  });

  it('throws ai-unavailable when the routed backend is not registered', () => {
    const router = new AiRouter([new MockAiClient()], { ...DEFAULT_ROUTING, enrich: 'apple' });
    try {
      router.route('enrich', { localOnly: false });
      throw new Error('expected throw');
    } catch (e) {
      expect((e as DenoteError).kind).toBe('ai-unavailable');
    }
  });
});
