// AppleAiClient shaping tests — the sidecar transport is mocked (no Tauri, no model). Verifies
// tag normalization (S3), link-target resolution (S4), token budgeting (S16), and result mapping.
import { describe, expect, it, vi } from 'vitest';
import { AppleAiClient, normalizeTag } from '../../src/services/aiClient/apple';
import type { SidecarTransport } from '../../src/services/aiClient/apple';
import type { AiCapabilities } from '../../src/services/aiClient';

function transport(handlers: Partial<Record<string, unknown>>): SidecarTransport {
  return {
    call: vi.fn(async (method: string) => handlers[method] ?? {}),
    capabilities: vi.fn(async (): Promise<AiCapabilities> => ({
      available: true,
      maxInputTokens: 4000,
      supportsGuidedJson: true,
      modelVersion: 'apple-fm@1',
    })),
  };
}

describe('normalizeTag (S3)', () => {
  it('lowercases, strips #, and hyphenates invalid chars', () => {
    expect(normalizeTag('Central Banks')).toBe('central-banks');
    expect(normalizeTag('#Interest Rates!')).toBe('interest-rates');
    expect(normalizeTag('de/dollarization')).toBe('de/dollarization');
  });
});

describe('AppleAiClient.enrichNote', () => {
  it('normalizes tags, resolves link targets to candidates, clamps confidence', async () => {
    const t = transport({
      enrichNote: {
        topics: [{ name: 'Banking', reason: 'BOJ balance-sheet policy discussion.', confidence: 1 }],
        links: [{ target: 'Fed Rate Decision: US raises rates', reason: 'Both cover central-bank rate policy.', confidence: 0.8 }],
        tags: [{ name: 'Central Banks', reason: 'central bank actions', confidence: 1.4 }],
        summary: 'BOJ intervened in the yen market.',
      },
    });
    const client = new AppleAiClient(t);
    const res = await client.enrichNote({
      text: 'The Bank of Japan intervened.',
      title: 'BOJ Yen Intervention',
      folderPath: 'Finance/Japan',
      existingTopics: [{ id: 'topic-1', name: 'Banking' }],
      candidateNotes: [{ relPath: 'Finance/Fed Rate Decision.md', title: 'Fed Rate Decision' }],
    });

    expect(res.tags[0].name).toBe('central-banks');
    expect(res.tags[0].confidence).toBe(1); // clamped from 1.4
    expect(res.topics[0].existingTopicId).toBe('topic-1'); // matched existing
    expect(res.links[0].target).toBe('Fed Rate Decision');
    expect(res.links[0].targetPath).toBe('Finance/Fed Rate Decision.md');
    expect(res.summary?.text).toBe('BOJ intervened in the yen market.');
  });
});

describe('AppleAiClient.summarize', () => {
  it('budgets (truncates) the input text before sending', async () => {
    const t = transport({ summarize: { summary: 'ok' } });
    const client = new AppleAiClient(t, 100); // tiny budget
    const long = 'word '.repeat(2000);
    await client.summarize({ text: long, maxWords: 20 });
    const sent = (t.call as ReturnType<typeof vi.fn>).mock.calls[0][1] as { text: string };
    expect(sent.text.length).toBeLessThan(long.length);
  });
});

describe('AppleAiClient.labelSimilarity', () => {
  it('maps the sidecar shape and coerces missing fields', async () => {
    const t = transport({ labelSimilarity: { related: true, reason: 'Both cover BOJ policy.', confidence: 0.82 } });
    const client = new AppleAiClient(t);
    const out = await client.labelSimilarity({
      a: { relPath: 'a.md', title: 'A' },
      b: { relPath: 'b.md', title: 'B' },
    });
    expect(out).toEqual({ related: true, reason: 'Both cover BOJ policy.', confidence: 0.82 });
  });

  it('is local (never network) so localOnly vaults may use it', () => {
    const client = new AppleAiClient(transport({}));
    expect(client.isNetwork).toBe(false);
    expect(client.id).toBe('apple');
  });
});
