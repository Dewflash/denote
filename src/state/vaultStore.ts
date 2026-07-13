// src/state/vaultStore.ts — the ONE place UI components touch to read/mutate vault state.
// Owns the Repository lifecycle for EVERY open vault (pass-05: "Repository holds N open vaults
// concurrently" — D17), the multi-vault registry (`vaults.json` in app support), the watcher
// subscription per open vault, the single ACTIVE vault's open editor buffer (autosave + S23
// dirty-buffer/conflict handling), and the structural-ops undo stack (D38). Components never
// import tauriStorage/watcherBridge/Repository directly — they read `repo` (the active vault)
// off this store for queries and call its wrapper actions for writes, so every write bumps
// `revision` (the one signal consumers use to re-derive from the live index).
//
// "Active" vs "open": exactly one vault is ACTIVE (drives `root`/`vaultId`/`repo`/`buffer` — the
// explorer/editor/backlinks panels all read the active vault). Any number of REGISTERED vaults
// can be OPEN at once (a live Repository + watcher, held in the module-scoped `repos` map below)
// — switching the active vault among already-open ones is just a pointer swap (no I/O), which is
// what makes rail switching feel instant (pass-05 DoD: "<100ms perceived"). The combined graph
// (features/graph) reads across every open vault via `getOpenRepo`, not just the active one.

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { Repository, type IndexChangeHook } from './repository';
import { OpLog } from './opLog';
import { createSearchIndexBinding } from './vaultSearchSync';
import { createVaultAiBinding, type VaultAiEngine } from './vaultAiEngine';
import { createVaultEmbeddingBinding, type VaultEmbeddingEngine } from './vaultEmbeddings';
import { createVaultOntologyBinding, type VaultOntologyEngine, type OrganizeResult, type OrganizePhase, type CancelToken } from './vaultOntologyEngine';
import { useGraphStore } from './graphStore';
import { useUiStore } from './uiStore';
import {
  AiRouter,
  APPLE_ROUTING,
  AppleAiClient,
  MockAiClient,
  AnthropicAiClient,
  createTauriSidecarTransport,
  createAnthropicTransport,
  DEFAULT_DEEP_MODEL,
  type EnrichResult,
} from '../services/aiClient';
import { createTauriEmbeddingsBackend } from '../services/embeddings';
import type { AiAnnotation, SimilarPair } from '../domain';
import type { TakeoverConsent } from './enrichmentQueue';
import { tauriStorage } from '../services/tauriStorage';
import { startWatcherBridge } from '../services/watcherBridge';
import { gitCommitAll, gitHistoryStatus } from '../services/nativeGit';
import { appSupportRoot } from '../services/appSupport';
import { NoteSearchIndex } from '../services/searchIndex';
import { createAppSupportIO } from '../services/appSupportStore';
import { SpendLedger, type SpendRun } from '../services/spendLedger';
import { BatchStore } from '../services/batchStore';
import { CrossVaultStore } from '../services/crossVaultStore';
import {
  readAnthropicKey,
  setAnthropicKey as kcSet,
  hasAnthropicKey as kcHas,
  clearAnthropicKey as kcClear,
} from '../services/keychain';
import { DeepOrganizeJob, type DeepOrganizePlan, type ThemeResult, type RawNoteResult } from './deepOrganize';
import { DeepInsights, type TopicAnalysis } from './deepInsights';
import { CrossVaultEngine } from './crossVaultEngine';
import {
  loadVaultsFile,
  nextVaultColor,
  removeVaultEntry,
  saveVaultsFile,
  upsertVault,
  type VaultRegistryEntry,
} from '../services/vaultRegistry';

export const AUTOSAVE_MS = 800;
export const AUTO_CHECKPOINT_MS = 10 * 60 * 1000;

export interface OpenBuffer {
  relPath: string;
  content: string;
  dirty: boolean;
}

/** S23 rule 3: an external edit landed under a dirty buffer. Never silently merged. */
export interface ConflictState {
  relPath: string;
  diskContent: string;
}

/** Pitfall (pass-05 brief): "moving a registered vault on disk ... on open-failure prompt to
 *  re-locate." Set when `switchVault` can't open a registered entry at its stored path. */
export interface RelocateError {
  vaultId: string;
  expectedPath: string;
}

/** S28: bulk provisional-takeover consent prompt (>20 notes in one vault). */
export interface AiConsentPrompt {
  vaultId: string;
  count: number;
}

interface VaultStoreState {
  // ── the ACTIVE vault ────────────────────────────────────────────────────
  root: string | null;
  vaultId: string | null;
  repo: Repository | null;
  /** Bumped on every write or externally-observed change (any open vault); the one dependency
   *  UI reads for "the live index may have changed, re-derive your view." */
  revision: number;
  activeNotePath: string | null;
  buffer: OpenBuffer | null;
  conflict: ConflictState | null;
  loading: boolean;
  error: string | null;
  readonly opLog: OpLog;

  // ── multi-vault (D17) ──────────────────────────────────────────────────
  /** Every registered vault (`vaults.json`), open or not. */
  registry: VaultRegistryEntry[];
  /** vaultIds currently holding a live Repository + watcher (a snapshot of the module-scoped
   *  `repos` map, kept in state purely so components re-render when it changes). */
  openVaultIds: string[];
  relocateError: RelocateError | null;
  /** S28 consent prompt, when bulk takeover is paused awaiting the owner's answer. */
  aiConsentPrompt: AiConsentPrompt | null;

  openVaultAt: (root: string) => Promise<void>;
  createVaultAt: (root: string) => Promise<void>;
  /** Switch the active vault. Instant if already open; opens it first otherwise. */
  switchVault: (vaultId: string) => Promise<void>;
  /** Tear down a background vault's Repository + watcher (does not touch the registry). */
  closeVault: (vaultId: string) => Promise<void>;
  removeVaultFromRegistry: (vaultId: string) => Promise<void>;
  setVaultColor: (vaultId: string, color: string) => Promise<void>;
  setVaultLocalOnly: (vaultId: string, flag: boolean) => Promise<void>;
  /** Re-point a registered vault at a new on-disk path after `relocateError` (verifies the
   *  folder's `.denote/meta.json` vaultId matches before accepting). */
  relocateVault: (vaultId: string, newPath: string) => Promise<void>;
  clearRelocateError: () => void;
  /** Any OPEN vault's Repository, active or not (the combined graph reads all of them). */
  getOpenRepo: (vaultId: string) => Repository | undefined;
  getSearchIndex: (vaultId: string) => NoteSearchIndex | undefined;
  /** The active vault's AI engine (pass 6): suggestions + accept/reject + manual enrichment. */
  getActiveAiEngine: () => VaultAiEngine | undefined;
  /** Vetted ai-similar pairs (pass 7, S15) across the given open vaults, for the graph. */
  graphSimilarPairs: (vaultIds: string[]) => SimilarPair[];
  /** The active vault's ontology engine (pass 8): topics, insights, Organize-vault. */
  getActiveOntologyEngine: () => VaultOntologyEngine | undefined;
  /** Any OPEN vault's ontology engine (the combined graph inspector may target another vault). */
  getOpenOntologyEngine: (vaultId: string) => VaultOntologyEngine | undefined;
  /** Per-vault domain topics for a set of open vaults (semantic clustering source, pass 8). */
  graphTopics: (vaultIds: string[]) => { vaultId: string; topics: import('../domain').Topic[] }[];
  /** Run the on-device Organize-vault sweep (pass 8): re-enrich, profiles, merge, prune, materialize. */
  organizeActiveVault: (opts?: {
    onProgress?: (done: number, total: number, phase: OrganizePhase) => void;
    signal?: CancelToken;
  }) => Promise<OrganizeResult | undefined>;

  // ── Cloud tier (pass 9): Anthropic key, budget, deep-organize, insights ──────────────
  /** Whether an Anthropic API key is present in the Keychain (Settings presence indicator). */
  anthropicKeyPresent: boolean;
  refreshAnthropicKeyPresence: () => Promise<void>;
  setAnthropicApiKey: (key: string) => Promise<void>;
  clearAnthropicApiKey: () => Promise<void>;
  /** "Test key" button — a cheap round-trip that verifies the stored key. */
  testAnthropicKey: () => Promise<{ ok: boolean; detail?: string }>;
  /** Spend ledger reads (S27): remaining budget this month, the cap, and the run history. */
  spendRemaining: () => number;
  spendCap: () => number;
  setSpendCap: (usd: number) => Promise<void>;
  spendRuns: () => readonly SpendRun[];
  /** Deep-organize (D12/D13): plan (estimate + item count, no submission) then run under the cap. */
  planDeepOrganize: () => Promise<DeepOrganizePlan>;
  runDeepOrganize: (
    plan: DeepOrganizePlan,
    onProgress?: (p: { phase: string; message: string }) => void,
  ) => Promise<{ notes: number; themes: number; costUsd: number; lost: boolean }>;
  /** On-demand topic Analysis (D13): synthesize over a topic's member notes ordered by time. */
  analyzeTopic: (vaultId: string, topicId: string, topicName: string) => Promise<TopicAnalysis>;

  // ── AI (pass 6): all operate on the ACTIVE vault ────────────────────────────
  aiSuggestionsFor: (relPath: string) => AiAnnotation[];
  acceptSuggestion: (id: string) => Promise<void>;
  rejectSuggestion: (id: string) => Promise<void>;
  acceptSuggestionsAbove: (relPath: string) => Promise<void>;
  enrichActiveNote: (opts?: { linksOnly?: boolean }) => Promise<void>;
  resolveAiConsent: (choice: TakeoverConsent) => Promise<void>;
  /** Paste-summarize (pass 7, D27): on-device title + summary + tag suggestions for captured text.
   *  Returns nulls/empties if the backend is unavailable — capture still works, just unassisted. */
  suggestForCapture: (
    text: string,
  ) => Promise<{ title: string; summary: string; tags: string[] }>;
  /** The backend a task currently routes to (for the capture model-picker label). */
  routingBackendFor: (task: 'summarize' | 'enrich') => string;
  /** The full live routing table (Settings → AI). */
  aiRoutingTable: () => Record<string, string>;
  /** Re-route a task to a backend (Settings → AI). Session-scoped; resets to APPLE_ROUTING on
   *  launch (the sensible default). */
  setTaskRouting: (task: string, backend: string) => void;

  /** Opens a note in the editor. By default this also REVEALS the editor (closes the graph /
   *  today overlays) so a click on any note affordance is always visibly answered; pass
   *  `reveal: false` only when the caller manages its own visibility (GraphPage cmd-click). */
  setActiveNote: (relPath: string | null, opts?: { reveal?: boolean }) => Promise<void>;
  updateBufferContent: (content: string) => void;
  flushAutosave: () => Promise<void>;

  createNote: (relPath: string, body?: string) => Promise<void>;
  createFolder: (relDir: string) => Promise<void>;
  renameNote: (oldRel: string, newRel: string) => Promise<void>;
  moveNote: (oldRel: string, newRel: string) => Promise<void>;
  deleteNote: (relPath: string) => Promise<void>;
  bumpRevision: () => void;
  /** S4: "clicking a ghost creates `{target}.md` in the current folder" (verbatim casing). Used
   *  by the editor's live preview, the reading view, and the backlinks/outgoing panels — every
   *  ghost-click affordance in the app goes through this one action. */
  createGhostAndOpen: (target: string, opts?: { reveal?: boolean }) => Promise<void>;

  resolveConflictKeepMine: () => void;
  resolveConflictTakeDisk: () => void;
  resolveConflictViewBoth: () => Promise<void>;
}

// Plumbing that isn't UI-observable state: kept module-scoped, like the single-vault version's
// `stopWatcherBridge`, but now keyed per open vault (N concurrently, D17).
const repos = new Map<string, Repository>();
const searchIndexes = new Map<string, NoteSearchIndex>();
const aiEngines = new Map<string, VaultAiEngine>();
const embeddingEngines = new Map<string, VaultEmbeddingEngine>();
const ontologyEngines = new Map<string, VaultOntologyEngine>();
const watcherTeardowns = new Map<string, () => void>();
const checkpointTimers = new Map<string, ReturnType<typeof setTimeout>>();
const checkpointPaths = new Map<string, Set<string>>();
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

// One AI router shared across all open vaults (routing is global; localOnly is enforced per call
// by the router, D18). Pass 7: on-device Apple Foundation Models handle summarize/enrich/similarity
// (APPLE_ROUTING); the mock stays registered as a fallback + for tests. Anthropic (pass 9) registers
// here later with no other change. Both apple + embeddings talk to the Rust core lazily, so
// constructing them at module load costs nothing until first use.
// Anthropic (pass 9): network-class. The key is read from the macOS Keychain on each call (D13),
// so entering/replacing it in Settings takes effect without a restart. Registering it here lets a
// task be routed to it; the router refuses it for a localOnly vault (D18), and the deep-organize
// assembler refuses it a second time (S27).
const anthropicTransport = createAnthropicTransport(readAnthropicKey);
const sharedRouter = new AiRouter(
  [new MockAiClient(), new AppleAiClient(createTauriSidecarTransport()), new AnthropicAiClient(anthropicTransport)],
  APPLE_ROUTING,
);
const embeddingsBackend = createTauriEmbeddingsBackend();

// App-support-level stores (spend ledger S27, batch durability S27, cross-vault ai-similar S24).
// One instance each, loaded once from disk; `appStoresReady` gates any action that needs them.
const spendLedger = new SpendLedger({ read: async () => null, write: async () => {} });
const batchStore = new BatchStore({ read: async () => null, write: async () => {} });
const crossVaultStore = new CrossVaultStore({ read: async () => null, write: async () => {} });
let appStoresReady: Promise<void> | null = null;

function ensureAppStores(): Promise<void> {
  if (!appStoresReady) {
    appStoresReady = (async () => {
      const io = createAppSupportIO(tauriStorage, await appSupportRoot());
      // Rebind each store's IO to the real app-support directory, then load.
      spendLedger.setIo(io);
      batchStore.setIo(io);
      crossVaultStore.setIo(io);
      await Promise.all([spendLedger.load(), batchStore.load(), crossVaultStore.load()]);
    })();
  }
  return appStoresReady;
}

// Explicit type annotation breaks the crossVaultEngine ↔ useVaultStore inference cycle (the
// engine's `vaults`/`onChange` closures read the store, and the store's `graphSimilarPairs` reads
// the engine — annotating both ends lets TS resolve each independently).
const crossVaultEngine: CrossVaultEngine = new CrossVaultEngine({
  backend: embeddingsBackend,
  router: sharedRouter,
  store: crossVaultStore,
  k: () => useUiStore.getState().similarityTopK,
  minCos: () => useUiStore.getState().similarityMinCos,
  vaults: () =>
    [...repos.values()].map((r) => ({
      vaultId: r.vaultId,
      root: r.root,
      localOnly: useVaultStore.getState().registry.find((v) => v.id === r.vaultId)?.localOnly ?? false,
      notePaths: () =>
        r.index
          .allNotes()
          .filter((n) => !n.relPath.startsWith('_topics/') && !n.relPath.startsWith('.denote/') && n.frontmatter.source !== 'ai')
          .map((n) => n.relPath),
      getHash: (rel: string) => r.getHash(rel),
      stub: (rel: string) => {
        const note = r.getParsed(rel);
        const body = (note?.bodyText ?? '').trim();
        return { relPath: rel, title: note?.title ?? rel, summary: body ? body.split(/\s+/).slice(0, 40).join(' ') : undefined };
      },
    })),
  onChange: () => useVaultStore.setState((s) => ({ revision: s.revision + 1 })),
});

function clearAutosaveTimer(): void {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
}

function vaultLabelFromPath(root: string): string {
  return root.split('/').filter(Boolean).pop() ?? root;
}

async function persistRegistry(vaults: VaultRegistryEntry[]): Promise<void> {
  const appRoot = await appSupportRoot();
  await saveVaultsFile(tauriStorage, appRoot, { version: 1, vaults });
}

function dirOf(relPath: string): string {
  const i = relPath.lastIndexOf('/');
  return i < 0 ? '' : relPath.slice(0, i);
}

function generatedCheckpointMessage(paths: string[]): string {
  const clean = [...new Set(paths)].filter(Boolean).sort();
  if (clean.length === 0) return 'Edited vault';
  const folders = new Set(clean.map((p) => dirOf(p) || 'Inbox'));
  if (folders.size === 1) return `Edited ${clean.length} note${clean.length === 1 ? '' : 's'} in ${[...folders][0]}/`;
  return `Edited ${clean.length} notes across ${folders.size} folders`;
}

function clearCheckpointTimer(vaultId: string): void {
  const timer = checkpointTimers.get(vaultId);
  if (timer) clearTimeout(timer);
  checkpointTimers.delete(vaultId);
}

async function flushHistoryCheckpoint(vaultId: string): Promise<void> {
  clearCheckpointTimer(vaultId);
  const repo = repos.get(vaultId);
  const paths = [...(checkpointPaths.get(vaultId) ?? new Set<string>())];
  checkpointPaths.delete(vaultId);
  if (!repo || paths.length === 0) return;
  try {
    const status = await gitHistoryStatus(repo.root);
    if (!status.enabled) return;
    await gitCommitAll(repo.root, generatedCheckpointMessage(paths));
  } catch {
    // History is opt-in and should never make editing fail.
  }
}

function scheduleHistoryCheckpoint(vaultId: string, relPath: string): void {
  if (relPath.startsWith('.denote/') || relPath.startsWith('.git/')) return;
  const paths = checkpointPaths.get(vaultId) ?? new Set<string>();
  paths.add(relPath);
  checkpointPaths.set(vaultId, paths);
  clearCheckpointTimer(vaultId);
  checkpointTimers.set(vaultId, setTimeout(() => {
    void flushHistoryCheckpoint(vaultId);
  }, AUTO_CHECKPOINT_MS));
}

function isEnrichable(relPath: string, source: unknown): boolean {
  return !relPath.startsWith('_topics/') && !relPath.startsWith('.denote/') && source !== 'ai';
}

/** An on-device "summary" proxy for the corpus (D12: never whole-vault text). Uses the note's
 *  cached membership reason if the ontology has one, else the first ~40 words of the body. */
function summaryProxy(repo: Repository, ontology: VaultOntologyEngine | undefined, relPath: string): string {
  const membered = ontology?.membershipsForNote(relPath) ?? [];
  const note = repo.getParsed(relPath);
  const body = (note?.bodyText ?? '').trim();
  const head = body ? body.split(/\s+/).slice(0, 40).join(' ') : '';
  return head || (membered[0]?.name ? `Relates to ${membered.map((m) => m.name).join(', ')}.` : note?.title ?? relPath);
}

/** Build one non-localOnly vault's corpus contribution for deep-organize. */
function collectVaultCorpus(vaultId: string, localOnly: boolean) {
  const repo = repos.get(vaultId);
  const ontology = ontologyEngines.get(vaultId);
  const notes: import('../domain').CorpusNote[] = [];
  const topics: import('../domain').CorpusTopic[] = [];
  if (repo) {
    for (const n of repo.index.allNotes()) {
      if (!isEnrichable(n.relPath, n.frontmatter.source)) continue;
      const memberships = ontology?.membershipsForNote(n.relPath) ?? [];
      notes.push({
        vaultId,
        relPath: n.relPath,
        title: n.title,
        folder: dirOf(n.relPath),
        summary: summaryProxy(repo, ontology, n.relPath),
        stale: memberships.some((m) => m.stale),
        enriched: memberships.length > 0,
      });
    }
  }
  for (const t of ontology?.domainTopics() ?? []) {
    topics.push({
      vaultId,
      name: t.name,
      memberTitles: t.members
        .slice()
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 6)
        .map((m) => repo?.getParsed(m.notePath)?.title ?? m.notePath),
    });
  }
  return { vaultId, localOnly, notes, topics };
}

/** Convert a cloud RawNoteResult into the EnrichResult shape the AI engine ingests. */
function rawToEnrichResult(raw: RawNoteResult): EnrichResult {
  const clamp01 = (n: number | undefined): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n as number)) : 0);
  const normTag = (s: string): string =>
    s.trim().toLowerCase().replace(/^#+/, '').replace(/[^\p{L}\p{N}_/-]+/gu, '-').replace(/^-+|-+$/g, '');
  return {
    topics: (raw.topics ?? [])
      .filter((t) => (t.name ?? '').trim())
      .map((t) => ({
        name: t.name!.trim(),
        existingTopicId: null,
        reason: (t.reason ?? '').trim(),
        confidence: clamp01(t.confidence),
        ...(t.parentName?.trim() ? { parentName: t.parentName.trim() } : {}),
      })),
    links: (raw.links ?? [])
      .filter((l) => (l.target ?? '').trim())
      .map((l) => ({ target: l.target!.trim(), reason: (l.reason ?? '').trim(), confidence: clamp01(l.confidence) })),
    tags: (raw.tags ?? [])
      .map((t) => ({ name: normTag(t.name ?? ''), reason: (t.reason ?? '').trim(), confidence: clamp01(t.confidence) }))
      .filter((t) => t.name.length > 0),
    summary: (raw.summary ?? '').trim() ? { text: raw.summary!.trim(), reason: 'Cloud deep-organize summary.', confidence: 0.85 } : null,
    aliases: [],
  };
}

/** Construct a DeepOrganizeJob wired to the current open vaults + apply sinks (D13/S27). */
function buildDeepOrganizeJob(onProgress?: (p: { phase: string; message: string }) => void): DeepOrganizeJob {
  return new DeepOrganizeJob({
    transport: anthropicTransport,
    ledger: spendLedger,
    batches: batchStore,
    model: DEFAULT_DEEP_MODEL,
    onProgress,
    vaults: () =>
      [...repos.keys()].map((id) => {
        const localOnly = useVaultStore.getState().registry.find((v) => v.id === id)?.localOnly ?? false;
        return collectVaultCorpus(id, localOnly);
      }),
    async applyNoteResult(vaultId, relPath, raw) {
      await aiEngines.get(vaultId)?.applyEnrichResult(relPath, rawToEnrichResult(raw), `anthropic:${DEFAULT_DEEP_MODEL}`);
    },
    async applyThemes(themes: ThemeResult[]) {
      // A theme's cited note titles may span vaults; each vault that holds ≥2 of them gets the theme
      // as a topic (S25 merges them visually in the combined graph).
      for (const theme of themes) {
        for (const [vaultId, ontology] of ontologyEngines) {
          const members = ontology.relPathsForTitles(theme.memberTitles);
          if (members.length >= 2) {
            void vaultId;
            await ontology.applyTheme({
              name: theme.name,
              description: theme.description,
              reason: theme.reason,
              confidence: theme.confidence,
              members,
            });
          }
        }
      }
    },
  });
}

export const useVaultStore = create<VaultStoreState>((set, get) => {
  // `cause` (external vs app-write-content-change) is not distinguished yet — both mean
  // "the file on disk changed for a reason other than my own in-flight edit." Scoped to the
  // ACTIVE vault + the currently-open buffer; background vaults have no buffer to protect.
  function handlePipeline(vaultId: string, relPath: string): void {
    const s = get();
    if (!s.repo || s.vaultId !== vaultId || s.buffer?.relPath !== relPath) return;
    const wasDirty = s.buffer.dirty;
    const repo = repos.get(vaultId);
    if (!repo) return;
    void repo.readNote(relPath).then((diskContent) => {
      const cur = get();
      if (cur.vaultId !== vaultId || cur.buffer?.relPath !== relPath) return; // switched meanwhile
      if (wasDirty && cur.buffer.dirty) {
        set({ conflict: { relPath, diskContent } });
      } else if (!cur.buffer.dirty) {
        set({ buffer: { relPath, content: diskContent, dirty: false } });
      }
    });
  }

  /** Open (adopt-or-bootstrap, D2) a vault at `root`, register it (new entries only), start its
   *  watcher + search index, and make it the ACTIVE vault. If `root` is already open, just
   *  switches to it (no duplicate Repository/watcher). */
  async function openAndActivate(root: string, mode: 'open' | 'create'): Promise<void> {
    const existingByPath = [...repos.values()].find((r) => r.root === root);
    if (existingByPath) {
      await get().switchVault(existingByPath.vaultId);
      return;
    }

    set({ loading: true, error: null });
    try {
      const index = new NoteSearchIndex();
      const searchBinding = createSearchIndexBinding(index);
      // `onPipeline`/`onIndexChange` must be supplied before the Repository (and therefore its
      // vaultId) exists; both close over this mutable ref instead of a bare `let` reassignment
      // (which some eslint/prefer-const configurations don't recognize across a closure).
      const selfRef: { vaultId?: string } = {};
      // Ontology engine (pass 8): topics + semantic clustering + `_topics` + folder profiles.
      // Created BEFORE the AI binding so the AI engine can feed enrichment topics into it.
      const ontologyBinding = createVaultOntologyBinding({
        backend: embeddingsBackend,
        router: sharedRouter,
        localOnly: () => get().registry.find((v) => v.id === selfRef.vaultId)?.localOnly ?? false,
        onChange: () => set((s) => ({ revision: s.revision + 1 })),
        reenrich: (relPath) => aiEngines.get(selfRef.vaultId ?? '')?.enrichNow(relPath) ?? Promise.resolve(),
      });
      const aiBinding = createVaultAiBinding({
        router: sharedRouter,
        localOnly: () => get().registry.find((v) => v.id === selfRef.vaultId)?.localOnly ?? false,
        threshold: () => useUiStore.getState().aiTakeoverThreshold,
        existingTopics: () => ontologyBinding.getEngine()?.topicStubs() ?? [],
        onEnrichResult: (relPath, hash, result) =>
          ontologyBinding.getEngine()?.onEnrichResult(relPath, hash, result) ?? Promise.resolve(),
        // S23: only defer writes to the note that is OPEN and DIRTY in the ACTIVE editor.
        isDirty: (relPath) => {
          const s = get();
          return s.vaultId === selfRef.vaultId && s.buffer?.relPath === relPath && !!s.buffer?.dirty;
        },
        pushOp: (op) => get().opLog.push(op),
        onChange: () => set((s) => ({ revision: s.revision + 1 })),
        onConsentNeeded: (count) => {
          if (selfRef.vaultId) set({ aiConsentPrompt: { vaultId: selfRef.vaultId, count } });
        },
      });
      // Embeddings + ai-similar edges (pass 7). Local-only embedding; labelSimilarity inherits the
      // D18 boundary via the shared router. Feeds the graph through `graphSimilarPairs`.
      const embeddingBinding = createVaultEmbeddingBinding({
        backend: embeddingsBackend,
        router: sharedRouter,
        localOnly: () => get().registry.find((v) => v.id === selfRef.vaultId)?.localOnly ?? false,
        k: () => useUiStore.getState().similarityTopK,
        minCos: () => useUiStore.getState().similarityMinCos,
        onChange: () => {
          set((s) => ({ revision: s.revision + 1 }));
          // A note's vectors just changed — (re)compute cross-vault edges (S24), debounced.
          crossVaultEngine.schedule();
        },
      });
      const onIndexChange: IndexChangeHook = (relPath, note) => {
        searchBinding.onIndexChange(relPath, note);
        aiBinding.onIndexChange(relPath, note);
        embeddingBinding.onIndexChange(relPath, note);
        ontologyBinding.onIndexChange(relPath, note);
        scheduleHistoryCheckpoint(selfRef.vaultId ?? repo.vaultId, relPath);
        set((s) => ({ revision: s.revision + 1 }));
      };
      const onPipeline = (relPath: string): void => {
        set((s) => ({ revision: s.revision + 1 }));
        if (selfRef.vaultId) handlePipeline(selfRef.vaultId, relPath);
      };

      const repo =
        mode === 'create'
          ? await Repository.createVault(tauriStorage, root, { onPipeline, onIndexChange })
          : await Repository.openVault(tauriStorage, root, { onPipeline, onIndexChange });
      selfRef.vaultId = repo.vaultId;
      await searchBinding.attach(repo);
      const aiEngine = await aiBinding.attach(repo);
      const embeddingEngine = await embeddingBinding.attach(repo);
      const ontologyEngine = await ontologyBinding.attach(repo);

      await invoke('watch_vault', { root });
      const teardown = await startWatcherBridge(root, (evt) => {
        void repo.onWatcherEvent(evt);
      });

      repos.set(repo.vaultId, repo);
      searchIndexes.set(repo.vaultId, index);
      aiEngines.set(repo.vaultId, aiEngine);
      embeddingEngines.set(repo.vaultId, embeddingEngine);
      ontologyEngines.set(repo.vaultId, ontologyEngine);
      watcherTeardowns.set(repo.vaultId, teardown);
      useGraphStore.getState().addOpenVault(repo.vaultId);

      const existingEntry = get().registry.find((v) => v.id === repo.vaultId);
      const entry: VaultRegistryEntry = {
        id: repo.vaultId,
        name: existingEntry?.name ?? vaultLabelFromPath(root),
        path: root, // refresh in case this is a relocate-via-reopen
        color: existingEntry?.color ?? nextVaultColor(get().registry),
        localOnly: existingEntry?.localOnly ?? false,
      };
      const registry = upsertVault({ version: 1, vaults: get().registry }, entry).vaults;
      await persistRegistry(registry);

      set({
        root,
        vaultId: repo.vaultId,
        repo,
        registry,
        openVaultIds: [...repos.keys()],
        loading: false,
        error: null,
        relocateError: null,
        activeNotePath: null,
        buffer: null,
        conflict: null,
        revision: get().revision + 1,
      });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  return {
    root: null,
    vaultId: null,
    repo: null,
    revision: 0,
    activeNotePath: null,
    buffer: null,
    conflict: null,
    loading: false,
    error: null,
    opLog: new OpLog(),

    registry: [],
    openVaultIds: [],
    relocateError: null,
    aiConsentPrompt: null,
    anthropicKeyPresent: false,

    openVaultAt: (root) => openAndActivate(root, 'open'),
    createVaultAt: (root) => openAndActivate(root, 'create'),

    async switchVault(vaultId) {
      if (get().vaultId === vaultId) return;
      const already = repos.get(vaultId);
      if (already) {
        const cur = get();
        if (cur.buffer?.dirty && cur.repo) {
          await cur.repo.saveNote(cur.buffer.relPath, cur.buffer.content);
        }
        clearAutosaveTimer();
        set({
          root: already.root,
          vaultId: already.vaultId,
          repo: already,
          activeNotePath: null,
          buffer: null,
          conflict: null,
          relocateError: null,
          error: null,
          revision: get().revision + 1,
        });
        return;
      }
      const entry = get().registry.find((v) => v.id === vaultId);
      if (!entry) {
        set({ error: `Unknown vault: ${vaultId}` });
        return;
      }
      try {
        await openAndActivate(entry.path, 'open');
      } catch (err) {
        set({
          loading: false,
          relocateError: { vaultId, expectedPath: entry.path },
          error: `Could not open "${entry.name}" at ${entry.path}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },

    async closeVault(vaultId) {
      const repo = repos.get(vaultId);
      if (!repo) return;
      const cur = get();
      if (cur.vaultId === vaultId && cur.buffer?.dirty) {
        await repo.saveNote(cur.buffer.relPath, cur.buffer.content).catch(() => {});
      }
      await flushHistoryCheckpoint(vaultId);
      watcherTeardowns.get(vaultId)?.();
      watcherTeardowns.delete(vaultId);
      await invoke('unwatch_vault', { root: repo.root }).catch(() => {});
      aiEngines.get(vaultId)?.dispose();
      aiEngines.delete(vaultId);
      embeddingEngines.get(vaultId)?.dispose();
      embeddingEngines.delete(vaultId);
      ontologyEngines.get(vaultId)?.dispose();
      ontologyEngines.delete(vaultId);
      repos.delete(vaultId);
      searchIndexes.delete(vaultId);
      checkpointPaths.delete(vaultId);
      clearCheckpointTimer(vaultId);
      useGraphStore.getState().removeOpenVault(vaultId);

      const after = get();
      if (after.vaultId === vaultId) {
        clearAutosaveTimer();
        const next = [...repos.values()][0];
        set({
          root: next?.root ?? null,
          vaultId: next?.vaultId ?? null,
          repo: next ?? null,
          activeNotePath: null,
          buffer: null,
          conflict: null,
          openVaultIds: [...repos.keys()],
          revision: after.revision + 1,
        });
      } else {
        set({ openVaultIds: [...repos.keys()], revision: after.revision + 1 });
      }
    },

    async removeVaultFromRegistry(vaultId) {
      await get().closeVault(vaultId);
      // Cross-vault edges are app-side (S24/D36): drop this vault's when it leaves the registry.
      await ensureAppStores().then(() => crossVaultStore.removeForVault(vaultId)).catch(() => {});
      const registry = removeVaultEntry({ version: 1, vaults: get().registry }, vaultId).vaults;
      await persistRegistry(registry);
      set({ registry });
    },

    async setVaultColor(vaultId, color) {
      const found = get().registry.find((v) => v.id === vaultId);
      if (!found) return;
      const registry = upsertVault({ version: 1, vaults: get().registry }, { ...found, color }).vaults;
      await persistRegistry(registry);
      set({ registry });
    },

    async setVaultLocalOnly(vaultId, flag) {
      const found = get().registry.find((v) => v.id === vaultId);
      if (!found) return;
      const registry = upsertVault(
        { version: 1, vaults: get().registry },
        { ...found, localOnly: flag },
      ).vaults;
      await persistRegistry(registry);
      set({ registry });
    },

    async relocateVault(vaultId, newPath) {
      const found = get().registry.find((v) => v.id === vaultId);
      if (!found) return;
      set({ loading: true, error: null });
      try {
        // Probe-open (never registered as "open" — just verifies identity) so a relocate can
        // never silently adopt an unrelated folder under this registry entry.
        const probe = await Repository.openVault(tauriStorage, newPath, {});
        if (probe.vaultId !== vaultId) {
          set({ loading: false, error: `That folder is a different vault (expected ${found.name}).` });
          return;
        }
        const registry = upsertVault(
          { version: 1, vaults: get().registry },
          { ...found, path: newPath },
        ).vaults;
        await persistRegistry(registry);
        set({ registry, loading: false, relocateError: null });
        await get().switchVault(vaultId);
      } catch (err) {
        set({ loading: false, error: err instanceof Error ? err.message : String(err) });
      }
    },

    clearRelocateError() {
      set({ relocateError: null });
    },

    getOpenRepo: (vaultId) => repos.get(vaultId),
    getSearchIndex: (vaultId) => searchIndexes.get(vaultId),
    getActiveAiEngine: () => {
      const id = get().vaultId;
      return id ? aiEngines.get(id) : undefined;
    },
    graphSimilarPairs: (vaultIds) => [
      ...vaultIds.flatMap((id) => embeddingEngines.get(id)?.similarPairs() ?? []),
      // Cross-vault ai-similar edges (S24) render only when BOTH endpoints are in the selected set.
      ...crossVaultEngine.pairs(vaultIds),
    ],
    getActiveOntologyEngine: () => {
      const id = get().vaultId;
      return id ? ontologyEngines.get(id) : undefined;
    },
    getOpenOntologyEngine: (vaultId) => ontologyEngines.get(vaultId),
    graphTopics: (vaultIds) =>
      vaultIds
        .map((id) => ({ vaultId: id, topics: ontologyEngines.get(id)?.domainTopics() ?? [] }))
        .filter((v) => v.topics.length > 0),
    async organizeActiveVault(opts) {
      return get().getActiveOntologyEngine()?.organizeVault(opts);
    },

    // ── Cloud tier (pass 9) ────────────────────────────────────────────────────────
    async refreshAnthropicKeyPresence() {
      try {
        set({ anthropicKeyPresent: await kcHas() });
      } catch {
        set({ anthropicKeyPresent: false });
      }
    },
    async setAnthropicApiKey(key) {
      await kcSet(key);
      set({ anthropicKeyPresent: true });
    },
    async clearAnthropicApiKey() {
      await kcClear();
      set({ anthropicKeyPresent: false });
    },
    async testAnthropicKey() {
      try {
        return await anthropicTransport.testKey();
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    },
    spendRemaining: () => spendLedger.remaining(),
    spendCap: () => spendLedger.monthlyCap(),
    async setSpendCap(usd) {
      await ensureAppStores();
      await spendLedger.setMonthlyCap(usd);
      set((s) => ({ revision: s.revision + 1 }));
    },
    spendRuns: () => spendLedger.allRuns(),
    async planDeepOrganize() {
      await ensureAppStores();
      return buildDeepOrganizeJob().plan();
    },
    async runDeepOrganize(plan, onProgress) {
      await ensureAppStores();
      const outcome = await buildDeepOrganizeJob(onProgress).run(plan);
      set((s) => ({ revision: s.revision + 1 }));
      return { notes: outcome.applied.notes, themes: outcome.applied.themes, costUsd: outcome.actualCostUsd, lost: outcome.lost };
    },
    async analyzeTopic(vaultId, topicId, topicName) {
      await ensureAppStores();
      const ontology = ontologyEngines.get(vaultId);
      if (!ontology) throw new Error('vault not open');
      const insights = new DeepInsights({ transport: anthropicTransport, ledger: spendLedger, model: DEFAULT_DEEP_MODEL });
      const result = await insights.analyze(topicName, ontology.insightMembers(topicId));
      set((s) => ({ revision: s.revision + 1 }));
      return result;
    },

    aiSuggestionsFor(relPath) {
      return get().getActiveAiEngine()?.suggestionsFor(relPath) ?? [];
    },
    async acceptSuggestion(id) {
      await get().getActiveAiEngine()?.accept(id);
      set((s) => ({ revision: s.revision + 1 }));
    },
    async rejectSuggestion(id) {
      await get().getActiveAiEngine()?.reject(id);
      set((s) => ({ revision: s.revision + 1 }));
    },
    async acceptSuggestionsAbove(relPath) {
      await get().getActiveAiEngine()?.acceptAllAboveThreshold(relPath);
      set((s) => ({ revision: s.revision + 1 }));
    },
    async enrichActiveNote(opts) {
      const s = get();
      const engine = s.getActiveAiEngine();
      if (!engine || !s.activeNotePath) return;
      // Flush any unsaved edits first so enrichment sees the note the user actually wrote.
      if (s.buffer?.dirty) await s.flushAutosave();
      await engine.enrichNow(s.activeNotePath, opts);
      set((cur) => ({ revision: cur.revision + 1 }));
    },
    async resolveAiConsent(choice) {
      const prompt = get().aiConsentPrompt;
      set({ aiConsentPrompt: null });
      if (prompt) await aiEngines.get(prompt.vaultId)?.setTakeoverConsent(choice);
    },

    routingBackendFor: (task) => sharedRouter.getRouting()[task],
    aiRoutingTable: () => sharedRouter.getRouting() as Record<string, string>,
    setTaskRouting: (task, backend) => {
      sharedRouter.setTask(task as never, backend as never);
      set((s) => ({ revision: s.revision + 1 }));
    },
    async suggestForCapture(text) {
      const localOnly = get().registry.find((v) => v.id === get().vaultId)?.localOnly ?? false;
      const firstLine = text.split(/\r?\n/, 1)[0]?.trim().slice(0, 80) || 'Untitled';
      try {
        const summarizer = sharedRouter.route('summarize', { localOnly });
        const enricher = sharedRouter.route('enrich', { localOnly });
        const [{ summary }, enrich] = await Promise.all([
          summarizer.summarize({ text, maxWords: 40 }),
          enricher.enrichNote({
            text,
            title: firstLine,
            folderPath: 'Inbox',
            existingTopics: [],
            candidateNotes: [],
          }),
        ]);
        const title = summary ? summary.split(/\s+/).slice(0, 8).join(' ') : firstLine;
        const tags = enrich.tags.map((t) => t.name).filter(Boolean).slice(0, 6);
        return { title, summary, tags };
      } catch {
        // Backend unavailable / offline without model — capture still works, unassisted.
        return { title: firstLine, summary: '', tags: [] };
      }
    },

    bumpRevision: () => set((s) => ({ revision: s.revision + 1 })),

    async setActiveNote(relPath, opts) {
      clearAutosaveTimer();
      const before = get();
      if (before.buffer?.dirty && before.repo) {
        await before.repo.saveNote(before.buffer.relPath, before.buffer.content);
      }
      if (relPath === null) {
        set({ activeNotePath: null, buffer: null, conflict: null });
        return;
      }
      const repo = get().repo;
      if (!repo) return;
      const content = await repo.readNote(relPath);
      set((s) => ({
        activeNotePath: relPath,
        buffer: { relPath, content, dirty: false },
        conflict: null,
        revision: s.revision + 1,
      }));
      if (opts?.reveal !== false) {
        const ui = useUiStore.getState();
        if (ui.graphViewOpen) ui.setGraphViewOpen(false);
        if (ui.todayViewOpen) ui.setTodayViewOpen(false);
      }
    },

    updateBufferContent(content) {
      set((s) => (s.buffer ? { buffer: { ...s.buffer, content, dirty: true } } : s));
      clearAutosaveTimer();
      autosaveTimer = setTimeout(() => {
        void get().flushAutosave();
      }, AUTOSAVE_MS);
    },

    async flushAutosave() {
      clearAutosaveTimer();
      const s = get();
      if (!s.repo || !s.buffer || !s.buffer.dirty) return;
      const { relPath, content } = s.buffer;
      await s.repo.saveNote(relPath, content);
      const cur = get();
      if (cur.buffer?.relPath === relPath) {
        set({ buffer: { relPath, content, dirty: false }, revision: cur.revision + 1 });
      }
    },

    async createNote(relPath, body = '') {
      const s = get();
      if (!s.repo) return;
      await s.repo.createNote(relPath, body);
      set((cur) => ({ revision: cur.revision + 1 }));
    },

    async createFolder(relDir) {
      const s = get();
      if (!s.repo) return;
      await s.repo.createFolder(relDir);
      set((cur) => ({ revision: cur.revision + 1 }));
    },

    async renameNote(oldRel, newRel) {
      const s = get();
      if (!s.repo) return;
      await s.repo.renameNote(oldRel, newRel);
      s.opLog.push({
        label: `Rename ${oldRel} -> ${newRel}`,
        undo: async () => {
          await get().repo?.renameNote(newRel, oldRel);
          set((cur) => ({
            revision: cur.revision + 1,
            activeNotePath: cur.activeNotePath === newRel ? oldRel : cur.activeNotePath,
            buffer: cur.buffer?.relPath === newRel ? { ...cur.buffer, relPath: oldRel } : cur.buffer,
          }));
        },
        redo: async () => {
          await get().repo?.renameNote(oldRel, newRel);
          set((cur) => ({
            revision: cur.revision + 1,
            activeNotePath: cur.activeNotePath === oldRel ? newRel : cur.activeNotePath,
            buffer: cur.buffer?.relPath === oldRel ? { ...cur.buffer, relPath: newRel } : cur.buffer,
          }));
        },
      });
      set((cur) => ({
        revision: cur.revision + 1,
        activeNotePath: cur.activeNotePath === oldRel ? newRel : cur.activeNotePath,
        buffer: cur.buffer?.relPath === oldRel ? { ...cur.buffer, relPath: newRel } : cur.buffer,
      }));
    },

    async moveNote(oldRel, newRel) {
      const s = get();
      if (!s.repo) return;
      await s.repo.moveNote(oldRel, newRel);
      set((cur) => ({
        revision: cur.revision + 1,
        activeNotePath: cur.activeNotePath === oldRel ? newRel : cur.activeNotePath,
        buffer: cur.buffer?.relPath === oldRel ? { ...cur.buffer, relPath: newRel } : cur.buffer,
      }));
    },

    async deleteNote(relPath) {
      const s = get();
      if (!s.repo) return;
      await s.repo.deleteNote(relPath);
      set((cur) => ({
        revision: cur.revision + 1,
        activeNotePath: cur.activeNotePath === relPath ? null : cur.activeNotePath,
        buffer: cur.buffer?.relPath === relPath ? null : cur.buffer,
      }));
    },

    async createGhostAndOpen(target, opts) {
      const s = get();
      const dir = s.activeNotePath?.includes('/')
        ? s.activeNotePath.slice(0, s.activeNotePath.lastIndexOf('/'))
        : '';
      const relPath = `${dir ? `${dir}/` : ''}${target}.md`;
      try {
        await get().createNote(relPath, `# ${target}\n`);
      } catch {
        /* already exists (race with another creator) — fall through to opening it */
      }
      await get().setActiveNote(relPath, opts);
    },

    resolveConflictKeepMine() {
      set({ conflict: null });
    },

    resolveConflictTakeDisk() {
      const s = get();
      if (!s.conflict) return;
      set({
        buffer: { relPath: s.conflict.relPath, content: s.conflict.diskContent, dirty: false },
        conflict: null,
      });
    },

    async resolveConflictViewBoth() {
      const s = get();
      if (!s.conflict || !s.repo) return;
      const base = s.conflict.relPath.replace(/\.md$/i, '');
      const conflictRel = `${base} (conflict ${Date.now()}).md`;
      await s.repo.createNote(conflictRel, s.conflict.diskContent);
      set((cur) => ({ conflict: null, revision: cur.revision + 1 }));
    },
  };
});

// Fire-and-forget: populate the registry from disk once the store exists. Never blocks vault
// open/create (both work from a folder path directly, independent of the registry load).
void (async () => {
  try {
    const appRoot = await appSupportRoot();
    const file = await loadVaultsFile(tauriStorage, appRoot);
    useVaultStore.setState({ registry: file.vaults });
  } catch {
    /* no Tauri runtime (e.g. a plain-browser dev preview) — registry stays empty */
  }
  // Cloud tier (pass 9): reflect key presence + resume any batch left non-terminal by a prior
  // session (S27 durability). Both swallow the "no Tauri runtime" rejection in a dev preview.
  void useVaultStore.getState().refreshAnthropicKeyPresence();
  void (async () => {
    try {
      await ensureAppStores();
      await buildDeepOrganizeJob().resume();
      useVaultStore.setState((s) => ({ revision: s.revision + 1 }));
    } catch {
      /* no runtime / no pending batches */
    }
  })();
})();
