// src/state/deepOrganize.ts — the on-demand / monthly deep-organize batch job (D12/D13/S27).
//
// Flow: assemble corpus (summaries + topic index + folder manifest, NEVER whole-vault text, D12;
// localOnly vaults EXCLUDED here, not just at the router, S27 defense-in-depth) → local-estimate
// trim to fit `min(remaining monthly budget, per-run cap)` → count_tokens the FINAL batch → HARD
// budget gate (a code assertion, not a UI hint: the submission path is physically unable to exceed
// the cap) → submit via the Batch API (50% rates) → persist the batchId + manifest BEFORE polling
// (durable across restarts) → poll → reconcile actual usage into the ledger → apply results
// (annotations + ontology proposals — canonicalization still applies, cloud output gets NO bypass
// — and cross-note THEMES) keyed by custom_id only (results are unordered).
//
// Everything is injected (transport, ledger, batch store, corpus source, apply sinks) so the whole
// job is integration-testable with a mock transport + in-memory stores, no key and no network.

import {
  buildBatchItems,
  itemInputTokens,
  trimToBudget,
  type AssembledCorpus,
  type BatchItemSpec,
  type CorpusNote,
  type CorpusTopic,
} from '../domain/corpus';
import {
  safeJson,
  type AnthropicMessageRequest,
  type AnthropicTransport,
  type BatchRequestItem,
} from '../services/aiClient/anthropic';
import { budgetGuardCost, costUsd, SAFETY_MARGIN, type AnthropicModelId } from '../services/aiClient/pricing';
import { BatchStore, type ManifestItem } from '../services/batchStore';
import { SpendLedger, yearMonthOf } from '../services/spendLedger';
import { DenoteError } from '../services/errors';

/** One non-localOnly vault's contribution (localOnly vaults are never in this list — S27). */
export interface DeepOrganizeVault {
  vaultId: string;
  localOnly: boolean;
  notes: CorpusNote[];
  topics: CorpusTopic[];
}

/** Parsed per-note result (matches corpus NOTE_ITEM_SCHEMA output). */
export interface RawNoteResult {
  topics?: { name?: string; reason?: string; confidence?: number; parentName?: string }[];
  links?: { target?: string; reason?: string; confidence?: number }[];
  tags?: { name?: string; reason?: string; confidence?: number }[];
  summary?: string;
}

/** A cross-note theme (matches THEME_ITEM_SCHEMA output). */
export interface ThemeResult {
  name: string;
  description: string;
  reason: string;
  confidence: number;
  memberTitles: string[];
}

export interface DeepOrganizePlan {
  items: BatchItemSpec[];
  itemCount: number;
  noteCount: number;
  /** count_tokens on the final assembled batch (S27). */
  inputTokens: number;
  /** Conservative output-token budget (sum of per-item maxTokens). */
  outputTokens: number;
  estimatedCostUsd: number;
  /** estimate × 1.2 (S19) — the value the gate compares against the cap. */
  guardCostUsd: number;
  remainingUsd: number;
  withinBudget: boolean;
  /** First deep-organize this month → require an explicit confirm (brief). */
  firstRunThisMonth: boolean;
  trimmed: boolean;
}

export interface DeepOrganizeDeps {
  transport: AnthropicTransport;
  ledger: SpendLedger;
  batches: BatchStore;
  model: AnthropicModelId;
  /** Per-run cap (dollars) — the gate uses min(remaining monthly budget, perRunCap). */
  perRunCapUsd?: number;
  vaults: () => DeepOrganizeVault[];
  applyNoteResult: (vaultId: string, relPath: string, raw: RawNoteResult) => Promise<void>;
  applyThemes: (themes: ThemeResult[]) => Promise<void>;
  onProgress?: (p: { phase: string; message: string }) => void;
  now?: () => number;
  /** Poll interval ms (tests inject 0); default 15s. */
  pollIntervalMs?: number;
  maxPolls?: number;
}

export interface DeepOrganizeOutcome {
  batchId: string;
  applied: { notes: number; themes: number };
  actualCostUsd: number;
  lost: boolean;
}

export class DeepOrganizeJob {
  private readonly now: () => number;
  private readonly perRunCap: number;

  constructor(private readonly deps: DeepOrganizeDeps) {
    this.now = deps.now ?? Date.now;
    this.perRunCap = deps.perRunCapUsd ?? Infinity;
  }

  /** Assemble the corpus from NON-localOnly vaults only (S27 assembler-level exclusion). */
  assembleCorpus(): AssembledCorpus {
    const notes: CorpusNote[] = [];
    const topics: CorpusTopic[] = [];
    for (const v of this.deps.vaults()) {
      if (v.localOnly) continue; // never assemble a local-only vault's content (D18/S27)
      notes.push(...v.notes);
      topics.push(...v.topics);
    }
    // Defense in depth: assert nothing local-only leaked into the corpus.
    const localIds = new Set(this.deps.vaults().filter((v) => v.localOnly).map((v) => v.vaultId));
    if (notes.some((n) => localIds.has(n.vaultId))) {
      throw new DenoteError('local-only-blocked', 'a local-only vault leaked into the deep-organize corpus');
    }
    return { notes, topics };
  }

  private toRequest(item: BatchItemSpec): AnthropicMessageRequest {
    return {
      model: this.deps.model,
      system: [{ text: item.system, cache: true }],
      messages: [{ role: 'user', content: item.user }],
      maxTokens: item.maxTokens,
      jsonSchema: item.schema,
    };
  }

  private costOf = (est: { inputTokens: number; outputTokens: number }): number =>
    costUsd(est, this.deps.model, { batch: true });

  /** Build + trim + count_tokens + estimate. Does NOT submit. */
  async plan(): Promise<DeepOrganizePlan> {
    const corpus = this.assembleCorpus();
    const allItems = buildBatchItems(corpus);
    const budget = Math.min(this.deps.ledger.remaining(), this.perRunCap);

    // Trim locally (chars/3.5) so we submit the smallest count_tokens verification possible.
    const localItems = trimToBudget(allItems, budget, (est) => budgetGuardCost(this.costOf(est)));
    const trimmed = localItems.length < allItems.length;

    // Verify the FINAL batch with count_tokens (free; still under the 1.2× margin — S27/S19).
    let inputTokens = 0;
    let outputTokens = 0;
    for (const item of localItems) {
      let counted: number;
      try {
        counted = (await this.deps.transport.countTokens(this.toRequest(item))).inputTokens;
      } catch {
        counted = itemInputTokens(item); // count_tokens unavailable → fall back to local estimate
      }
      inputTokens += counted;
      outputTokens += item.maxTokens;
    }

    const estimatedCostUsd = this.costOf({ inputTokens, outputTokens });
    const guardCostUsd = estimatedCostUsd * SAFETY_MARGIN;
    const remainingUsd = budget;
    const firstRunThisMonth = !this.deps.ledger
      .allRuns()
      .some((r) => r.yearMonth === yearMonthOf(this.now()));

    return {
      items: localItems,
      itemCount: localItems.length,
      noteCount: localItems.filter((i) => i.kind === 'note').length,
      inputTokens,
      outputTokens,
      estimatedCostUsd,
      guardCostUsd,
      remainingUsd,
      withinBudget: localItems.length > 0 && guardCostUsd <= remainingUsd,
      firstRunThisMonth,
      trimmed,
    };
  }

  /** Submit + poll + reconcile + apply. The budget gate here is a HARD assertion (S27 pitfall):
   *  this is the only submission path, and it is physically unable to exceed the cap. */
  async run(plan: DeepOrganizePlan): Promise<DeepOrganizeOutcome> {
    // ── HARD BUDGET GATE ────────────────────────────────────────────────────────────
    if (plan.items.length === 0 || plan.guardCostUsd > plan.remainingUsd) {
      throw new DenoteError(
        'budget-exceeded',
        `Estimated $${plan.estimatedCostUsd.toFixed(2)} (×1.2 = $${plan.guardCostUsd.toFixed(2)}) exceeds the remaining budget $${plan.remainingUsd.toFixed(2)}.`,
        { retryable: false },
      );
    }

    this.deps.onProgress?.({ phase: 'submit', message: `Submitting ${plan.itemCount} items…` });
    const requests: BatchRequestItem[] = plan.items.map((item) => ({
      customId: item.customId,
      model: this.deps.model,
      system: [{ text: item.system, cache: true }],
      messages: [{ role: 'user', content: item.user }],
      maxTokens: item.maxTokens,
      jsonSchema: item.schema,
    }));
    const { batchId } = await this.deps.transport.createBatch(requests);

    // ── DURABILITY: persist batchId + manifest + reserve spend BEFORE the poll loop (S27) ────
    const manifest: ManifestItem[] = plan.items.map((i) => ({ customId: i.customId, kind: i.kind, ref: i.ref, vaultId: i.vaultId }));
    const submittedAt = new Date(this.now()).toISOString();
    await this.deps.batches.add({ batchId, submittedAt, estimatedCostUsd: plan.estimatedCostUsd, model: this.deps.model, status: 'submitted', manifest });
    await this.deps.ledger.record({
      id: batchId,
      kind: 'deep-organize',
      model: this.deps.model,
      at: submittedAt,
      inputTokens: plan.inputTokens,
      outputTokens: plan.outputTokens,
      costUsd: plan.estimatedCostUsd,
      status: 'estimated',
    });

    return this.pollAndApply(batchId);
  }

  /** Resume any batch left non-terminal by a previous session (S27 launch reconciliation). */
  async resume(): Promise<DeepOrganizeOutcome[]> {
    const out: DeepOrganizeOutcome[] = [];
    for (const b of this.deps.batches.pending()) {
      try {
        out.push(await this.pollAndApply(b.batchId));
      } catch {
        /* transient (network/key) — leave it pending; a later launch retries */
      }
    }
    return out;
  }

  private async pollAndApply(batchId: string): Promise<DeepOrganizeOutcome> {
    const interval = this.deps.pollIntervalMs ?? 15_000;
    const maxPolls = this.deps.maxPolls ?? 500;
    for (let i = 0; i < maxPolls; i++) {
      const { status } = await this.deps.transport.retrieveBatch(batchId);
      this.deps.onProgress?.({ phase: 'poll', message: `Batch ${status}…` });
      if (status === 'ended') break;
      if (i === maxPolls - 1) {
        // Never ended within budget of polls — leave it pending for the next launch/resume.
        return { batchId, applied: { notes: 0, themes: 0 }, actualCostUsd: 0, lost: false };
      }
      if (interval > 0) await new Promise((r) => setTimeout(r, interval));
    }

    const results = await this.deps.transport.batchResults(batchId);
    const batch = this.deps.batches.get(batchId);
    const manifestBy = new Map((batch?.manifest ?? []).map((m) => [m.customId, m]));

    let notesApplied = 0;
    let themesApplied = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let anySucceeded = false;
    let anyExpired = false;

    for (const r of results) {
      if (r.type === 'expired') anyExpired = true;
      if (r.type !== 'succeeded' || !r.text) continue;
      anySucceeded = true;
      if (r.usage) {
        inputTokens += r.usage.inputTokens;
        outputTokens += r.usage.outputTokens;
      }
      const m = manifestBy.get(r.customId);
      if (!m) continue;
      if (m.kind === 'note') {
        const raw = safeJson<RawNoteResult>(r.text);
        if (raw) {
          await this.deps.applyNoteResult(m.vaultId, m.ref, raw);
          notesApplied++;
        }
      } else if (m.kind === 'theme') {
        const parsed = safeJson<{ themes?: ThemeResult[] }>(r.text);
        if (parsed?.themes?.length) {
          await this.deps.applyThemes(parsed.themes);
          themesApplied += parsed.themes.length;
        }
      }
    }

    const actualCostUsd = costUsd({ inputTokens, outputTokens }, this.deps.model, { batch: true });

    if (!anySucceeded && anyExpired) {
      // Whole batch expired unfetched — money may have been charged; keep it visible as a loss.
      await this.deps.batches.setStatus(batchId, 'expired');
      await this.deps.ledger.markLost(batchId);
      return { batchId, applied: { notes: 0, themes: 0 }, actualCostUsd: 0, lost: true };
    }

    await this.deps.ledger.reconcile(batchId, { inputTokens, outputTokens, costUsd: actualCostUsd });
    await this.deps.batches.setStatus(batchId, 'reconciled');
    this.deps.onProgress?.({ phase: 'done', message: `Applied ${notesApplied} notes, ${themesApplied} themes.` });
    return { batchId, applied: { notes: notesApplied, themes: themesApplied }, actualCostUsd, lost: false };
  }
}
