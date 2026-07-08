// src/state/vaultStore.ts — the ONE place UI components touch to read/mutate vault state.
// Owns the Repository lifecycle (open/create/switch), the watcher subscription, the single
// open editor buffer (autosave + S23 dirty-buffer/conflict handling), and the structural-ops
// undo stack (D38). Components never import tauriStorage/watcherBridge/Repository directly —
// they read `repo` off this store for queries and call its wrapper actions for writes, so every
// write bumps `revision` (the one signal consumers use to re-derive from the live index).
//
// "Single vault for now, rail built for many" (pass-03 brief): only one vault is open at a
// time; `recentVaults` is a locally-persisted MRU list the vault rail renders as one icon per
// entry. The real cross-vault registry (`vaults.json` in app support, D17) arrives in pass 05 —
// using localStorage here is a mechanical stand-in, not a new architecture.

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { Repository } from './repository';
import { OpLog } from './opLog';
import { tauriStorage } from '../services/tauriStorage';
import { startWatcherBridge } from '../services/watcherBridge';

const RECENT_VAULTS_KEY = 'denote:recentVaults';
const MAX_RECENT_VAULTS = 8;
export const AUTOSAVE_MS = 800;

function loadRecentVaults(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_VAULTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

function saveRecentVaults(paths: string[]): void {
  try {
    localStorage.setItem(RECENT_VAULTS_KEY, JSON.stringify(paths));
  } catch {
    /* best-effort; loss of MRU history is not data loss */
  }
}

function addRecent(existing: string[], root: string): string[] {
  return [root, ...existing.filter((p) => p !== root)].slice(0, MAX_RECENT_VAULTS);
}

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

interface VaultStoreState {
  root: string | null;
  vaultId: string | null;
  repo: Repository | null;
  /** Bumped on every write or externally-observed change; the one dependency UI reads for
   *  "the live index may have changed, re-derive your view." */
  revision: number;
  recentVaults: string[];
  activeNotePath: string | null;
  buffer: OpenBuffer | null;
  conflict: ConflictState | null;
  loading: boolean;
  error: string | null;
  readonly opLog: OpLog;

  openVaultAt: (root: string) => Promise<void>;
  createVaultAt: (root: string) => Promise<void>;

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

// Plumbing that isn't UI-observable state: kept module-scoped rather than in the store.
let stopWatcherBridge: (() => void) | null = null;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

function clearAutosaveTimer(): void {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
}

export const useVaultStore = create<VaultStoreState>((set, get) => {
  // `cause` (external vs app-write-content-change) is not distinguished yet — both mean
  // "the file on disk changed for a reason other than my own in-flight edit."
  function handlePipeline(relPath: string): void {
    set((s) => ({ revision: s.revision + 1 }));
    const s = get();
    if (!s.repo || s.buffer?.relPath !== relPath) return;
    const wasDirty = s.buffer.dirty;
    void s.repo.readNote(relPath).then((diskContent) => {
      const cur = get();
      if (cur.buffer?.relPath !== relPath) return; // switched notes meanwhile
      if (wasDirty && cur.buffer.dirty) {
        set({ conflict: { relPath, diskContent } });
      } else if (!cur.buffer.dirty) {
        set({ buffer: { relPath, content: diskContent, dirty: false } });
      }
    });
  }

  async function teardownCurrent(): Promise<void> {
    clearAutosaveTimer();
    stopWatcherBridge?.();
    stopWatcherBridge = null;
    const root = get().root;
    if (root) await invoke('unwatch_vault', { root }).catch(() => {});
  }

  async function open(
    root: string,
    mode: 'open' | 'create',
  ): Promise<void> {
    set({ loading: true, error: null });
    try {
      await teardownCurrent();
      const repo =
        mode === 'create'
          ? await Repository.createVault(tauriStorage, root, { onPipeline: handlePipeline })
          : await Repository.openVault(tauriStorage, root, { onPipeline: handlePipeline });
      await invoke('watch_vault', { root });
      stopWatcherBridge = await startWatcherBridge(root, (evt) => {
        void repo.onWatcherEvent(evt);
      });
      const recentVaults = addRecent(get().recentVaults, root);
      saveRecentVaults(recentVaults);
      set({
        root,
        vaultId: repo.vaultId,
        repo,
        recentVaults,
        loading: false,
        error: null,
        activeNotePath: null,
        buffer: null,
        conflict: null,
        revision: get().revision + 1,
      });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    root: null,
    vaultId: null,
    repo: null,
    revision: 0,
    recentVaults: loadRecentVaults(),
    activeNotePath: null,
    buffer: null,
    conflict: null,
    loading: false,
    error: null,
    opLog: new OpLog(),

    openVaultAt: (root) => open(root, 'open'),
    createVaultAt: (root) => open(root, 'create'),

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
