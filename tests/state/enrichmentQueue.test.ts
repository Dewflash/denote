// Pass-06 unit test: the pure enrichment-queue bookkeeping (S12).

import { describe, expect, it } from 'vitest';
import { backoffDelay, EnrichmentQueue } from '../../src/state/enrichmentQueue';

describe('backoffDelay (S12)', () => {
  it('is 5s / 30s / 2m, then null (park)', () => {
    expect(backoffDelay(1)).toBe(5_000);
    expect(backoffDelay(2)).toBe(30_000);
    expect(backoffDelay(3)).toBe(120_000);
    expect(backoffDelay(4)).toBeNull();
    expect(backoffDelay(0)).toBeNull();
  });
});

describe('EnrichmentQueue', () => {
  it('keeps at most one job per note; newest hash wins', () => {
    const q = new EnrichmentQueue();
    q.enqueue('a.md', 'h1');
    q.enqueue('a.md', 'h2');
    expect(q.all()).toHaveLength(1);
    expect(q.get('a.md')?.contentHash).toBe('h2');
  });

  it('fail() backs off then parks after 3 attempts', () => {
    const q = new EnrichmentQueue();
    q.enqueue('a.md', 'h');
    expect(q.fail('a.md', 1000)?.state).toBe('pending');
    expect(q.get('a.md')?.nextAttemptAt).toBe(1000 + 5_000);
    q.fail('a.md', 2000);
    q.fail('a.md', 3000);
    expect(q.fail('a.md', 4000)?.state).toBe('parked');
    expect(q.parkedCount()).toBe(1);
  });

  it('resumes parked jobs after an explicit backend retry', () => {
    const q = new EnrichmentQueue();
    q.enqueue('a.md', 'h');
    q.fail('a.md', 0);
    q.fail('a.md', 0);
    q.fail('a.md', 0);
    q.fail('a.md', 0);
    expect(q.get('a.md')?.state).toBe('parked');

    expect(q.resumeParked(1234)).toBe(1);
    expect(q.get('a.md')).toMatchObject({ state: 'pending', attempts: 0, nextAttemptAt: 1234 });
    expect(q.due(1234)).toHaveLength(1);
  });

  it('parks every pending job when the backend is unavailable', () => {
    const q = new EnrichmentQueue();
    q.enqueue('a.md', 'a');
    q.enqueue('b.md', 'b');
    expect(q.parkPending()).toBe(2);
    expect(q.due(Date.now())).toEqual([]);
    expect(q.parkedCount()).toBe(2);
  });

  it('keeps the verbatim failure visible and reports all queue counts', () => {
    const q = new EnrichmentQueue();
    q.enqueue('pending.md', 'p');
    q.enqueue('running.md', 'r');
    q.markRunning('running.md');
    q.enqueue('parked.md', 'k');
    q.park('parked.md', 'Model Manager 1008: Apple Foundation Models could not start');

    expect(q.counts()).toEqual({ pending: 1, running: 1, parked: 1 });
    expect(q.get('parked.md')?.lastError).toBe('Model Manager 1008: Apple Foundation Models could not start');
  });

  it('due() returns only pending jobs whose backoff has elapsed', () => {
    const q = new EnrichmentQueue();
    q.enqueue('a.md', 'h');
    q.fail('a.md', 0); // nextAttemptAt = 5000
    expect(q.due(4000)).toHaveLength(0);
    expect(q.due(5000)).toHaveLength(1);
  });

  it('round-trips through JSON, reverting running → pending on load', () => {
    const q = new EnrichmentQueue();
    q.enqueue('a.md', 'h');
    q.markRunning('a.md');
    q.setConsent('apply');
    const raw = JSON.stringify(q.toJSON());

    const q2 = new EnrichmentQueue();
    q2.loadFrom(raw);
    expect(q2.get('a.md')?.state).toBe('pending'); // running reverts on restart (S12)
    expect(q2.getConsent()).toBe('apply');
  });

  it('tolerates a corrupt cache file (starts empty)', () => {
    const q = new EnrichmentQueue();
    q.loadFrom('{not json');
    expect(q.all()).toHaveLength(0);
    expect(q.getConsent()).toBe('ask');
  });
});
