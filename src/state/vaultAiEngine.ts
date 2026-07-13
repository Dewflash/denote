// src/state/vaultAiEngine.ts — the per-vault AI subsystem: the enrichment pipeline (queue → run
// mock enrichment → store annotations → apply/demote takeover) plus the imperative accept/reject
// actions. One engine per open vault, wired to the Repository's `onIndexChange` (every note
// create/save/rename/external-edit) exactly like search (vaultSearchSync.ts), so it's testable
// against a real temp-dir Repository with no Tauri runtime.
//
// The loop-prevention story (R1) is enforced end to end here:
//   1. contentHash excludes the ai: block (D3a), so a takeover write never changes the hash;
//   2. the takeover/accept writes go through repo.saveNote → tagged app-write (S8), so the
//      watcher echo is classified as our own and drops without firing the pipeline;
//   3. dequeue-time hash-gating (D26): a note already annotated at (hash, model) is skipped.
// Any ONE of these breaks the loop; all three hold. The integration test asserts exactly once.
//
// Open-buffer safety (S23): a takeover/AI write to a note whose editor buffer is DIRTY is
// deferred — the write is skipped and the note re-enqueued; the next clean autosave re-runs the
// pipeline and applies it then. User keystrokes are never clobbered.

import {
  aiBlockUnchanged,
  applyAcceptedAnnotation,
  buildAiFrontmatter,
  decideTakeover,
  isBare,
  normalize,
  rejectionFingerprint,
  writeAiFrontmatter,
  DEFAULT_TAKEOVER_THRESHOLD,
  type AiAnnotation,
  type LinkPayload,
  type ParsedNote,
} from '../domain';
import { AnnotationStore } from '../services/annotationStore';
import { loadMigratedJson } from '../services/migrations';
import { AiRouter, DEFAULT_ROUTING, MockAiClient } from '../services/aiClient';
import type { EnrichResult, NoteStub, TopicStub } from '../services/aiClient';
import { DenoteError } from '../services/errors';
import type { Op } from './opLog';
import type { Repository } from './repository';
import { EnrichmentQueue, QUEUE_PATH, type TakeoverConsent } from './enrichmentQueue';
import type { AiLinkSuggestion } from '../domain/graphBuilder';

export const ENRICH_DEBOUNCE_MS = 2000;
/** S28: bulk provisional takeover past this many notes prompts for consent once per vault. */
export const CONSENT_THRESHOLD = 20;
export type AiQueueState = 'idle' | 'queued' | 'parked';

type BackendGate = {
  key: string;
  available: boolean;
  reason?: string;
};

type PumpGate = 'available' | 'unavailable' | 'local-only-blocked';

export interface VaultAiEngineDeps {
  now?: () => number;
  /** The vault's localOnly flag (D18) — read fresh so a Settings toggle takes effect at once. */
  localOnly?: () => boolean;
  /** The takeover confidence threshold (S10 default 0.75; Settings → AI slider). */
  threshold?: () => number;
  /** True while the note's editor buffer has unsaved keystrokes (S23 deferral). */
  isDirty?: (relPath: string) => boolean;
  /** Push a structural op onto the repository op-log so accept/takeover are undoable (D38/S23). */
  pushOp?: (op: Op) => void;
  /** Notify the UI that annotations/state changed (bump a revision). */
  onChange?: () => void;
  /** Called when the S28 consent prompt should be shown (bulk takeover paused). */
  onConsentNeeded?: (pendingCount: number) => void;
  /** Existing-topic stubs to feed each enrichNote prompt so the model attaches, not invents
   *  (D14/R3 mandatory retrieval step). Supplied by the ontology engine (pass 8). */
  existingTopics?: () => TopicStub[];
  /** Fold an enrichment result's topics into the persistent ontology (pass 8 canonicalization). */
  onEnrichResult?: (relPath: string, hash: string, result: EnrichResult) => Promise<void>;
  /** Retrieve embedding-ranked neighbor summaries for the enrichment prompt (D12/S16). */
  candidateNotes?: (relPath: string) => Promise<NoteStub[]> | NoteStub[];
  /** Test hook: disable the internal debounce timer so enqueue() is a no-op timer-wise. */
  disableTimers?: boolean;
}

const ENRICHABLE_SKIP_DIRS = ['_topics/', '.denote/'];

export class VaultAiEngine {
  private readonly now: () => number;
  private readonly queue = new EnrichmentQueue();
  private pumpTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pumping = false;
  private started = false;
  /** One capability probe gates a whole pump, so an unavailable model cannot cause one doomed
   * generation attempt per note followed by repeated backoff work. */
  private backendGate: BackendGate | null = null;
  private idSeq = 0;
  // Chain of background work started from onIndexChange (demotion, delete cleanup). `settle()`
  // awaits it — used by tests for determinism; harmless in production.
  private inflight: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly repo: Repository,
    private readonly router: AiRouter,
    private readonly store: AnnotationStore,
    private readonly deps: VaultAiEngineDeps = {},
  ) {
    this.now = deps.now ?? Date.now;
  }

  // ── lifecycle ────────────────────────────────────────────────────────────────

  /** Load persisted annotations + queue and register the D4a/delete hooks. */
  async attach(): Promise<void> {
    await this.store.load();
    const queueResult = await loadMigratedJson({
      read: (p) => this.repo.readInternal(p),
      write: (p, c) => this.repo.writeInternal(p, c),
      delete: (p) => this.repo.deleteInternal(p),
    }, QUEUE_PATH);
    this.queue.loadFrom(queueResult?.ok ? JSON.stringify(queueResult.data) : null);
    this.repo.registerRekeyHook((oldRel, newRel) => this.store.remapPath(oldRel, newRel));
    this.repo.registerDeleteHook((rel) => {
      this.queue.remove(rel);
      this.cancelDebounce(rel);
      return this.store.removeForPath(rel);
    });
    if (this.seedMissingNotes()) await this.persistQueue();
  }

  /** Start background work after the other per-vault engines have attached. This ordering keeps
   * the first enrichment pass connected to ontology retrieval instead of racing vaultStore's
   * embedding/ontology setup. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.schedulePump();
  }

  /** Tear down timers (vault close / test cleanup). */
  dispose(): void {
    this.started = false;
    if (this.pumpTimer) clearTimeout(this.pumpTimer);
    this.pumpTimer = null;
    for (const t of this.debounceTimers.values()) clearTimeout(t);
    this.debounceTimers.clear();
  }

  // ── reads (for the UI) ─────────────────────────────────────────────────────────

  /** Live suggestions/provisional entries for the note at its CURRENT content hash. */
  suggestionsFor(relPath: string): AiAnnotation[] {
    const hash = this.repo.getHash(relPath);
    if (!hash) return [];
    return this.store.liveFor(relPath, hash);
  }

  parkedCount(): number {
    return this.queue.parkedCount();
  }

  queueStateFor(relPath: string): AiQueueState {
    const state = this.queue.get(relPath)?.state;
    return state === 'parked' ? 'parked' : state ? 'queued' : 'idle';
  }
  getConsent(): TakeoverConsent {
    return this.queue.getConsent();
  }

  /** Retry parked work after the user has restored the on-device backend. */
  retry(): void {
    this.backendGate = null;
    this.seedMissingNotes();
    this.queue.resumeParked(this.now());
    void this.persistQueue();
    if (this.started) this.schedulePump();
  }

  /** Live AI link suggestions are graph edges before the user accepts them. They are deliberately
   * separate from typed wikilinks and from similarity edges so the inspector can explain exactly
   * why a connection is present. */
  graphLinkSuggestions(): AiLinkSuggestion[] {
    const links: AiLinkSuggestion[] = [];
    for (const ann of this.store.liveAll()) {
      if (ann.kind !== 'link' || this.repo.getHash(ann.notePath) !== ann.contentHash) continue;
      const payload = ann.payload as LinkPayload;
      if (!payload.target.trim()) continue;
      links.push({
        vaultId: this.repo.vaultId,
        relPath: ann.notePath,
        target: payload.target,
        targetPath: payload.targetPath,
        reason: ann.reason,
        confidence: ann.confidence,
      });
    }
    return links;
  }

  // ── change trigger (from Repository.onIndexChange) ─────────────────────────────

  /** A note was upserted (`note` non-null) or removed (`note` null). Demotion is applied
   *  immediately (cheap, no AI); enrichment is debounced. */
  noteChanged(relPath: string, note: ParsedNote | null): void {
    if (note === null) {
      this.queue.remove(relPath);
      this.cancelDebounce(relPath);
      this.track(this.store.removeForPath(relPath));
      return;
    }
    // S10 demotion: a note carrying an ai: block that now has user structure loses it at once.
    if (note.aiFrontmatter && !isBare(note)) {
      this.track(this.demote(relPath));
    }
    this.scheduleEnqueue(relPath);
  }

  private track(p: Promise<unknown>): void {
    this.inflight = this.inflight.then(() => p, () => p);
  }

  /** Await all background work triggered by note changes (demotion, delete cleanup). */
  async settle(): Promise<void> {
    let prev: Promise<unknown>;
    do {
      prev = this.inflight;
      await prev.catch(() => {});
    } while (prev !== this.inflight);
  }

  // ── manual commands (command palette) ──────────────────────────────────────────

  /** "Enrich this note now": bypass the debounce and the redundant-hash gate; still respects the
   *  path/source/localOnly gates. */
  async enrichNow(relPath: string, opts: { linksOnly?: boolean } = {}): Promise<void> {
    this.cancelDebounce(relPath);
    await this.runEnrichment(relPath, { force: true, linksOnly: opts.linksOnly });
    await this.persistQueue();
  }

  // ── accept / reject (imperative) ────────────────────────────────────────────────

  /** Accept a suggestion: write the real markdown, mark it accepted, and (D30) demote the note's
   *  remaining provisional entries. Registered on the op-log as one undoable step. */
  async accept(id: string): Promise<void> {
    const ann = this.store.get(id);
    if (!ann) return;
    const relPath = ann.notePath;
    const before = normalize(await this.repo.readNote(relPath));
    // Applying real structure counts as curation → also strip any provisional ai: block (D30).
    const after = writeAiFrontmatter(applyAcceptedAnnotation(before, ann), null);
    if (after !== before) await this.repo.saveNote(relPath, after);

    const demotedIds = this.store
      .allFor(relPath)
      .filter((a) => a.status === 'applied-provisional')
      .map((a) => a.id);
    await this.store.setStatusFor(demotedIds, 'suggested');
    await this.store.setStatus(id, 'accepted');
    this.deps.onChange?.();

    this.deps.pushOp?.({
      label: `Accept ${ann.kind} suggestion`,
      undo: async () => {
        if (after !== before) await this.repo.saveNote(relPath, before);
        await this.store.setStatus(id, 'suggested');
        this.deps.onChange?.();
      },
      redo: async () => {
        if (after !== before) await this.repo.saveNote(relPath, after);
        await this.store.setStatusFor(demotedIds, 'suggested');
        await this.store.setStatus(id, 'accepted');
        this.deps.onChange?.();
      },
    });
  }

  /** Reject a suggestion → rejection memory (D10/S11): never re-surfaced for identical content. */
  async reject(id: string): Promise<void> {
    const ann = this.store.get(id);
    if (!ann) return;
    if (ann.status === 'applied-provisional') {
      // A provisional entry has two representations: the live annotation and the persisted
      // `ai:` block. Remove both atomically from the user's point of view; otherwise Reject would
      // hide the row while the graph rebuilt from Markdown and resurrected the rejected edge/tag.
      const relPath = ann.notePath;
      const before = normalize(await this.repo.readNote(relPath));
      const remaining = this.store
        .allFor(relPath)
        .filter((a) => a.id !== id && a.status === 'applied-provisional');
      const parsed = this.repo.getParsed(relPath);
      const model = parsed?.aiFrontmatter?.model ?? ann.model;
      const appliedAt = parsed?.aiFrontmatter?.applied ?? new Date(this.now()).toISOString();
      const after = writeAiFrontmatter(
        before,
        remaining.length > 0 ? buildAiFrontmatter(remaining, model, appliedAt) : null,
      );
      if (after !== before) await this.repo.saveNote(relPath, after);
    }
    await this.store.reject(ann);
    this.deps.onChange?.();
  }

  /** Accept every suggestion for a note whose confidence is at/above the takeover threshold. */
  async acceptAllAboveThreshold(relPath: string): Promise<void> {
    const threshold = this.deps.threshold?.() ?? DEFAULT_TAKEOVER_THRESHOLD;
    const ids = this.suggestionsFor(relPath)
      .filter((a) => a.status === 'suggested' && a.confidence >= threshold)
      .map((a) => a.id);
    for (const id of ids) await this.accept(id);
  }

  // ── S28 consent ─────────────────────────────────────────────────────────────────

  async setTakeoverConsent(choice: TakeoverConsent): Promise<void> {
    this.queue.setConsent(choice);
    await this.persistQueue();
    this.deps.onChange?.();
    if (choice === 'apply') {
      // Re-run takeover for notes whose apply was held pending consent.
      for (const relPath of this.repo.listNotePaths()) await this.applyTakeover(relPath);
    }
  }

  // ── enrichment pipeline ───────────────────────────────────────────────────────────

  private async runEnrichment(
    relPath: string,
    opts: { force?: boolean; linksOnly?: boolean } = {},
  ): Promise<void> {
    const note = this.repo.getParsed(relPath);
    const hash = this.repo.getHash(relPath);
    if (!note || !hash) return;
    if (this.shouldSkip(relPath, note)) return;

    const localOnly = this.deps.localOnly?.() ?? false;
    let client;
    try {
      client = this.router.route('enrich', { localOnly }); // D18 boundary (may throw)
    } catch (err) {
      // localOnly vault routed to a network backend (D18): the note is simply not enriched;
      // this is not an error that should block editing or park the job.
      if (err instanceof DenoteError && err.kind === 'local-only-blocked') return;
      throw err; // ai-unavailable etc. → let the pump park the job (S12)
    }

    // Hash-gating (D26): already annotated at this (hash, model)? Skip unless forced.
    if (!opts.force && this.store.hasAnnotationsFor(relPath, hash, client.modelId)) return;

    const capabilities = await this.checkCapabilities(client, localOnly);
    if (!capabilities.available) {
      throw new DenoteError(
        'ai-unavailable',
        capabilities.reason ?? 'The selected AI backend is unavailable.',
        { retryable: true },
      );
    }

    let result: EnrichResult;
    try {
      const retrievedCandidates = await this.deps.candidateNotes?.(relPath);
      result = await client.enrichNote({
        text: note.bodyText || '',
        title: note.title,
        folderPath: dirOf(relPath),
        existingTopics: this.deps.existingTopics?.() ?? [], // D14/R3 retrieval (pass 8 ontology)
        candidateNotes: retrievedCandidates && retrievedCandidates.length > 0
          ? retrievedCandidates
          : this.candidateNotes(relPath),
      });
    } catch (error) {
      const reason = this.backendUnavailableReason(error);
      if (!reason) throw error;
      if (error instanceof DenoteError && error.kind === 'ai-timeout') throw error;
      this.backendGate = {
        key: this.backendKey(client, localOnly),
        available: false,
        reason,
      };
      throw new DenoteError('ai-unavailable', reason, { retryable: true });
    }

    await this.ingestResult(relPath, hash, client.modelId, result, opts.linksOnly);
  }

  /**
   * Land a cloud (deep-organize) enrich result for a note (D13/pass-9). Cloud output gets NO
   * bypass of canonicalization (D14) or takeover (D9) — it flows through the exact same ingest
   * path as on-device enrichment: annotations (suggested, rejection-filtered) + ontology fold +
   * takeover. Hash-gate is bypassed (the batch already decided to spend on this note).
   */
  async applyEnrichResult(relPath: string, result: EnrichResult, modelId: string): Promise<void> {
    const hash = this.repo.getHash(relPath);
    const note = this.repo.getParsed(relPath);
    if (!hash || !note || this.shouldSkip(relPath, note)) return;
    await this.ingestResult(relPath, hash, modelId, result, false);
  }

  /** Shared post-enrichment ingest: ontology fold (D14) → annotations (D10 rejection filter) →
   *  takeover (D9). Used by both on-device enrichment and cloud deep-organize. */
  private async ingestResult(
    relPath: string,
    hash: string,
    modelId: string,
    result: EnrichResult,
    linksOnly?: boolean,
  ): Promise<void> {
    // Fold topics into the persistent ontology (canonicalization + membership, D14). Best-effort:
    // a failure here must not park the enrichment job or lose the panel suggestions below.
    if (!linksOnly) {
      try {
        await this.deps.onEnrichResult?.(relPath, hash, result);
      } catch {
        /* ontology update failed — suggestions still land; Organize-vault can rebuild later */
      }
    }

    const anns = this.annotationsFromResult(relPath, hash, modelId, result, linksOnly);
    // Rejection memory (D10/S11): drop anything rejected for this exact content.
    const kept = anns.filter((a) => !this.store.isRejected(rejectionFingerprint(a.kind, a.payload), hash));

    if (linksOnly) {
      // Merge: keep existing non-link live annotations, replace links only.
      const existing = this.store.liveFor(relPath, hash).filter((a) => a.kind !== 'link');
      await this.store.replaceLiveFor(relPath, [...existing, ...kept]);
    } else {
      await this.store.replaceLiveFor(relPath, kept);
    }
    this.deps.onChange?.();

    await this.applyTakeover(relPath);
  }

  /** S10 takeover: apply provisional structure to a BARE note whose suggestions clear the
   *  threshold. Idempotent; deferred if the buffer is dirty (S23); gated by consent (S28). */
  private async applyTakeover(relPath: string): Promise<void> {
    const note = this.repo.getParsed(relPath);
    const hash = this.repo.getHash(relPath);
    if (!note || !hash) return;
    const threshold = this.deps.threshold?.() ?? DEFAULT_TAKEOVER_THRESHOLD;
    const decision = decideTakeover(note, this.store.liveFor(relPath, hash), { threshold });
    if (decision.action !== 'apply') return;

    // S28 consent: pause bulk takeover past the threshold until the user answers once.
    const consent = this.queue.getConsent();
    if (consent === 'none') return; // suggestions-only mode
    if (consent === 'ask' && !this.noteHasProvisional(relPath)) {
      if (this.provisionalNoteCount() + 1 > CONSENT_THRESHOLD) {
        this.deps.onConsentNeeded?.(this.provisionalNoteCount() + 1);
        return;
      }
    }

    const model = decision.apply[0]?.model ?? 'mock@1';
    const ai = buildAiFrontmatter(decision.apply, model, new Date(this.now()).toISOString());
    const text = normalize(await this.repo.readNote(relPath));
    if (aiBlockUnchanged(text, ai)) {
      // Nothing to write, but make sure statuses reflect the applied state.
      await this.store.setStatusFor(decision.apply.map((a) => a.id), 'applied-provisional');
      this.deps.onChange?.();
      return;
    }
    if (this.deps.isDirty?.(relPath)) {
      // S23: never write into a dirty buffer — re-enqueue; the next clean save re-runs this.
      this.queue.enqueue(relPath, hash);
      this.schedulePump();
      return;
    }
    await this.repo.saveNote(relPath, writeAiFrontmatter(text, ai));
    await this.store.setStatusFor(decision.apply.map((a) => a.id), 'applied-provisional');
    this.deps.onChange?.();
  }

  /** S10 demotion: strip the ai: block and return provisional entries to plain suggestions. */
  private async demote(relPath: string): Promise<void> {
    const text = normalize(await this.repo.readNote(relPath).catch(() => ''));
    if (text && !aiBlockUnchanged(text, null)) {
      if (this.deps.isDirty?.(relPath)) return; // defer; a later clean change re-triggers demotion
      await this.repo.saveNote(relPath, writeAiFrontmatter(text, null));
    }
    const ids = this.store.allFor(relPath).filter((a) => a.status === 'applied-provisional').map((a) => a.id);
    if (ids.length) {
      await this.store.setStatusFor(ids, 'suggested');
      this.deps.onChange?.();
    }
  }

  // ── pump (queue processing; one job at a time per vault, D29) ─────────────────────

  private scheduleEnqueue(relPath: string): void {
    if (this.deps.disableTimers) return; // tests drive enrichNow() explicitly
    this.cancelDebounce(relPath);
    const t = setTimeout(() => {
      this.debounceTimers.delete(relPath);
      const hash = this.repo.getHash(relPath);
      if (hash) {
        this.queue.enqueue(relPath, hash);
        void this.persistQueue();
        this.schedulePump();
      }
    }, ENRICH_DEBOUNCE_MS);
    this.debounceTimers.set(relPath, t);
  }

  private schedulePump(): void {
    if (this.deps.disableTimers || !this.started || this.pumpTimer || this.pumping) return;
    const due = this.queue.due(this.now());
    if (due.length === 0) {
      // Schedule for the soonest future backoff, if any.
      const next = this.queue
        .all()
        .filter((j) => j.state === 'pending')
        .reduce<number | null>((min, j) => (min === null ? j.nextAttemptAt : Math.min(min, j.nextAttemptAt)), null);
      if (next !== null) this.pumpTimer = setTimeout(() => this.runPump(), Math.max(0, next - this.now()));
      return;
    }
    this.pumpTimer = setTimeout(() => this.runPump(), 0);
  }

  private async runPump(): Promise<void> {
    this.pumpTimer = null;
    if (this.pumping) return;
    this.pumping = true;
    try {
      const due = this.queue.due(this.now());
      if (due.length === 0) return;

      const gate = await this.preflightBackend();
      if (gate !== 'available') {
        // Preserve work across a backend or privacy-policy change. The vault may become eligible
        // again later, and retry() will re-check the route before waking these jobs.
        this.queue.parkPending();
        await this.persistQueue();
        this.deps.onChange?.();
        return;
      }

      for (const job of due) {
        this.queue.markRunning(job.relPath);
        try {
          await this.runEnrichment(job.relPath);
          this.queue.remove(job.relPath);
        } catch (error) {
          if (this.backendUnavailableReason(error)) {
            // The backend can fail after preflight. Stop immediately and park the rest of the
            // batch; an explicit Retry is the only path that wakes it again.
            this.queue.park(job.relPath);
            this.queue.parkPending();
            await this.persistQueue();
            this.deps.onChange?.();
            break;
          }
          this.queue.fail(job.relPath, this.now());
        }
        await this.persistQueue();
      }
    } finally {
      this.pumping = false;
      this.schedulePump();
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────────

  private shouldSkip(relPath: string, note: ParsedNote): boolean {
    if (ENRICHABLE_SKIP_DIRS.some((d) => relPath.startsWith(d))) return true;
    if (note.frontmatter.source === 'ai') return true; // D26: materialized topic hubs
    return false;
  }

  private backendKey(client: { id: string; modelId: string }, localOnly: boolean): string {
    return `${client.id}:${client.modelId}:${localOnly ? 'local-only' : 'network-allowed'}`;
  }

  private async checkCapabilities(
    client: { id: string; modelId: string; capabilities: () => Promise<{ available: boolean; reason?: string }> },
    localOnly: boolean,
  ): Promise<{ available: boolean; reason?: string }> {
    const key = this.backendKey(client, localOnly);
    if (this.backendGate?.key === key) return this.backendGate;

    try {
      const capabilities = await client.capabilities();
      this.backendGate = {
        key,
        available: capabilities.available,
        reason: capabilities.reason,
      };
    } catch (error) {
      this.backendGate = {
        key,
        available: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    return this.backendGate;
  }

  private async preflightBackend(): Promise<PumpGate> {
    const localOnly = this.deps.localOnly?.() ?? false;
    let client;
    try {
      client = this.router.route('enrich', { localOnly });
    } catch (error) {
      if (error instanceof DenoteError && error.kind === 'local-only-blocked') {
        return 'local-only-blocked';
      }
      return 'unavailable';
    }
    const capabilities = await this.checkCapabilities(client, localOnly);
    return capabilities.available ? 'available' : 'unavailable';
  }

  private backendUnavailableReason(error: unknown): string | null {
    if (error instanceof DenoteError && (error.kind === 'ai-unavailable' || error.kind === 'ai-timeout')) {
      return error.message;
    }
    const detail = error instanceof Error ? error.message : String(error);
    if (/(ai-unavailable|ai-timeout|timed out|model manager|apple foundation models could not start|sidecar (?:binary|spawn|closed|write|call)|repeatedly.*disabled)/i.test(detail)) {
      return detail;
    }
    return null;
  }

  /** Initial Repository indexing intentionally does not call onIndexChange. Seed only missing
   *  work here so an already-open vault is enriched automatically, without resetting parked or
   *  already-running jobs on every app launch. */
  private seedMissingNotes(): boolean {
    let model: string | undefined;
    try {
      model = this.router.route('enrich', { localOnly: this.deps.localOnly?.() ?? false }).modelId;
    } catch {
      // Keep unannotated notes queued even when the backend is not registered yet. A routing
      // change calls retry(), which re-runs this check once a backend becomes available.
    }

    let changed = false;
    for (const note of this.repo.index.allNotes()) {
      if (this.shouldSkip(note.relPath, note)) continue;
      const hash = this.repo.getHash(note.relPath);
      if (!hash) continue;
      const job = this.queue.get(note.relPath);
      if (job?.contentHash === hash) continue;

      const alreadyAnnotated = model
        ? this.store.hasAnnotationsFor(note.relPath, hash, model)
        : this.store.hasAnnotationsForHash(note.relPath, hash);
      if (alreadyAnnotated) {
        if (job) {
          this.queue.remove(note.relPath);
          changed = true;
        }
        continue;
      }
      this.queue.enqueue(note.relPath, hash);
      changed = true;
    }
    return changed;
  }

  private candidateNotes(selfPath: string) {
    const out: { relPath: string; title: string }[] = [];
    for (const n of this.repo.index.allNotes()) {
      if (n.relPath === selfPath) continue;
      if (n.frontmatter.source === 'ai') continue;
      if (ENRICHABLE_SKIP_DIRS.some((d) => n.relPath.startsWith(d))) continue;
      // Before the embedding store is ready, use a bounded opening excerpt as a temporary summary
      // proxy. Never send the full body, and replace this fallback with ranked neighbors as soon
      // as the local embedding engine is available.
      const excerpt = n.bodyText.trim().split(/\s+/).filter(Boolean).slice(0, 40).join(' ');
      out.push({ relPath: n.relPath, title: n.title, ...(excerpt ? { summary: excerpt } : {}) });
      if (out.length >= 25) break;
    }
    return out;
  }

  private annotationsFromResult(
    relPath: string,
    hash: string,
    model: string,
    result: EnrichResult,
    linksOnly?: boolean,
  ): AiAnnotation[] {
    const anns = new Map<string, AiAnnotation>();
    const at = new Date(this.now()).toISOString();
    const mk = (kind: AiAnnotation['kind'], payload: unknown, confidence: number, reason: string): void => {
      const annotation: AiAnnotation = {
        id: `ai-${hash.slice(0, 8)}-${this.idSeq++}`,
        notePath: relPath,
        contentHash: hash,
        kind,
        payload,
        confidence,
        reason,
        status: 'suggested',
        model,
        createdAt: at,
      };
      const key = annotationKey(kind, payload);
      const previous = anns.get(key);
      // Models occasionally repeat an item. Keep the strongest instance so the panel, graph, and
      // accept-all action operate on one stable suggestion per target/category.
      if (!previous || annotation.confidence > previous.confidence) anns.set(key, annotation);
    };
    for (const l of result.links) {
      mk('link', { target: l.target, targetPath: l.targetPath } satisfies LinkPayload, l.confidence, l.reason);
    }
    if (linksOnly) return [...anns.values()];
    for (const t of result.tags) mk('tag', { name: t.name }, t.confidence, t.reason);
    for (const t of result.topics) {
      mk('topic', { name: t.name, existingTopicId: t.existingTopicId }, t.confidence, t.reason);
    }
    for (const a of result.aliases) mk('alias', { name: a.name }, a.confidence, a.reason);
    if (result.summary) mk('summary', { text: result.summary.text }, result.summary.confidence, result.summary.reason);
    return [...anns.values()];
  }

  private noteHasProvisional(relPath: string): boolean {
    return this.store.allFor(relPath).some((a) => a.status === 'applied-provisional');
  }

  private provisionalNoteCount(): number {
    const paths = new Set<string>();
    for (const p of this.repo.listNotePaths()) {
      if (this.noteHasProvisional(p)) paths.add(p);
    }
    return paths.size;
  }

  private cancelDebounce(relPath: string): void {
    const t = this.debounceTimers.get(relPath);
    if (t) {
      clearTimeout(t);
      this.debounceTimers.delete(relPath);
    }
  }

  /** Persist the queue + consent to the (rebuildable, D3) cache. Best-effort: a write failure
   *  never surfaces — the queue is disposable and reconstructed from note state. */
  private persistQueue(): Promise<void> {
    return this.repo
      .writeInternal(QUEUE_PATH, JSON.stringify(this.queue.toJSON(), null, 2) + '\n')
      .catch(() => {});
  }
}

function dirOf(relPath: string): string {
  const i = relPath.lastIndexOf('/');
  return i < 0 ? '' : relPath.slice(0, i);
}

function annotationKey(kind: AiAnnotation['kind'], payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  const value = kind === 'link'
    ? p.targetPath ?? p.target
    : kind === 'summary'
      ? 'summary'
      : p.name;
  return `${kind}:${String(value ?? '').trim().toLowerCase()}`;
}

// ── binding factory (mirrors createSearchIndexBinding) ───────────────────────────────

export interface AiBindingOptions extends VaultAiEngineDeps {
  router?: AiRouter;
}

/** Build the engine + the `onIndexChange` hook + an `attach(repo)` finisher, matching the
 *  search binding's shape so vaultStore composes both into one Repository hook. */
export function createVaultAiBinding(opts: AiBindingOptions = {}): {
  onIndexChange: (relPath: string, note: ParsedNote | null) => void;
  attach: (repo: Repository) => Promise<VaultAiEngine>;
  getEngine: () => VaultAiEngine | undefined;
} {
  let engine: VaultAiEngine | undefined;
  const router = opts.router ?? new AiRouter([new MockAiClient()], DEFAULT_ROUTING);
  return {
    onIndexChange(relPath, note) {
      engine?.noteChanged(relPath, note);
    },
    async attach(repo: Repository) {
      const store = new AnnotationStore(
        { read: (p) => repo.readInternal(p), write: (p, c) => repo.writeInternal(p, c), delete: (p) => repo.deleteInternal(p) },
        opts.now,
      );
      engine = new VaultAiEngine(repo, router, store, opts);
      await engine.attach();
      return engine;
    },
    getEngine: () => engine,
  };
}
