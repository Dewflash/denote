// AnthropicAiClient shaping + the D18 router boundary for the cloud backend. Transport is mocked
// (no @anthropic-ai/sdk, no network).
import { describe, expect, it, vi } from 'vitest';
import { AnthropicAiClient } from '../../src/services/aiClient/anthropic';
import type { AnthropicTransport, AnthropicMessageResponse } from '../../src/services/aiClient/anthropic';
import { AiRouter, APPLE_ROUTING } from '../../src/services/aiClient/router';
import { MockAiClient } from '../../src/services/aiClient/mock';
import { DenoteError } from '../../src/services/errors';

function transport(text: string, opts: { refused?: boolean } = {}): AnthropicTransport {
  const res: AnthropicMessageResponse = {
    text,
    usage: { inputTokens: 100, outputTokens: 50 },
    stopReason: opts.refused ? 'refusal' : 'end_turn',
    refused: !!opts.refused,
  };
  return {
    createMessage: vi.fn(async () => res),
    countTokens: vi.fn(async () => ({ inputTokens: 42 })),
    createBatch: vi.fn(async () => ({ batchId: 'b' })),
    retrieveBatch: vi.fn(async () => ({ status: 'ended' as const })),
    batchResults: vi.fn(async () => []),
    testKey: vi.fn(async () => ({ ok: true })),
  };
}

describe('AnthropicAiClient', () => {
  it('is network-class (isNetwork=true) so the router blocks it for localOnly vaults', () => {
    const c = new AnthropicAiClient(transport('{}'));
    expect(c.isNetwork).toBe(true);
    expect(c.id).toBe('anthropic');
    expect(c.modelId).toContain('anthropic:');
  });

  it('parses structured enrich output, resolves links to candidates, normalizes tags', async () => {
    const json = JSON.stringify({
      topics: [{ name: 'Banking', reason: 'Discusses BOJ balance-sheet policy.', confidence: 0.9 }],
      links: [{ target: 'Fed Rate Decision', reason: 'Both cover central-bank rate policy.', confidence: 0.8 }],
      tags: [{ name: 'Central Banks', reason: 'central bank actions', confidence: 1.5 }],
      summary: 'BOJ intervened in the yen market.',
    });
    const c = new AnthropicAiClient(transport(json));
    const res = await c.enrichNote({
      text: 'The Bank of Japan intervened.',
      title: 'BOJ Yen Intervention',
      folderPath: 'Finance/Japan',
      existingTopics: [{ id: 't1', name: 'Banking' }],
      candidateNotes: [{ relPath: 'Finance/Fed Rate Decision.md', title: 'Fed Rate Decision' }],
    });
    expect(res.topics[0].existingTopicId).toBe('t1');
    expect(res.tags[0].name).toBe('central-banks');
    expect(res.tags[0].confidence).toBe(1); // clamped
    expect(res.links[0].targetPath).toBe('Finance/Fed Rate Decision.md');
    expect(res.summary?.text).toBe('BOJ intervened in the yen market.');
  });

  it('drops model links that do not resolve to a retrieved candidate note', async () => {
    const c = new AnthropicAiClient(transport(JSON.stringify({
      links: [{ target: 'Invented topic', reason: 'unsupported', confidence: 0.99 }],
    })));
    const res = await c.enrichNote({
      text: 'A note.',
      title: 'Current note',
      folderPath: '',
      existingTopics: [],
      candidateNotes: [{ relPath: 'Known.md', title: 'Known' }],
    });

    expect(res.links).toEqual([]);
  });

  it('does not resolve a candidate when its title is only a prefix of the target', async () => {
    const c = new AnthropicAiClient(transport(JSON.stringify({
      links: [{ target: 'Banking policy', reason: 'unsupported', confidence: 0.99 }],
    })));
    const res = await c.enrichNote({
      text: 'A note.',
      title: 'Current note',
      folderPath: '',
      existingTopics: [],
      candidateNotes: [{ relPath: 'Bank.md', title: 'Bank' }],
    });

    expect(res.links).toEqual([]);
  });

  it('returns an empty result on a safety refusal instead of throwing', async () => {
    const c = new AnthropicAiClient(transport('', { refused: true }));
    const res = await c.enrichNote({ text: 'x', title: 'X', folderPath: '', existingTopics: [], candidateNotes: [] });
    expect(res.topics).toEqual([]);
    expect(res.summary).toBeNull();
  });
});

describe('D18 recheck — anthropic backend specifically', () => {
  it('a localOnly vault can never obtain the network anthropic client', () => {
    const router = new AiRouter([new MockAiClient(), new AnthropicAiClient(transport('{}'))], {
      ...APPLE_ROUTING,
      enrich: 'anthropic',
    });
    // Non-local vault → gets the client.
    expect(router.route('enrich', { localOnly: false }).id).toBe('anthropic');
    // Local-only vault → typed refusal, no client.
    expect(() => router.route('enrich', { localOnly: true })).toThrowError(DenoteError);
    try {
      router.route('enrich', { localOnly: true });
    } catch (err) {
      expect((err as DenoteError).kind).toBe('local-only-blocked');
    }
  });
});
