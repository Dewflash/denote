// src/services/spendLedger.ts — the unified spend ledger + monthly budget cap (S27/D13).
//
// EVERY Anthropic-backend call — deep-organize batches AND on-demand insights — records here and
// respects the monthly cap; there is no uncapped path to the paid backend. Estimated cost is
// recorded BEFORE submission (a run reserves budget the moment it's admitted); actuals from the
// response `usage` reconcile it afterward; an expired batch is marked `lost` (money may have been
// charged — kept visible, never silently dropped). File: `spend.json` in app support (S26 v1).
//
// The cap gate itself lives in the deep-organize orchestrator (state/deepOrganize.ts): it is a
// hard code assertion, not a UI hint. This module owns only the accounting + `remaining()` math.

import type { AppSupportIO } from './appSupportStore';

export const SPEND_PATH = 'spend.json';
export const DEFAULT_MONTHLY_CAP_USD = 10;

export type SpendKind = 'deep-organize' | 'insights';
export type SpendStatus = 'estimated' | 'reconciled' | 'lost';

export interface SpendRun {
  id: string; // batchId for deep-organize, a call id for insights
  kind: SpendKind;
  model: string;
  at: string; // ISO submission time
  yearMonth: string; // "2026-07" — the cap is monthly
  inputTokens: number;
  outputTokens: number;
  costUsd: number; // the estimate until reconciled, then the actual
  status: SpendStatus;
}

interface SpendFile {
  version: 1;
  monthlyCapUsd: number;
  runs: SpendRun[];
}

/** "YYYY-MM" for a timestamp (UTC — deterministic across machines). */
export function yearMonthOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export class SpendLedger {
  private cap = DEFAULT_MONTHLY_CAP_USD;
  private runs: SpendRun[] = [];

  constructor(
    private io: AppSupportIO,
    private readonly now: () => number = Date.now,
  ) {}

  /** Rebind to the real app-support IO once `appSupportRoot()` resolves (vaultStore wiring). */
  setIo(io: AppSupportIO): void {
    this.io = io;
  }

  async load(): Promise<void> {
    const raw = await this.io.read(SPEND_PATH);
    if (raw == null) return;
    try {
      const f = JSON.parse(raw) as Partial<SpendFile>;
      this.cap = typeof f.monthlyCapUsd === 'number' ? f.monthlyCapUsd : DEFAULT_MONTHLY_CAP_USD;
      this.runs = Array.isArray(f.runs) ? f.runs : [];
    } catch {
      this.cap = DEFAULT_MONTHLY_CAP_USD;
      this.runs = [];
    }
  }

  monthlyCap(): number {
    return this.cap;
  }

  async setMonthlyCap(usd: number): Promise<void> {
    this.cap = Math.max(0, usd);
    await this.persist();
  }

  allRuns(): readonly SpendRun[] {
    return this.runs;
  }

  /** Total committed spend for the current month — every non-nothing run counts (estimated,
   *  reconciled, AND lost), so an in-flight batch and an expired one both hold budget. */
  spentThisMonth(): number {
    const ym = yearMonthOf(this.now());
    return this.runs.filter((r) => r.yearMonth === ym).reduce((s, r) => s + r.costUsd, 0);
  }

  /** Budget left this month (never negative for display). */
  remaining(): number {
    return Math.max(0, this.cap - this.spentThisMonth());
  }

  /** Reserve budget for a run about to be submitted (S27: recorded BEFORE submission). */
  async record(run: Omit<SpendRun, 'yearMonth'> & { yearMonth?: string }): Promise<void> {
    const yearMonth = run.yearMonth ?? yearMonthOf(Date.parse(run.at) || this.now());
    this.runs = this.runs.filter((r) => r.id !== run.id);
    this.runs.push({ ...run, yearMonth });
    await this.persist();
  }

  /** Reconcile a run to its real usage from the response (S27). */
  async reconcile(id: string, usage: { inputTokens: number; outputTokens: number; costUsd: number }): Promise<void> {
    const run = this.runs.find((r) => r.id === id);
    if (!run) return;
    run.inputTokens = usage.inputTokens;
    run.outputTokens = usage.outputTokens;
    run.costUsd = usage.costUsd;
    run.status = 'reconciled';
    await this.persist();
  }

  /** Mark a submitted run's outcome unknowable (expired batch) — money stays visible as a loss. */
  async markLost(id: string): Promise<void> {
    const run = this.runs.find((r) => r.id === id);
    if (!run) return;
    run.status = 'lost';
    await this.persist();
  }

  /** Drop a reserved run whose submission failed before any charge (never counts as spend). */
  async drop(id: string): Promise<void> {
    const before = this.runs.length;
    this.runs = this.runs.filter((r) => r.id !== id);
    if (this.runs.length !== before) await this.persist();
  }

  private async persist(): Promise<void> {
    const file: SpendFile = { version: 1, monthlyCapUsd: this.cap, runs: this.runs };
    await this.io.write(SPEND_PATH, JSON.stringify(file, null, 2) + '\n');
  }
}
