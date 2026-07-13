import { describe, expect, it } from 'vitest';
import type { AiClient } from '../../src/services/aiClient';
import { suggestCaptureWithClients } from '../../src/services/captureSuggestions';

class FakeClient implements AiClient {
  readonly id = 'apple' as const;
  readonly modelId = 'fake@1';
  readonly isNetwork = false;
  available = true;
  capabilitiesCalls = 0;
  summarizeCalls = 0;
  enrichCalls = 0;

  async capabilities() {
    this.capabilitiesCalls += 1;
    return {
      available: this.available,
      reason: this.available ? undefined : 'model unavailable',
      maxInputTokens: 1000,
      supportsGuidedJson: true,
      modelVersion: this.modelId,
    };
  }

  async summarize() {
    this.summarizeCalls += 1;
    return { summary: 'A useful capture summary.' };
  }

  async enrichNote() {
    this.enrichCalls += 1;
    return {
      topics: [],
      links: [],
      tags: [{ name: 'capture', reason: 'A capture tag.', confidence: 0.8 }],
      summary: null,
      aliases: [],
    };
  }

  async labelSimilarity() {
    return { related: false, reason: '', confidence: 0 };
  }
}

describe('suggestCaptureWithClients', () => {
  it('does not generate when a routed backend is unavailable', async () => {
    const client = new FakeClient();
    client.available = false;

    const result = await suggestCaptureWithClients(client, client, 'Long text', 'Long text');

    expect(result.suggestion).toEqual({ title: 'Long text', summary: '', tags: [] });
    expect(result.unavailable?.reason).toBe('model unavailable');
    expect(client.capabilitiesCalls).toBe(1);
    expect(client.summarizeCalls).toBe(0);
    expect(client.enrichCalls).toBe(0);
  });

  it('runs both capture suggestions after one available preflight', async () => {
    const client = new FakeClient();

    await expect(suggestCaptureWithClients(client, client, 'Long text', 'Long text')).resolves.toEqual({
      suggestion: {
        title: 'A useful capture summary.',
        summary: 'A useful capture summary.',
        tags: ['capture'],
      },
    });
    expect(client.capabilitiesCalls).toBe(1);
    expect(client.summarizeCalls).toBe(1);
    expect(client.enrichCalls).toBe(1);
  });
});
