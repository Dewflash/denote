// Deep insights (D13/S27): topic Analysis synthesis, budget gate, spend recording.
import { describe, expect, it, vi } from 'vitest';
import { DeepInsights, type InsightMember } from '../../src/state/deepInsights';
import type { AnthropicTransport } from '../../src/services/aiClient/anthropic';
import { SpendLedger } from '../../src/services/spendLedger';
import { memIO } from '../helpers/memIO';

const NOW = Date.UTC(2026, 6, 12);

const members: InsightMember[] = [
  { relPath: 'a.md', title: 'Early view', summary: 'first take on rates', time: Date.UTC(2026, 0, 1) },
  { relPath: 'b.md', title: 'Later view', summary: 'revised take on rates', time: Date.UTC(2026, 5, 1) },
];

function transport(text: string): AnthropicTransport {
  return {
    createMessage: vi.fn(async () => ({ text, usage: { inputTokens: 200, outputTokens: 300 }, stopReason: 'end_turn', refused: false })),
    countTokens: vi.fn(async () => ({ inputTokens: 200 })),
    createBatch: vi.fn(async () => ({ batchId: 'b' })),
    retrieveBatch: vi.fn(async () => ({ status: 'ended' as const })),
    batchResults: vi.fn(async () => []),
    testKey: vi.fn(async () => ({ ok: true })),
  };
}

describe('DeepInsights (D13/S27)', () => {
  it('synthesizes structured analysis and records the spend', async () => {
    const ledger = new SpendLedger(memIO(), () => NOW);
    await ledger.load();
    const analysis = {
      stanceEvolution: 'Your notes moved from bearish to neutral on rates.',
      risingThemes: ['policy lag'],
      fadingThemes: ['inflation panic'],
      contradictions: [{ noteA: 'Early view', noteB: 'Later view', note: 'opposite conclusions on the same data' }],
      openQuestions: ['what changed your mind?'],
    };
    const insights = new DeepInsights({ transport: transport(JSON.stringify(analysis)), ledger, model: 'claude-opus-4-8', now: () => NOW });

    const res = await insights.analyze('Interest Rates', members);
    expect(res.stanceEvolution).toContain('bearish');
    expect(res.contradictions[0].noteA).toBe('Early view'); // citation preserved for linking
    // Spend recorded (S27: no uncapped path — insights hit the same ledger).
    const runs = ledger.allRuns().filter((r) => r.kind === 'insights');
    expect(runs).toHaveLength(1);
    expect(runs[0].inputTokens).toBe(200);
    expect(runs[0].status).toBe('reconciled');
  });

  it('refuses when the estimate exceeds the remaining cap (hard gate)', async () => {
    const ledger = new SpendLedger(memIO(), () => NOW);
    await ledger.load();
    await ledger.setMonthlyCap(0); // no budget
    const t = transport('{}');
    const insights = new DeepInsights({ transport: t, ledger, model: 'claude-opus-4-8', now: () => NOW });

    await expect(insights.analyze('Interest Rates', members)).rejects.toMatchObject({ kind: 'budget-exceeded' });
    expect(t.createMessage).not.toHaveBeenCalled(); // never called the backend
  });

  it('empty topic → empty analysis, no spend', async () => {
    const ledger = new SpendLedger(memIO(), () => NOW);
    await ledger.load();
    const insights = new DeepInsights({ transport: transport('{}'), ledger, model: 'claude-opus-4-8', now: () => NOW });
    const res = await insights.analyze('Empty', []);
    expect(res.openQuestions).toEqual([]);
    expect(ledger.allRuns()).toHaveLength(0);
  });
});
