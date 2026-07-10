// src/state/enrichmentQueue.ts — the enrichment job queue's PURE bookkeeping (S12). The stateful
// orchestration (running jobs, timers, AI calls) lives in vaultAiEngine.ts; this holds only the
// data shape, the dedup/replace rule, the retry backoff schedule, and (de)serialization, so those
// rules are unit-testable without a Repository or timers.

export type EnrichJobState = 'pending' | 'running' | 'parked';

export interface EnrichJob {
  relPath: string;
  contentHash: string;
  state: EnrichJobState;
  attempts: number;
  /** Epoch ms; a pending job is due when `now >= nextAttemptAt`. */
  nextAttemptAt: number;
}

/** Retry backoff after failure: 5s, 30s, 2m — then parked (S12). `attempt` is 1-based. */
export const BACKOFF_MS = [5_000, 30_000, 120_000];

export function backoffDelay(attempt: number): number | null {
  return attempt >= 1 && attempt <= BACKOFF_MS.length ? BACKOFF_MS[attempt - 1] : null;
}

export const QUEUE_PATH = '.denote/cache/queue.json'; // S12
/** Bulk provisional-takeover consent (S28): 'ask' prompts once past the 20-note threshold. */
export type TakeoverConsent = 'ask' | 'apply' | 'none';

interface QueueFile {
  version: 1;
  jobs: EnrichJob[];
  takeoverConsent: TakeoverConsent;
}

/** In-memory queue: at most one job per relPath (S12); a newer contentHash replaces an older
 *  pending entry for the same note. */
export class EnrichmentQueue {
  private readonly jobs = new Map<string, EnrichJob>();
  private consent: TakeoverConsent = 'ask';

  /** Upsert a pending job for a note; the newest contentHash always wins (S12). */
  enqueue(relPath: string, contentHash: string): void {
    this.jobs.set(relPath, { relPath, contentHash, state: 'pending', attempts: 0, nextAttemptAt: 0 });
  }

  get(relPath: string): EnrichJob | undefined {
    return this.jobs.get(relPath);
  }

  remove(relPath: string): void {
    this.jobs.delete(relPath);
  }

  all(): EnrichJob[] {
    return [...this.jobs.values()];
  }

  parkedCount(): number {
    return this.all().filter((j) => j.state === 'parked').length;
  }

  /** Pending jobs due at `now`, oldest-scheduled first. Excludes running/parked. */
  due(now: number): EnrichJob[] {
    return this.all()
      .filter((j) => j.state === 'pending' && j.nextAttemptAt <= now)
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt);
  }

  markRunning(relPath: string): void {
    const j = this.jobs.get(relPath);
    if (j) j.state = 'running';
  }

  /** Apply a failure: schedule a backoff retry, or park once retries are exhausted (S12). */
  fail(relPath: string, now: number): EnrichJob | undefined {
    const j = this.jobs.get(relPath);
    if (!j) return undefined;
    j.attempts += 1;
    const delay = backoffDelay(j.attempts);
    if (delay === null) {
      j.state = 'parked';
    } else {
      j.state = 'pending';
      j.nextAttemptAt = now + delay;
    }
    return j;
  }

  getConsent(): TakeoverConsent {
    return this.consent;
  }
  setConsent(c: TakeoverConsent): void {
    this.consent = c;
  }

  toJSON(): QueueFile {
    return { version: 1, jobs: this.all(), takeoverConsent: this.consent };
  }

  /** Load persisted state. `running` jobs revert to `pending` (the process died mid-run, S12). */
  loadFrom(raw: string | null): void {
    this.jobs.clear();
    this.consent = 'ask';
    if (!raw) return;
    let file: Partial<QueueFile>;
    try {
      file = JSON.parse(raw) as Partial<QueueFile>;
    } catch {
      return; // corrupt cache → start empty (it's a rebuildable cache, D3)
    }
    if (file.takeoverConsent === 'apply' || file.takeoverConsent === 'none') {
      this.consent = file.takeoverConsent;
    }
    for (const j of file.jobs ?? []) {
      if (!j || typeof j.relPath !== 'string') continue;
      this.jobs.set(j.relPath, {
        relPath: j.relPath,
        contentHash: String(j.contentHash ?? ''),
        state: j.state === 'parked' ? 'parked' : 'pending', // running → pending on restart
        attempts: typeof j.attempts === 'number' ? j.attempts : 0,
        nextAttemptAt: typeof j.nextAttemptAt === 'number' ? j.nextAttemptAt : 0,
      });
    }
  }
}
