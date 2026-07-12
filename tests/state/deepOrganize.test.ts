// Deep-organize orchestrator (D12/D13/S27) — full flow on a MOCK transport + in-memory stores:
// plan → budget gate → submit → durable-persist → poll → reconcile → apply (notes + themes).
// Covers the hard budget gate (physically uncrossable), localOnly exclusion, and durability.
import { describe, expect, it, vi } from 'vitest';
import { DeepOrganizeJob, type DeepOrganizeVault, type ThemeResult, type RawNoteResult } from '../../src/state/deepOrganize';
import type { AnthropicTransport, BatchResultItem } from '../../src/services/aiClient/anthropic';
import { SpendLedger } from '../../src/services/spendLedger';
import { BatchStore } from '../../src/services/batchStore';
import { DenoteError } from '../../src/services/errors';
import { memIO } from '../helpers/memIO';

const NOW = Date.UTC(2026, 6, 12);

function vaults(): DeepOrganizeVault[] {
  return [
    {
      vaultId: 'work',
      localOnly: false,
      notes: [
        { vaultId: 'work', relPath: 'Finance/Gold.md', title: 'Gold', folder: 'Finance', summary: 'gold as a reserve asset', stale: false, enriched: false },
        { vaultId: 'work', relPath: 'Markets/Dollar.md', title: 'Dollar', folder: 'Markets', summary: 'reserve currency shifts', stale: false, enriched: false },
      ],
      topics: [{ vaultId: 'work', name: 'Currencies', memberTitles: ['Dollar'] }],
    },
    {
      // A local-only vault — its content must never enter the corpus (S27 assembler exclusion).
      vaultId: 'church',
      localOnly: true,
      notes: [{ vaultId: 'church', relPath: 'Sermons/Grace.md', title: 'Grace', folder: 'Sermons', summary: 'a private sermon', stale: false, enriched: false }],
      topics: [{ vaultId: 'church', name: 'Faith', memberTitles: ['Grace'] }],
    },
  ];
}

/** A transport that returns canned batch results per custom_id. */
function transport(results: BatchResultItem[]): AnthropicTransport {
  return {
    createMessage: vi.fn(async () => ({ text: '{}', usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'end_turn', refused: false })),
    countTokens: vi.fn(async () => ({ inputTokens: 500 })), // 500 input tokens per item
    createBatch: vi.fn(async () => ({ batchId: 'batch-1' })),
    retrieveBatch: vi.fn(async () => ({ status: 'ended' as const })),
    batchResults: vi.fn(async () => results),
    testKey: vi.fn(async () => ({ ok: true })),
  };
}

describe('DeepOrganizeJob (D13/S27)', () => {
  it('assembles only non-localOnly vaults (S27 defense in depth)', async () => {
    const job = new DeepOrganizeJob({
      transport: transport([]),
      ledger: new SpendLedger(memIO(), () => NOW),
      batches: new BatchStore(memIO()),
      model: 'claude-opus-4-8',
      vaults,
      applyNoteResult: async () => {},
      applyThemes: async () => {},
      now: () => NOW,
    });
    const corpus = job.assembleCorpus();
    expect(corpus.notes.map((n) => n.vaultId)).not.toContain('church');
    expect(corpus.notes).toHaveLength(2); // only the work vault's notes
  });

  it('plan → run: submits, persists durably, reconciles spend, applies notes + themes', async () => {
    const ledger = new SpendLedger(memIO(), () => NOW);
    await ledger.load();
    const batches = new BatchStore(memIO());
    await batches.load();

    const noteResults: Record<string, RawNoteResult> = {};
    const themesSeen: ThemeResult[] = [];

    const theme: ThemeResult = {
      name: 'De-dollarization',
      description: 'A reserve-currency shift.',
      reason: 'Gold and Dollar both discuss moving away from USD reserves.',
      confidence: 0.85,
      memberTitles: ['Gold', 'Dollar'],
    };
    const results: BatchResultItem[] = [
      { customId: 'theme', type: 'succeeded', text: JSON.stringify({ themes: [theme] }), usage: { inputTokens: 400, outputTokens: 200 } },
      { customId: 'note:work:Finance/Gold.md', type: 'succeeded', text: JSON.stringify({ topics: [{ name: 'Commodities', reason: 'gold', confidence: 0.8 }], links: [], tags: [], summary: 'gold' }), usage: { inputTokens: 300, outputTokens: 100 } },
      { customId: 'note:work:Markets/Dollar.md', type: 'succeeded', text: JSON.stringify({ topics: [], links: [], tags: [], summary: 'dollar' }), usage: { inputTokens: 300, outputTokens: 100 } },
    ];

    const job = new DeepOrganizeJob({
      transport: transport(results),
      ledger,
      batches,
      model: 'claude-opus-4-8',
      vaults,
      pollIntervalMs: 0,
      now: () => NOW,
      applyNoteResult: async (vaultId, relPath, raw) => {
        noteResults[`${vaultId}:${relPath}`] = raw;
      },
      applyThemes: async (themes) => {
        themesSeen.push(...themes);
      },
    });

    const plan = await job.plan();
    expect(plan.withinBudget).toBe(true);
    expect(plan.noteCount).toBe(2);
    expect(plan.firstRunThisMonth).toBe(true);

    const outcome = await job.run(plan);
    expect(outcome.applied.notes).toBe(2);
    expect(outcome.applied.themes).toBe(1);
    expect(outcome.lost).toBe(false);

    // Theme spanning two folders (Finance + Markets), reason cites its members.
    expect(themesSeen[0].name).toBe('De-dollarization');
    expect(themesSeen[0].memberTitles).toEqual(['Gold', 'Dollar']);

    // Durable: the batch was persisted with its manifest.
    expect(batches.get('batch-1')?.status).toBe('reconciled');
    expect(batches.get('batch-1')?.manifest.length).toBe(3);

    // Spend reconciled to the summed actual usage (batch rates), matching response usage.
    const run = ledger.allRuns().find((r) => r.id === 'batch-1')!;
    expect(run.status).toBe('reconciled');
    expect(run.inputTokens).toBe(1000); // 400 + 300 + 300
    expect(run.outputTokens).toBe(400); // 200 + 100 + 100
    expect(run.costUsd).toBeGreaterThan(0);
  });

  it('a $0.01 cap physically blocks submission (hard gate — S27 pitfall)', async () => {
    const ledger = new SpendLedger(memIO(), () => NOW);
    await ledger.load();
    await ledger.setMonthlyCap(0.01);
    const t = transport([]);
    const job = new DeepOrganizeJob({
      transport: t,
      ledger,
      batches: new BatchStore(memIO()),
      model: 'claude-opus-4-8',
      vaults,
      now: () => NOW,
      applyNoteResult: async () => {},
      applyThemes: async () => {},
    });

    const plan = await job.plan();
    expect(plan.withinBudget).toBe(false); // guardCost > $0.01

    await expect(job.run(plan)).rejects.toMatchObject({ kind: 'budget-exceeded' });
    expect(t.createBatch).not.toHaveBeenCalled(); // never submitted
  });

  it('resumes a pending batch on launch (S27 durability across restarts)', async () => {
    const ledger = new SpendLedger(memIO(), () => NOW);
    await ledger.load();
    const batches = new BatchStore(memIO());
    await batches.load();
    // Simulate a prior session that submitted but crashed before polling.
    await batches.add({ batchId: 'batch-1', submittedAt: new Date(NOW).toISOString(), estimatedCostUsd: 1, model: 'claude-opus-4-8', status: 'submitted', manifest: [{ customId: 'note:work:Finance/Gold.md', kind: 'note', ref: 'Finance/Gold.md', vaultId: 'work' }] });
    await ledger.record({ id: 'batch-1', kind: 'deep-organize', model: 'claude-opus-4-8', at: new Date(NOW).toISOString(), inputTokens: 500, outputTokens: 100, costUsd: 1, status: 'estimated' });

    const applied: string[] = [];
    const job = new DeepOrganizeJob({
      transport: transport([{ customId: 'note:work:Finance/Gold.md', type: 'succeeded', text: JSON.stringify({ topics: [], links: [], tags: [], summary: 'gold' }), usage: { inputTokens: 500, outputTokens: 100 } }]),
      ledger,
      batches,
      model: 'claude-opus-4-8',
      vaults,
      pollIntervalMs: 0,
      now: () => NOW,
      applyNoteResult: async (_v, rel) => {
        applied.push(rel);
      },
      applyThemes: async () => {},
    });

    const outcomes = await job.resume();
    expect(outcomes[0].applied.notes).toBe(1);
    expect(applied).toEqual(['Finance/Gold.md']);
    expect(batches.get('batch-1')?.status).toBe('reconciled');
  });

  it('an expired batch is marked lost, not silently dropped (S27)', async () => {
    const ledger = new SpendLedger(memIO(), () => NOW);
    await ledger.load();
    await ledger.record({ id: 'batch-1', kind: 'deep-organize', model: 'claude-opus-4-8', at: new Date(NOW).toISOString(), inputTokens: 500, outputTokens: 100, costUsd: 1, status: 'estimated' });
    const batches = new BatchStore(memIO());
    await batches.load();
    await batches.add({ batchId: 'batch-1', submittedAt: new Date(NOW).toISOString(), estimatedCostUsd: 1, model: 'claude-opus-4-8', status: 'submitted', manifest: [] });

    const job = new DeepOrganizeJob({
      transport: transport([{ customId: 'x', type: 'expired' }]),
      ledger,
      batches,
      model: 'claude-opus-4-8',
      vaults,
      pollIntervalMs: 0,
      now: () => NOW,
      applyNoteResult: async () => {},
      applyThemes: async () => {},
    });

    const outcomes = await job.resume();
    expect(outcomes[0].lost).toBe(true);
    expect(batches.get('batch-1')?.status).toBe('expired');
    expect(ledger.allRuns().find((r) => r.id === 'batch-1')?.status).toBe('lost');
  });
});

// Sanity: DenoteError is what the gate throws (used by the UI to render a clear message).
describe('budget gate error type', () => {
  it('is a budget-exceeded DenoteError', () => {
    const err = new DenoteError('budget-exceeded', 'over cap');
    expect(err.kind).toBe('budget-exceeded');
  });
});
