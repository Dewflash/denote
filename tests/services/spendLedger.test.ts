// Spend ledger (S27): record → reconcile → remaining, monthly scoping, lost/drop, cap.
import { describe, expect, it } from 'vitest';
import { SpendLedger, DEFAULT_MONTHLY_CAP_USD, yearMonthOf } from '../../src/services/spendLedger';
import { memIO } from '../helpers/memIO';

const JULY = Date.UTC(2026, 6, 12); // 2026-07-12
const AUG = Date.UTC(2026, 7, 1);

describe('SpendLedger (S27)', () => {
  it('reserves estimate before submission and reconciles to actuals', async () => {
    const io = memIO();
    const led = new SpendLedger(io, () => JULY);
    await led.load();
    expect(led.remaining()).toBe(DEFAULT_MONTHLY_CAP_USD);

    await led.record({ id: 'b1', kind: 'deep-organize', model: 'claude-opus-4-8', at: new Date(JULY).toISOString(), inputTokens: 1000, outputTokens: 500, costUsd: 2, status: 'estimated' });
    expect(led.spentThisMonth()).toBe(2); // estimate reserves budget
    expect(led.remaining()).toBe(DEFAULT_MONTHLY_CAP_USD - 2);

    await led.reconcile('b1', { inputTokens: 800, outputTokens: 300, costUsd: 1.4 });
    expect(led.spentThisMonth()).toBe(1.4); // actual replaces estimate
    expect(led.allRuns()[0].status).toBe('reconciled');
  });

  it('scopes spend to the current month', async () => {
    const io = memIO();
    let now = JULY;
    const led = new SpendLedger(io, () => now);
    await led.load();
    await led.record({ id: 'jul', kind: 'insights', model: 'claude-opus-4-8', at: new Date(JULY).toISOString(), inputTokens: 0, outputTokens: 0, costUsd: 3, status: 'reconciled' });
    expect(led.spentThisMonth()).toBe(3);
    now = AUG;
    expect(led.spentThisMonth()).toBe(0); // new month, budget resets
    expect(yearMonthOf(JULY)).toBe('2026-07');
  });

  it('markLost keeps a loss counted; drop removes a never-charged reservation', async () => {
    const io = memIO();
    const led = new SpendLedger(io, () => JULY);
    await led.load();
    await led.record({ id: 'lost', kind: 'deep-organize', model: 'claude-opus-4-8', at: new Date(JULY).toISOString(), inputTokens: 0, outputTokens: 0, costUsd: 4, status: 'estimated' });
    await led.markLost('lost');
    expect(led.spentThisMonth()).toBe(4); // an expired batch still holds/loses money
    expect(led.allRuns()[0].status).toBe('lost');

    await led.record({ id: 'oops', kind: 'deep-organize', model: 'claude-opus-4-8', at: new Date(JULY).toISOString(), inputTokens: 0, outputTokens: 0, costUsd: 5, status: 'estimated' });
    await led.drop('oops');
    expect(led.spentThisMonth()).toBe(4); // dropped reservation never counts
  });

  it('persists cap + runs and reloads them', async () => {
    const io = memIO();
    const led = new SpendLedger(io, () => JULY);
    await led.load();
    await led.setMonthlyCap(0.01);
    await led.record({ id: 'x', kind: 'insights', model: 'claude-opus-4-8', at: new Date(JULY).toISOString(), inputTokens: 0, outputTokens: 0, costUsd: 0.005, status: 'reconciled' });

    const led2 = new SpendLedger(io, () => JULY);
    await led2.load();
    expect(led2.monthlyCap()).toBe(0.01);
    expect(led2.remaining()).toBeCloseTo(0.005, 9);
  });
});
