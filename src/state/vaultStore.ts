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
import { useGraphStore } from './graphStore';
import { useUiStore } from './uiStore';
import {
  AiRouter,
  APPLE_ROUTING,
  AppleAiClient,
  MockAiClient,
  createTauriSidecarTransport,
} from '../services/aiClient';
import { createTauriEmbeddingsBackend } from '../services/embeddings';
import type { AiAnnotation, SimilarPair } from '../domain';
import type { TakeoverConsent } from './enrichmentQueue';
import { tauriStorage } from '../services/tauriStorage';
import { startWatcherBridge } from '../services/watcherBridge';
import { appSupportRoot } from '../services/appSupport';
import { NoteSearchIndex } from '../services/searchIndex';
import {
  loadVaultsFile,
  nextVaultColor,
  removeVaultEntry,
  saveVaultsFile,
  upsertVault,
  type VaultRegistryEntry,
} from '../services/vaultRegistry';

export const AUTOSAVE_MS = 800;

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

  setActiveNote: (relPath: string | null) => Promise<void>;
  updateBufferContent: (content: string) => void;
  flushAutosave: () => Promise<void>;

  createNote: (relPath: string, body?: string) => Promise<void>;
  renameNote: (oldRel: string, newRel: string) => Promise<void>;
  moveNote: (oldRel: string, newRel: string) => Promise<void>;
  deleteNote: (relPath: string) => Promise<void>;
  bumpRevision: () => void;
  /** S4: "clicking a ghost creates `{target}.md` in the current folder" (verbatim casing). Used
   *  by the editor's live preview, the reading view, and the backlinks/outgoing panels — every
   *  ghost-click affordance in the app goes through this one action. */
  createGhostAndOpen: (target: string) => Promise<void>;

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
const watcherTeardowns = new Map<string, () => void>();
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

// One AI router shared across all open vaults (routing is global; localOnly is enforced per call
// by the router, D18). Pass 7: on-device Apple Foundation Models handle summarize/enrich/similarity
// (APPLE_ROUTING); the mock stays registered as a fallback + for tests. Anthropic (pass 9) registers
// here later with no other change. Both apple + embeddings talk to the Rust core lazily, so
// constructing them at module load costs nothing until first use.
const sharedRouter = new AiRouter(
  [new MockAiClient(), new AppleAiClient(createTauriSidecarTransport())],
  APPLE_ROUTING,
);
const embeddingsBackend = createTauriEmbeddingsBackend();

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
      const aiBinding = createVaultAiBinding({
        router: sharedRouter,
        localOnly: () => get().registry.find((v) => v.id === selfRef.vaultId)?.localOnly ?? false,
        threshold: () => useUiStore.getState().aiTakeoverThreshold,
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
        onChange: () => set((s) => ({ revision: s.revision + 1 })),
      });
      const onIndexChange: IndexChangeHook = (relPath, note) => {
        searchBinding.onIndexChange(relPath, note);
        aiBinding.onIndexChange(relPath, note);
        embeddingBinding.onIndexChange(relPath, note);
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

      await invoke('watch_vault', { root });
      const teardown = await startWatcherBridge(root, (evt) => {
        void repo.onWatcherEvent(evt);
      });

      repos.set(repo.vaultId, repo);
      searchIndexes.set(repo.vaultId, index);
      aiEngines.set(repo.vaultId, aiEngine);
      embeddingEngines.set(repo.vaultId, embeddingEngine);
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
      watcherTeardowns.get(vaultId)?.();
      watcherTeardowns.delete(vaultId);
      await invoke('unwatch_vault', { root: repo.root }).catch(() => {});
      aiEngines.get(vaultId)?.dispose();
      aiEngines.delete(vaultId);
      embeddingEngines.get(vaultId)?.dispose();
      embeddingEngines.delete(vaultId);
      repos.delete(vaultId);
      searchIndexes.delete(vaultId);
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
    graphSimilarPairs: (vaultIds) =>
      vaultIds.flatMap((id) => embeddingEngines.get(id)?.similarPairs() ?? []),

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

    async setActiveNote(relPath) {
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

    async createGhostAndOpen(target) {
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
      await get().setActiveNote(relPath);
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
})();
