// src/state/deepInsights.ts — on-demand "Analysis" synthesis for a topic node (D13/S27). Reasons
// over a topic's member-note SUMMARIES ordered by time (D12 — never full bodies) to describe how
// the user's OWN thinking evolved: stance evolution, rising/fading themes, contradictions (citing
// specific note pairs), open questions. It is analysis of the user's notes, NOT market/predictive
// advice — the prompt forbids predictions and phrases everything as "your notes suggest".
//
// Like every paid call it is capped by the SAME ledger (S27: no uncapped path to the backend) — a
// hard budget gate here too — and records to `spend.json` under kind `insights`. Injected transport
// + ledger so it's testable with a mock, no key.

import {
  safeJson,
  type AnthropicMessageRequest,
  type AnthropicTransport,
} from '../services/aiClient/anthropic';
import { budgetGuardCost, costUsd, type AnthropicModelId } from '../services/aiClient/pricing';
import { SpendLedger } from '../services/spendLedger';
import { DenoteError } from '../services/errors';

/** One topic member, summary + date, for the time-ordered synthesis (D12). */
export interface InsightMember {
  relPath: string;
  title: string;
  summary: string;
  /** ms since epoch (created/edited per S26) — members are sorted ascending before prompting. */
  time: number;
}

export interface TopicAnalysis {
  stanceEvolution: string;
  risingThemes: string[];
  fadingThemes: string[];
  contradictions: { noteA: string; noteB: string; note: string }[];
  openQuestions: string[];
}

const ANALYSIS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    stanceEvolution: { type: 'string' },
    risingThemes: { type: 'array', items: { type: 'string' } },
    fadingThemes: { type: 'array', items: { type: 'string' } },
    contradictions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { noteA: { type: 'string' }, noteB: { type: 'string' }, note: { type: 'string' } },
        required: ['noteA', 'noteB', 'note'],
      },
    },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['stanceEvolution', 'risingThemes', 'fadingThemes', 'contradictions', 'openQuestions'],
};

const ANALYSIS_SYSTEM =
  'You analyze the USER\'S OWN notes on one topic, ordered oldest-to-newest. Describe how their ' +
  'thinking evolved (stanceEvolution), which sub-themes are rising vs fading, contradictions ' +
  'between SPECIFIC notes (cite the two note titles verbatim in noteA/noteB), and open questions ' +
  'their notes raise. This is analysis of the user\'s thinking, NOT financial or predictive ' +
  'advice: make NO market/price/forecast claims. Phrase findings as "your notes suggest" or "if ' +
  'your notes are right". Cite note titles exactly as given. Reply as JSON matching the schema.';

export interface DeepInsightsDeps {
  transport: AnthropicTransport;
  ledger: SpendLedger;
  model: AnthropicModelId;
  now?: () => number;
  perCallCapUsd?: number;
}

export class DeepInsights {
  private readonly now: () => number;

  constructor(private readonly deps: DeepInsightsDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Estimated cost (standard, non-batch rates) for analyzing a topic's members. */
  estimate(members: InsightMember[]): { inputTokens: number; outputTokens: number; costUsd: number } {
    const user = this.buildUser(members);
    const inputTokens = Math.ceil((ANALYSIS_SYSTEM.length + user.length) / 3.5);
    const outputTokens = 1200;
    return { inputTokens, outputTokens, costUsd: costUsd({ inputTokens, outputTokens }, this.deps.model) };
  }

  private buildUser(members: InsightMember[]): string {
    const ordered = [...members].sort((a, b) => a.time - b.time);
    return ordered
      .map((m, i) => `${i + 1}. "${m.title}" (${new Date(m.time).toISOString().slice(0, 10)}): ${m.summary}`)
      .join('\n');
  }

  async analyze(topicName: string, members: InsightMember[]): Promise<TopicAnalysis> {
    if (members.length === 0) {
      return { stanceEvolution: '', risingThemes: [], fadingThemes: [], contradictions: [], openQuestions: [] };
    }
    const est = this.estimate(members);
    const guard = budgetGuardCost(est.costUsd);
    const budget = Math.min(this.deps.ledger.remaining(), this.deps.perCallCapUsd ?? Infinity);
    // HARD gate — insights share the same cap; there is no uncapped path (S27).
    if (guard > budget) {
      throw new DenoteError(
        'budget-exceeded',
        `Analysis estimated $${est.costUsd.toFixed(2)} (×1.2 = $${guard.toFixed(2)}) exceeds the remaining budget $${budget.toFixed(2)}.`,
        { retryable: false },
      );
    }

    const req: AnthropicMessageRequest = {
      model: this.deps.model,
      maxTokens: 1600,
      system: [{ text: ANALYSIS_SYSTEM, cache: true }],
      messages: [{ role: 'user', content: `Topic: ${topicName}\n\nNotes (oldest first):\n${this.buildUser(members)}` }],
      jsonSchema: ANALYSIS_SCHEMA,
    };
    const res = await this.deps.transport.createMessage(req);

    const at = new Date(this.now()).toISOString();
    if (res.refused) {
      // Refusal before/mid output — record whatever was billed (mid-stream) or nothing (pre-output).
      const actual = costUsd(res.usage, this.deps.model);
      if (actual > 0) {
        await this.deps.ledger.record({ id: `insight-${this.now()}`, kind: 'insights', model: this.deps.model, at, inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, costUsd: actual, status: 'reconciled' });
      }
      throw new DenoteError('ai-invalid-output', 'The analysis request was declined.', { retryable: false });
    }

    const actual = costUsd(res.usage, this.deps.model);
    await this.deps.ledger.record({
      id: `insight-${this.now()}`,
      kind: 'insights',
      model: this.deps.model,
      at,
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens,
      costUsd: actual,
      status: 'reconciled',
    });

    const parsed = safeJson<TopicAnalysis>(res.text);
    return (
      parsed ?? { stanceEvolution: '', risingThemes: [], fadingThemes: [], contradictions: [], openQuestions: [] }
    );
  }
}
