// src/services/aiClient/pricing.ts — the SINGLE source of Anthropic pricing (S19). Every cost
// estimate and every budget gate reads from here; nothing hardcodes a per-token rate anywhere
// else. Prices drift, so this module carries a `verifiedAt` date — the pass-09 agent verified
// these against live Anthropic docs (the claude-api skill's model/pricing table, itself sourced
// from platform.claude.com) at implementation time. Re-verify and bump `verifiedAt` when touched.
//
// Budget rule (S19): the pre-flight gate compares `estimate * SAFETY_MARGIN` (1.2×) against the
// remaining cap; the ledger later reconciles against the response's real `usage`. Deep-organize
// runs on the Batch API (D13), which bills at 50% of standard rates (BATCH_DISCOUNT).

/** USD prices per 1,000,000 tokens, per model. Standard (non-batch) rates. */
export interface ModelPrice {
  /** Human label for the settings routing table / spend page. */
  label: string;
  inputPerMTok: number;
  outputPerMTok: number;
}

/** Verified against the claude-api skill's current model/pricing table (platform.claude.com). */
export const PRICING_VERIFIED_AT = '2026-07-12';

/** The deep-tier model tiers the routing table exposes (D13: default opus for deep-organize). */
export type AnthropicModelId = 'claude-opus-4-8' | 'claude-sonnet-5' | 'claude-haiku-4-5';

export const DEFAULT_DEEP_MODEL: AnthropicModelId = 'claude-opus-4-8';

// Standard rates. We deliberately use the full (non-introductory) Sonnet price so the budget gate
// never UNDER-estimates: a conservative estimate can only refuse a run that would have fit, never
// admit one that wouldn't. The ledger reconciles actuals afterward, so users aren't overcharged.
export const MODEL_PRICING: Record<AnthropicModelId, ModelPrice> = {
  'claude-opus-4-8': { label: 'Claude Opus 4.8', inputPerMTok: 5, outputPerMTok: 25 },
  'claude-sonnet-5': { label: 'Claude Sonnet 5', inputPerMTok: 3, outputPerMTok: 15 },
  'claude-haiku-4-5': { label: 'Claude Haiku 4.5', inputPerMTok: 1, outputPerMTok: 5 },
};

/** Batch API bills at 50% of standard rates (D13). */
export const BATCH_DISCOUNT = 0.5;

/** S19 pre-flight safety margin applied to the estimate before comparing to the cap. */
export const SAFETY_MARGIN = 1.2;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export function isAnthropicModel(id: string): id is AnthropicModelId {
  return id in MODEL_PRICING;
}

/** Exact dollar cost of a given token usage on a model (standard or batch rates). */
export function costUsd(usage: TokenUsage, model: AnthropicModelId, opts: { batch?: boolean } = {}): number {
  const price = MODEL_PRICING[model];
  const mult = opts.batch ? BATCH_DISCOUNT : 1;
  const input = (usage.inputTokens / 1_000_000) * price.inputPerMTok * mult;
  const output = (usage.outputTokens / 1_000_000) * price.outputPerMTok * mult;
  return input + output;
}

/** The value the S19 budget gate compares against the remaining cap: estimate × 1.2. */
export function budgetGuardCost(estimate: number): number {
  return estimate * SAFETY_MARGIN;
}
