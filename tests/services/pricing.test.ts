// Pricing (S19): cost math, batch 50% discount, 1.2× budget margin. Verified against the values
// the pass-09 agent recorded in pricing.ts (PRICING_VERIFIED_AT).
import { describe, expect, it } from 'vitest';
import {
  BATCH_DISCOUNT,
  SAFETY_MARGIN,
  budgetGuardCost,
  costUsd,
  isAnthropicModel,
  MODEL_PRICING,
} from '../../src/services/aiClient/pricing';

describe('pricing (S19)', () => {
  it('computes standard cost from token usage', () => {
    // opus-4-8: $5/1M input, $25/1M output.
    const c = costUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, 'claude-opus-4-8');
    expect(c).toBeCloseTo(30, 6);
  });

  it('applies the 50% Batch discount (D13)', () => {
    const std = costUsd({ inputTokens: 2_000_000, outputTokens: 400_000 }, 'claude-opus-4-8');
    const batch = costUsd({ inputTokens: 2_000_000, outputTokens: 400_000 }, 'claude-opus-4-8', { batch: true });
    expect(batch).toBeCloseTo(std * BATCH_DISCOUNT, 9);
  });

  it('sonnet + haiku tiers price below opus', () => {
    const u = { inputTokens: 1_000_000, outputTokens: 0 };
    expect(costUsd(u, 'claude-sonnet-5')).toBeLessThan(costUsd(u, 'claude-opus-4-8'));
    expect(costUsd(u, 'claude-haiku-4-5')).toBeLessThan(costUsd(u, 'claude-sonnet-5'));
  });

  it('budgetGuardCost is estimate × 1.2', () => {
    expect(budgetGuardCost(10)).toBeCloseTo(10 * SAFETY_MARGIN, 9);
  });

  it('isAnthropicModel recognizes only the priced ids', () => {
    expect(isAnthropicModel('claude-opus-4-8')).toBe(true);
    expect(isAnthropicModel('mock@1')).toBe(false);
    expect(Object.keys(MODEL_PRICING)).toContain('claude-opus-4-8');
  });
});
