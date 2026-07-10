// src/services/aiClient/apple.ts — the Apple Foundation Models backend (D11/pass-7). Talks to the
// Swift sidecar via the Rust supervisor (src-tauri/src/sidecar.rs) through two Tauri commands:
// `sidecar_call` (summarize/enrichNote/labelSimilarity) and `sidecar_capabilities`. Local, never
// network (isNetwork=false) — always allowed even for localOnly vaults (D18).
//
// The sidecar does guided/structured generation; this client shapes the transport JSON into the
// AiClient contract: it budgets input tokens (S16), normalizes model-produced tags to valid tag
// tokens (S3), and resolves link targets back to the candidate notes that were offered (S4).

import {
  capWords,
  enrichBudget,
  estimateTokens,
  truncateToBudget,
} from '../../domain/tokenBudget';
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

export const APPLE_MODEL_ID = 'apple-fm@1';
/** Conservative default; the sidecar reports the real value via capabilities(). */
const DEFAULT_MAX_INPUT_TOKENS = 4000;

/** The transport the client needs — injectable so tests drive it without a Tauri runtime. */
export interface SidecarTransport {
  /** Invoke a sidecar method; resolves the raw `result` JSON or rejects with a transport error. */
  call(method: string, params: unknown): Promise<unknown>;
  /** capabilities(); `retry` clears a prior disabled state (manual retry). Never rejects hard. */
  capabilities(retry?: boolean): Promise<AiCapabilities>;
}

/** The production transport over the two Rust commands. Lazy `@tauri-apps` import so this module
 *  is importable in node tests (which inject a mock transport instead). */
export function createTauriSidecarTransport(): SidecarTransport {
  const invoke = <T>(cmd: string, args: Record<string, unknown>): Promise<T> =>
    import('@tauri-apps/api/core').then((m) => m.invoke<T>(cmd, args));
  return {
    call: (method, params) => invoke<unknown>('sidecar_call', { method, params }),
    capabilities: (retry) => invoke<AiCapabilities>('sidecar_capabilities', { retry: retry ?? false }),
  };
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

/** Normalize a model-produced tag into a valid tag token (S3: lowercased, `[\p{L}\p{N}_/-]`). */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{N}_/-]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/** Resolve a model's free-text link target back to one of the candidate notes it was shown, so
 *  the suggestion writes a resolvable `[[wikilink]]` (S4). Falls back to the raw target. */
function resolveLinkTarget(
  target: string,
  candidates: NoteStub[],
): { target: string; targetPath?: string } {
  const t = target.trim().toLowerCase();
  const hit = candidates.find(
    (c) => t === c.title.toLowerCase() || t.startsWith(c.title.toLowerCase() + ':') || t.startsWith(c.title.toLowerCase()),
  );
  return hit ? { target: hit.title, targetPath: hit.relPath } : { target: target.trim() };
}

interface RawEnrich {
  topics?: { name?: string; reason?: string; confidence?: number }[];
  links?: { target?: string; reason?: string; confidence?: number }[];
  tags?: { name?: string; reason?: string; confidence?: number }[];
  summary?: string;
}

export class AppleAiClient implements AiClient {
  readonly id = 'apple' as const;
  readonly modelId = APPLE_MODEL_ID;
  readonly isNetwork = false;

  constructor(
    private readonly transport: SidecarTransport,
    private readonly maxInputTokens: number = DEFAULT_MAX_INPUT_TOKENS,
  ) {}

  capabilities(): Promise<AiCapabilities> {
    return this.transport.capabilities();
  }

  /** Manual retry after the sidecar was disabled (S13); returns fresh capabilities. */
  retry(): Promise<AiCapabilities> {
    return this.transport.capabilities(true);
  }

  async summarize(req: SummarizeRequest): Promise<{ summary: string }> {
    const text = truncateToBudget(req.text, Math.floor(this.maxInputTokens * 0.85));
    const res = (await this.transport.call('summarize', { text, maxWords: req.maxWords })) as {
      summary?: string;
    };
    return { summary: (res?.summary ?? '').trim() };
  }

  async enrichNote(req: EnrichRequest): Promise<EnrichResult> {
    const budget = enrichBudget(this.maxInputTokens);
    const text = truncateToBudget(req.text, budget.bodyTokens);
    // Trim stubs to their S16 word caps + drop lowest-similarity candidates until under budget.
    const existingTopics = req.existingTopics.map((t) => ({
      name: t.name,
      description: t.description ? capWords(t.description, 20) : undefined,
      memberTitles: t.memberTitles?.slice(0, 3),
    }));
    const candidateNotes = trimCandidates(req.candidateNotes, budget.candidatesTokens);

    const raw = (await this.transport.call('enrichNote', {
      text,
      title: req.title,
      folderPath: req.folderPath,
      existingTopics,
      candidateNotes,
    })) as RawEnrich;

    const topics: SuggestedTopic[] = (raw.topics ?? [])
      .filter((t) => (t.name ?? '').trim().length > 0)
      .map((t) => {
        const name = t.name!.trim();
        const existing = req.existingTopics.find((e) => e.name.toLowerCase() === name.toLowerCase());
        return {
          name,
          existingTopicId: existing?.id ?? null,
          reason: (t.reason ?? '').trim(),
          confidence: clamp01(t.confidence ?? 0),
        };
      });

    const tags: SuggestedTag[] = (raw.tags ?? [])
      .map((t) => ({ name: normalizeTag(t.name ?? ''), reason: (t.reason ?? '').trim(), confidence: clamp01(t.confidence ?? 0) }))
      .filter((t) => t.name.length > 0);

    const links: SuggestedLink[] = (raw.links ?? [])
      .filter((l) => (l.target ?? '').trim().length > 0)
      .map((l) => {
        const resolved = resolveLinkTarget(l.target!, req.candidateNotes);
        return { ...resolved, reason: (l.reason ?? '').trim(), confidence: clamp01(l.confidence ?? 0) };
      });

    const summaryText = (raw.summary ?? '').trim();
    const summary = summaryText
      ? { text: summaryText, reason: 'On-device one-sentence summary.', confidence: 0.8 }
      : null;

    return { topics, links, tags, summary, aliases: [] };
  }

  async labelSimilarity(
    req: LabelSimilarityRequest,
  ): Promise<{ related: boolean; reason: string; confidence: number }> {
    const res = (await this.transport.call('labelSimilarity', { a: req.a, b: req.b })) as {
      related?: boolean;
      reason?: string;
      confidence?: number;
    };
    return {
      related: res?.related === true,
      reason: (res?.reason ?? '').trim(),
      confidence: clamp01(res?.confidence ?? 0),
    };
  }
}

/** Drop lowest-priority candidates until their combined stub text fits the candidate token budget
 *  (S16). Order is preserved (callers pass highest-similarity first). */
function trimCandidates(candidates: NoteStub[], budgetTokens: number): NoteStub[] {
  const out: NoteStub[] = [];
  let used = 0;
  for (const c of candidates) {
    const summary = c.summary ? capWords(c.summary, 50) : undefined;
    const stub: NoteStub = { relPath: c.relPath, title: c.title, summary };
    const cost = estimateTokens(`${c.title} ${summary ?? ''}`);
    if (used + cost > budgetTokens && out.length > 0) break;
    out.push(stub);
    used += cost;
  }
  return out;
}
