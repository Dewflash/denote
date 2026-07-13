// src/services/aiClient/anthropic.ts — the paid Anthropic backend (D13/pass-9). Network-class
// (isNetwork=true), so the router (router.ts) refuses it for a localOnly vault (D18); the corpus
// assembler (state/deepOrganize.ts) refuses it a SECOND time, defense in depth (S27).
//
// Two surfaces sit behind one injectable `AnthropicTransport` (mirrors apple.ts's SidecarTransport
// so this module is node-testable with no `@anthropic-ai/sdk` and no network):
//   - the per-note AiClient methods (summarize / enrichNote / labelSimilarity) — used when a task
//     is routed to `anthropic` in settings;
//   - the Batch API + count_tokens transport that the deep-organize orchestrator drives directly.
// Model IDs + pricing live in pricing.ts (S19); nothing here hardcodes a rate.

import { normalizeTag } from './apple';
import type { AnthropicModelId, TokenUsage } from './pricing';
import { DEFAULT_DEEP_MODEL } from './pricing';
import type {
  AiCapabilities,
  AiClient,
  EnrichRequest,
  EnrichResult,
  LabelSimilarityRequest,
  NoteStub,
  SuggestedLink,
  SuggestedTag,
  SuggestedTopic,
  SummarizeRequest,
} from './types';

/** A cacheable system-prompt block (prompt caching: stable prefix marked ephemeral). */
export interface CacheableText {
  text: string;
  cache?: boolean;
}

export interface AnthropicMessageRequest {
  model: AnthropicModelId;
  system?: CacheableText[];
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
  /** When set, requested via `output_config.format` (structured JSON outputs). */
  jsonSchema?: Record<string, unknown>;
}

export interface AnthropicMessageResponse {
  /** Concatenated text blocks (or the JSON string when a schema was requested). */
  text: string;
  usage: TokenUsage;
  stopReason: string | null;
  /** True when `stop_reason === 'refusal'` (safety classifier / model decline). */
  refused: boolean;
}

export interface BatchRequestItem {
  customId: string;
  model: AnthropicModelId;
  system?: CacheableText[];
  messages: { role: 'user'; content: string }[];
  maxTokens: number;
  jsonSchema?: Record<string, unknown>;
}

/** Anthropic Batch API lifecycle (`processing_status`). */
export type BatchLifecycle = 'in_progress' | 'ended' | 'canceling';

export interface BatchResultItem {
  customId: string;
  type: 'succeeded' | 'errored' | 'canceled' | 'expired';
  text?: string;
  usage?: TokenUsage;
  errorDetail?: string;
}

export interface AnthropicTransport {
  /** Single message (per-note tasks + on-demand insights). Streams internally for long outputs. */
  createMessage(req: AnthropicMessageRequest): Promise<AnthropicMessageResponse>;
  /** `count_tokens` — free endpoint, verifies the assembled batch before submission (S27). */
  countTokens(req: AnthropicMessageRequest): Promise<{ inputTokens: number }>;
  /** Submit a batch (50% rates, D13). Returns the batch id BEFORE any polling (S27 durability). */
  createBatch(requests: BatchRequestItem[]): Promise<{ batchId: string }>;
  retrieveBatch(batchId: string): Promise<{ status: BatchLifecycle }>;
  /** Fetch results (unordered — keyed by customId, S27). Empty until status is `ended`. */
  batchResults(batchId: string): Promise<BatchResultItem[]>;
  /** A cheap round-trip that verifies the stored key ("test key" button). Never throws. */
  testKey(): Promise<{ ok: boolean; detail?: string }>;
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

/** Per-task model tiers (D13 routing table exposes model choice). Deep-organize defaults to opus. */
export interface AnthropicModels {
  summarize: AnthropicModelId;
  enrich: AnthropicModelId;
  labelSimilarity: AnthropicModelId;
  deepOrganize: AnthropicModelId;
}

export const DEFAULT_ANTHROPIC_MODELS: AnthropicModels = {
  summarize: 'claude-haiku-4-5',
  labelSimilarity: 'claude-haiku-4-5',
  enrich: 'claude-sonnet-5',
  deepOrganize: DEFAULT_DEEP_MODEL,
};

// ── structured-output JSON schemas (output_config.format) ─────────────────────────────
// No minLength/maxLength/numeric constraints (structured-output limitation); additionalProperties
// false on every object (required).

const suggestionItem = (extra: Record<string, unknown> = {}) => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    reason: { type: 'string' },
    confidence: { type: 'number' },
    ...extra,
  },
  required: ['name', 'reason', 'confidence', ...Object.keys(extra)],
});

export const ENRICH_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    topics: { type: 'array', items: suggestionItem({ parentName: { type: 'string' } }) },
    links: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { target: { type: 'string' }, reason: { type: 'string' }, confidence: { type: 'number' } },
        required: ['target', 'reason', 'confidence'],
      },
    },
    tags: { type: 'array', items: suggestionItem() },
    summary: { type: 'string' },
  },
  required: ['topics', 'links', 'tags', 'summary'],
};

const LABEL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    related: { type: 'boolean' },
    reason: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['related', 'reason', 'confidence'],
};

function resolveLinkTarget(target: string, candidates: NoteStub[]): { target: string; targetPath?: string } {
  const t = target.trim().toLowerCase();
  const hit = candidates.find((c) => {
    const title = c.title.toLowerCase();
    return t === title || t.startsWith(`${title}:`) || t.startsWith(`${title}#`);
  });
  return hit ? { target: hit.title, targetPath: hit.relPath } : { target: target.trim() };
}

interface RawEnrich {
  topics?: { name?: string; reason?: string; confidence?: number; parentName?: string }[];
  links?: { target?: string; reason?: string; confidence?: number }[];
  tags?: { name?: string; reason?: string; confidence?: number }[];
  summary?: string;
}

/** Parse a model JSON string tolerantly (structured output is valid JSON; be defensive anyway). */
export function safeJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const ENRICH_SYSTEM =
  'You organize a personal Markdown knowledge base. Given a note plus the vault\'s existing ' +
  'topics and neighbor notes, propose topics to attach it to (reuse an EXISTING topic name ' +
  'verbatim when one fits — do not invent a near-duplicate), wikilinks to specific neighbor ' +
  'notes that share a concrete concept, and tags. Every item needs a specific, non-generic ' +
  'reason and a confidence 0..1. Only propose a link when the notes share a NAMED concept, ' +
  'never mere topical adjacency. Reply as JSON matching the schema.';

export class AnthropicAiClient implements AiClient {
  readonly id = 'anthropic' as const;
  readonly isNetwork = true;
  readonly modelId: string;

  constructor(
    private readonly transport: AnthropicTransport,
    private readonly models: AnthropicModels = DEFAULT_ANTHROPIC_MODELS,
  ) {
    // D26 hash-gating keys on modelId — the enrich model is the annotation source.
    this.modelId = `anthropic:${models.enrich}`;
  }

  async capabilities(): Promise<AiCapabilities> {
    const key = await this.transport.testKey();
    return {
      available: key.ok,
      reason: key.ok ? undefined : key.detail ?? 'No API key set.',
      maxInputTokens: 180_000, // generous; the funnel (D12) never sends whole vaults anyway
      supportsGuidedJson: true,
      modelVersion: this.modelId,
    };
  }

  async summarize(req: SummarizeRequest): Promise<{ summary: string }> {
    const res = await this.transport.createMessage({
      model: this.models.summarize,
      maxTokens: 512,
      messages: [
        { role: 'user', content: `Summarize the following note in at most ${req.maxWords} words. Reply with only the summary.\n\n${req.text}` },
      ],
    });
    return { summary: res.refused ? '' : res.text.trim() };
  }

  async enrichNote(req: EnrichRequest): Promise<EnrichResult> {
    const existing = req.existingTopics.map((t) => `- ${t.name}${t.description ? `: ${t.description}` : ''}`).join('\n') || '(none yet)';
    const candidates = req.candidateNotes.map((c) => `- ${c.title}${c.summary ? `: ${c.summary}` : ''}`).join('\n') || '(none)';
    const user =
      `Note title: ${req.title}\nFolder: ${req.folderPath || '(root)'}\n\n` +
      `Existing topics:\n${existing}\n\nNeighbor notes:\n${candidates}\n\n---\n${req.text}`;

    const res = await this.transport.createMessage({
      model: this.models.enrich,
      maxTokens: 1500,
      system: [{ text: ENRICH_SYSTEM, cache: true }],
      messages: [{ role: 'user', content: user }],
      jsonSchema: ENRICH_SCHEMA,
    });
    if (res.refused) return { topics: [], links: [], tags: [], summary: null, aliases: [] };
    const raw = safeJson<RawEnrich>(res.text) ?? {};

    const topics: SuggestedTopic[] = (raw.topics ?? [])
      .filter((t) => (t.name ?? '').trim())
      .map((t) => {
        const name = t.name!.trim();
        const match = req.existingTopics.find((e) => e.name.toLowerCase() === name.toLowerCase());
        return {
          name,
          existingTopicId: match?.id ?? null,
          reason: (t.reason ?? '').trim(),
          confidence: clamp01(t.confidence ?? 0),
          ...(t.parentName?.trim() ? { parentName: t.parentName.trim() } : {}),
        };
      });
    const tags: SuggestedTag[] = (raw.tags ?? [])
      .map((t) => ({ name: normalizeTag(t.name ?? ''), reason: (t.reason ?? '').trim(), confidence: clamp01(t.confidence ?? 0) }))
      .filter((t) => t.name.length > 0);
    const links: SuggestedLink[] = (raw.links ?? [])
      .filter((l) => (l.target ?? '').trim())
      .map((l) => ({ ...resolveLinkTarget(l.target!, req.candidateNotes), reason: (l.reason ?? '').trim(), confidence: clamp01(l.confidence ?? 0) }))
      // Candidate retrieval is the source of truth for AI links. Unknown model targets should
      // not become ghost nodes; ghosts represent wikilinks the user authored.
      .filter((l) => l.targetPath !== undefined);
    const summaryText = (raw.summary ?? '').trim();

    return {
      topics,
      links,
      tags,
      summary: summaryText ? { text: summaryText, reason: 'Cloud one-sentence summary.', confidence: 0.85 } : null,
      aliases: [],
    };
  }

  async labelSimilarity(req: LabelSimilarityRequest): Promise<{ related: boolean; reason: string; confidence: number }> {
    const res = await this.transport.createMessage({
      model: this.models.labelSimilarity,
      maxTokens: 400,
      messages: [
        {
          role: 'user',
          content:
            'Do these two notes share a SPECIFIC concept (not just topical adjacency or shared language)? ' +
            'Reply JSON {related, reason, confidence}. The reason must name the concrete shared concept.\n\n' +
            `A) ${req.a.title}: ${req.a.summary ?? ''}\n\nB) ${req.b.title}: ${req.b.summary ?? ''}`,
        },
      ],
      jsonSchema: LABEL_SCHEMA,
    });
    if (res.refused) return { related: false, reason: '', confidence: 0 };
    const raw = safeJson<{ related?: boolean; reason?: string; confidence?: number }>(res.text) ?? {};
    return { related: raw.related === true, reason: (raw.reason ?? '').trim(), confidence: clamp01(raw.confidence ?? 0) };
  }
}

// ── production transport over `@anthropic-ai/sdk` (not unit-tested — tests inject a mock) ──────

/** Build the real transport. `getKey` fetches the BYO key from the macOS Keychain (D13); the SDK
 *  client is rebuilt lazily so a key change (or first entry) takes effect without an app restart. */
export function createAnthropicTransport(getKey: () => Promise<string | null>): AnthropicTransport {
  type SdkClient = {
    messages: {
      create: (p: Record<string, unknown>) => Promise<{ content: { type: string; text?: string }[]; usage: { input_tokens: number; output_tokens: number }; stop_reason: string | null }>;
      stream: (p: Record<string, unknown>) => { finalMessage: () => Promise<{ content: { type: string; text?: string }[]; usage: { input_tokens: number; output_tokens: number }; stop_reason: string | null }> };
      countTokens: (p: Record<string, unknown>) => Promise<{ input_tokens: number }>;
      batches: {
        create: (p: { requests: { custom_id: string; params: Record<string, unknown> }[] }) => Promise<{ id: string }>;
        retrieve: (id: string) => Promise<{ processing_status: BatchLifecycle }>;
        results: (id: string) => AsyncIterable<{ custom_id: string; result: { type: string; message?: { content: { type: string; text?: string }[]; usage: { input_tokens: number; output_tokens: number } }; error?: { type?: string } } }>;
      };
    };
  };

  async function client(): Promise<SdkClient> {
    const key = await getKey();
    if (!key) throw new Error('no-anthropic-key');
    const mod = (await import('@anthropic-ai/sdk')) as unknown as { default: new (o: { apiKey: string }) => SdkClient };
    return new mod.default({ apiKey: key });
  }

  const toParams = (req: AnthropicMessageRequest | BatchRequestItem): Record<string, unknown> => {
    const p: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens,
      messages: req.messages,
    };
    if (req.system?.length) {
      p.system = req.system.map((s) => ({ type: 'text', text: s.text, ...(s.cache ? { cache_control: { type: 'ephemeral' } } : {}) }));
    }
    if (req.jsonSchema) p.output_config = { format: { type: 'json_schema', schema: req.jsonSchema } };
    return p;
  };

  const readText = (content: { type: string; text?: string }[]): string =>
    content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');

  return {
    async createMessage(req) {
      const c = await client();
      const params = toParams(req);
      // Stream for large outputs so we don't hit HTTP timeouts (claude-api guidance).
      const msg = req.maxTokens > 16_000 ? await c.messages.stream(params).finalMessage() : await c.messages.create(params);
      return {
        text: readText(msg.content),
        usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens },
        stopReason: msg.stop_reason,
        refused: msg.stop_reason === 'refusal',
      };
    },
    async countTokens(req) {
      const c = await client();
      const params = toParams(req);
      delete params.max_tokens;
      const res = await c.messages.countTokens(params);
      return { inputTokens: res.input_tokens };
    },
    async createBatch(requests) {
      const c = await client();
      const res = await c.messages.batches.create({
        requests: requests.map((r) => ({ custom_id: r.customId, params: toParams(r) })),
      });
      return { batchId: res.id };
    },
    async retrieveBatch(batchId) {
      const c = await client();
      const res = await c.messages.batches.retrieve(batchId);
      return { status: res.processing_status };
    },
    async batchResults(batchId) {
      const c = await client();
      const out: BatchResultItem[] = [];
      for await (const r of c.messages.batches.results(batchId)) {
        if (r.result.type === 'succeeded' && r.result.message) {
          out.push({
            customId: r.custom_id,
            type: 'succeeded',
            text: readText(r.result.message.content),
            usage: { inputTokens: r.result.message.usage.input_tokens, outputTokens: r.result.message.usage.output_tokens },
          });
        } else {
          out.push({ customId: r.custom_id, type: (r.result.type as BatchResultItem['type']) ?? 'errored', errorDetail: r.result.error?.type });
        }
      }
      return out;
    },
    async testKey() {
      try {
        const c = await client();
        await c.messages.countTokens({ model: DEFAULT_DEEP_MODEL, messages: [{ role: 'user', content: 'ping' }] });
        return { ok: true };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
