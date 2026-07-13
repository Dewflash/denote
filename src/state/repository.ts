// src/state/repository.ts — the Repository: the ONLY path through which vault files are
// mutated (D2/D29). It owns the live index (VaultIndex), tags every write so the watcher can
// tell the app's own echoes from external edits (S8/D23), keeps indexes live under external
// changes, and implements rename/move/retitle reconciliation (S9/D4/D4a) and copy-on-write
// snapshots (D21).
//
// Concurrency (S7/D29): all mutations to one relPath serialize on a per-note lock; watcher
// events serialize on a single per-vault chain (one pipeline instance per vault).

import { contentHash, normalize, parseNote } from '../domain';
import type { ParsedNote, VaultId, WikiLink } from '../domain';
import type { ResolvedLink } from '../domain/links';
import {
  isIgnoredPath,
  type RawWatcherEvent,
  type StorageBackend,
} from '../services/storage';
import { DenoteError } from '../services/errors';
import {
  parseSnapshotName,
  selectExpired,
  selectOverCap,
  shouldSnapshot,
  snapshotFileName,
  type SnapshotFile,
  type SnapshotGate,
  type VaultSnapshotFile,
} from '../services/snapshots';
import { AppWriteRegistry, type WriteKind } from './appWriteRegistry';
import { VaultIndex } from './vaultIndex';

/** Why the enrichment pipeline should run for a note (pass 6 consumes this). */
export type PipelineCause = 'external' | 'app-write-content-change';

/** Called when a note is remapped to a new path (move/rename). The annotation and embedding
 *  stores register one of these in pass 6 so their `relPath + contentHash` keys follow the
 *  file (D4a/S9). Designed now; wired later. */
export type RekeyHook = (oldRelPath: string, newRelPath: string) => void | Promise<void>;
export type DeleteHook = (relPath: string) => void | Promise<void>;

/** Fires for EVERY note-level index mutation — upsert (create/save/external edit/rename
 *  target) with the fresh `ParsedNote`, or removal (delete, or the old side of a rename/move)
 *  with `null`. The one choke point consumers (search index, live "did anything change" UI
 *  signals) need instead of re-deriving from individual write methods — notably this is also
 *  the only notification an EXTERNAL delete produces (pass-05: closes a gap where nothing
 *  downstream of the repository ever heard about a Finder-deleted file). NOT fired during the
 *  initial bulk `reindexAll()` load — callers do their own full rebuild after `openVault()`. */
export type IndexChangeHook = (relPath: string, note: ParsedNote | null) => void;

export interface RepositoryDeps {
  now?: () => number;
  onPipeline?: (relPath: string, cause: PipelineCause) => void;
  onIndexChange?: IndexChangeHook;
}

/** delete+create within this window with equal contentHash ⇒ a move, not a delete (S9/D4a). */
const MOVE_WINDOW_MS = 2000;
const SNAPSHOT_ROOT = '.denote/snapshots';
const META_PATH = '.denote/meta.json';

const SNAPSHOT_CAP_BYTES = 50 * 1024 * 1024;

const stripMd = (s: string): string => s.replace(/\.md$/i, '');
const lastSeg = (rel: string): string => rel.split('/').pop() ?? rel;
const baseNoMd = (rel: string): string => stripMd(lastSeg(rel));
const dirname = (rel: string): string => {
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
};
const isMarkdown = (rel: string): boolean => /\.md$/i.test(rel);
const utf8Size = (s: string): number => new TextEncoder().encode(s).length;

function normalizeFolderPath(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (normalized.some((segment) => segment === '.' || segment === '..' || segment.startsWith('.'))) {
    throw new DenoteError('fs', `invalid folder path: ${relPath}`, { path: relPath });
  }
  return normalized.join('/');
}

/** Reconstruct a wikilink token with a new target, preserving `!`/heading/alias verbatim (S9). */
function renderWikiLink(link: WikiLink, newTarget: string): string {
  const bang = link.embed ? '!' : '';
  const heading = link.heading ? `#${link.heading}` : '';
  const alias = link.alias !== undefined ? `|${link.alias}` : '';
  return `${bang}[[${newTarget}${heading}${alias}]]`;
}

interface PendingDelete {
  relPath: string;
  at: number;
  inbound: ResolvedLink[];
}

export class Repository {
  private readonly now: () => number;
  private readonly onPipeline?: (relPath: string, cause: PipelineCause) => void;
  private readonly onIndexChange?: IndexChangeHook;
  private readonly appWrites: AppWriteRegistry;
  private readonly locks = new Map<string, Promise<unknown>>();
  private eventChain: Promise<unknown> = Promise.resolve();

  private readonly snapshotGates = new Map<string, SnapshotGate>();
  // Move reconciliation buffers (S9/D4a): keyed by contentHash.
  private readonly pendingDeletes = new Map<string, PendingDelete>();
  private readonly pendingCreates = new Map<string, { relPath: string; at: number }>();

  private readonly rekeyHooks: RekeyHook[] = [];
  private readonly deleteHooks: DeleteHook[] = [];
  readonly warnings: string[] = [];

  private constructor(
    private readonly backend: StorageBackend,
    readonly root: string,
    readonly vaultId: VaultId,
    readonly index: VaultIndex,
    deps: RepositoryDeps,
  ) {
    this.now = deps.now ?? Date.now;
    this.onPipeline = deps.onPipeline;
    this.onIndexChange = deps.onIndexChange;
    this.appWrites = new AppWriteRegistry(this.now);
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  static async openVault(
    backend: StorageBackend,
    root: string,
    deps: RepositoryDeps = {},
  ): Promise<Repository> {
    await backend.registerVaultRoot(root);
    const vaultId = await ensureMeta(backend, root, deps.now ?? Date.now);
    const repo = new Repository(backend, root, vaultId, new VaultIndex(vaultId), deps);
    await repo.reindexAll();
    return repo;
  }

  /** Create a new vault directory (if needed) and open it. */
  static async createVault(
    backend: StorageBackend,
    root: string,
    deps: RepositoryDeps = {},
  ): Promise<Repository> {
    await backend.registerVaultRoot(root);
    await backend.createDir(root, '.denote');
    return Repository.openVault(backend, root, deps);
  }

  private async reindexAll(): Promise<void> {
    this.index.notes.clear();
    this.index.hashes.clear();
    this.index.mtimes.clear();
    this.index.btimes.clear();
    this.index.assets.clear();
    this.index.folders.clear();
    const entries = await this.backend.listVaultFiles(this.root);
    for (const e of entries) {
      if (isIgnoredPath(e.relPath)) continue;
      if (e.isDir) {
        this.index.addFolder(e.relPath);
        continue;
      }
      if (e.isMarkdown) {
        try {
          const content = await this.backend.readNote(this.root, e.relPath);
          this.index.setNote(parseNote(e.relPath, content), contentHash(content), e.mtime, {
            rebuild: false,
            btime: e.btime,
          });
        } catch (err) {
          this.warnings.push(`index ${e.relPath}: ${errMsg(err)}`);
        }
      } else {
        this.index.setAsset(e.relPath, { mtime: e.mtime, btime: e.btime, size: e.size });
      }
    }
    this.index.rebuildDerived();
  }

  /** Rebuild every derived in-memory index from the source files. Used after deleting
   *  `.denote/cache/` live: note bytes remain the only source of truth (D2/D3). */
  async rebuildDerivedCaches(): Promise<void> {
    await this.reindexAll();
    for (const note of this.index.allNotes()) this.onIndexChange?.(note.relPath, note);
  }

  // ── hooks ──────────────────────────────────────────────────────────────────

  registerRekeyHook(hook: RekeyHook): void {
    this.rekeyHooks.push(hook);
  }
  registerDeleteHook(hook: DeleteHook): void {
    this.deleteHooks.push(hook);
  }

  // ── reads ────────────────────────────────────────────────────────────────

  getParsed(relPath: string): ParsedNote | undefined {
    return this.index.getNote(relPath);
  }
  /** The live contentHash (D3a) for a note, or undefined if it isn't indexed. */
  getHash(relPath: string): string | undefined {
    return this.index.getHash(relPath);
  }
  listNotePaths(): string[] {
    return [...this.index.notes.keys()];
  }
  getBacklinks(relPath: string) {
    return this.index.getBacklinks(relPath);
  }
  async readNote(relPath: string): Promise<string> {
    return this.backend.readNote(this.root, relPath);
  }

  // ── internal .denote/ store I/O (D23: every vault write routes through the repository) ────
  // The AI annotation/rejection stores and the enrichment queue live under `.denote/` — part of
  // the shared ignore set (S22), so these paths never produce watcher events or note-index
  // mutations and need no app-write tagging (unlike note writes). Guarded so a caller can never
  // reach a real note through this door. Writes are still atomic (tmp+rename, S7) in the backend.

  private assertInternal(relPath: string): void {
    if (!isIgnoredPath(relPath)) {
      throw new DenoteError('fs', `not an internal .denote path: ${relPath}`, { path: relPath });
    }
  }

  async readInternal(relPath: string): Promise<string | null> {
    this.assertInternal(relPath);
    if (!(await this.backend.exists(this.root, relPath))) return null;
    return this.backend.readNote(this.root, relPath);
  }

  async writeInternal(relPath: string, content: string): Promise<void> {
    this.assertInternal(relPath);
    const d = dirname(relPath);
    if (d) await this.backend.createDir(this.root, d);
    await this.backend.writeNote(this.root, relPath, content);
  }

  async deleteInternal(relPath: string): Promise<void> {
    this.assertInternal(relPath);
    if (await this.backend.exists(this.root, relPath)) {
      await this.backend.deletePath(this.root, relPath);
    }
  }

  // ── writes (all tagged S8, serialized per note S7) ──────────────────────────

  async createNote(relPath: string, body = ''): Promise<string> {
    return this.withLock(relPath, async () => {
      if (await this.backend.exists(this.root, relPath)) {
        throw new DenoteError('conflict', `note already exists: ${relPath}`, { path: relPath });
      }
      await this.ensureParent(relPath);
      await this.writeTagged(relPath, body);
      this.reindexNote(relPath, body);
      await this.snapshotNote(relPath, body);
      return relPath;
    });
  }

  async saveNote(relPath: string, body: string): Promise<void> {
    return this.withLock(relPath, async () => {
      await this.writeTagged(relPath, body);
      this.reindexNote(relPath, body);
      await this.snapshotNote(relPath, body);
    });
  }

  async deleteNote(relPath: string): Promise<void> {
    return this.withLock(relPath, async () => {
      this.appWrites.recordPathOp(relPath);
      await this.backend.deletePath(this.root, relPath);
      this.index.removeNote(relPath);
      this.onIndexChange?.(relPath, null);
      for (const h of this.deleteHooks) await h(relPath);
    });
  }

  /** Rename (basename changes → title identity changes): rewrite ALL inbound links (S9). */
  async renameNote(oldRel: string, newRel: string): Promise<void> {
    return this.relocate(oldRel, newRel, 'all');
  }

  /** In-app move (folder changes, basename stays): rewrite only path-form inbound links (S9). */
  async moveNote(oldRel: string, newRel: string): Promise<void> {
    return this.relocate(oldRel, newRel, 'path-only');
  }

  /** Create a user-visible folder without adding placeholder content to the vault. Returns the
   * normalized vault-relative path so UI callers use the path the backend actually created. */
  async createFolder(relDir: string): Promise<string> {
    const normalized = normalizeFolderPath(relDir);
    if (!normalized) throw new DenoteError('fs', 'folder name cannot be empty');
    await this.backend.createDir(this.root, normalized);
    this.index.addFolder(normalized);
    return normalized;
  }

  /** Force a snapshot of the current on-disk content (ignores the debounce gate). */
  async snapshotNote(relPath: string, content?: string): Promise<void> {
    const text = content ?? (await this.backend.readNote(this.root, relPath));
    await this.writeSnapshot(relPath, text, content === undefined);
  }

  async listSnapshotVersions(relPath: string): Promise<SnapshotFile[]> {
    return this.listSnapshotFiles(`${SNAPSHOT_ROOT}/${relPath}`);
  }

  async readSnapshot(relPath: string, snapshotName: string): Promise<string> {
    if (parseSnapshotName(snapshotName) === null) {
      throw new DenoteError('fs', `invalid snapshot name: ${snapshotName}`, { path: snapshotName });
    }
    return this.backend.readNote(this.root, `${SNAPSHOT_ROOT}/${relPath}/${snapshotName}`);
  }

  /** Restore old content into the live note. This is a content-changing app write: the watcher
   *  echo is tagged as `app-write-content-change` so the normal pipeline runs exactly once (S8). */
  async restoreNoteVersion(relPath: string, content: string): Promise<void> {
    return this.withLock(relPath, async () => {
      if (await this.backend.exists(this.root, relPath)) {
        await this.snapshotNote(relPath);
      }
      await this.writeTagged(relPath, content, 'app-write-content-change');
      this.reindexNote(relPath, content);
      await this.snapshotNote(relPath, content);
    });
  }

  // ── watcher event handling (S8 classify, S9/D4a reconcile) ──────────────────

  /** Feed one debounced watcher event. Events serialize on a single per-vault chain. */
  onWatcherEvent(evt: RawWatcherEvent): Promise<void> {
    const run = this.eventChain.then(() => this.handleEvent(evt));
    this.eventChain = run.catch(() => {});
    return run;
  }

  private async handleEvent(evt: RawWatcherEvent): Promise<void> {
    if (isIgnoredPath(evt.relPath)) return;
    this.sweepPending();
    if (evt.kind === 'delete') return this.handleDelete(evt.relPath);
    return this.handleUpsert(evt.relPath);
  }

  private async handleDelete(relPath: string): Promise<void> {
    const oldHash = this.index.getHash(relPath);
    const inbound = this.index.inboundResolved(relPath);
    if (this.index.getNote(relPath)) {
      this.index.removeNote(relPath);
      this.onIndexChange?.(relPath, null);
    } else if (this.index.assets.has(relPath)) {
      this.index.removeAsset(relPath);
      return;
    } else {
      return; // unknown path
    }
    if (oldHash === undefined) return;
    // Move (create-first ordering): a just-indexed create with the same content is our pair.
    const pc = this.pendingCreates.get(oldHash);
    if (pc && this.now() - pc.at <= MOVE_WINDOW_MS && pc.relPath !== relPath) {
      this.pendingCreates.delete(oldHash);
      await this.finalizeMove(relPath, pc.relPath, inbound);
      return;
    }
    // Otherwise stash for the normal delete-then-create ordering.
    this.pendingDeletes.set(oldHash, { relPath, at: this.now(), inbound });
  }

  private async handleUpsert(relPath: string): Promise<void> {
    let content: string;
    try {
      content = await this.backend.readNote(this.root, relPath);
    } catch {
      // Vanished between event and read → treat as a delete.
      return this.handleDelete(relPath);
    }

    if (!isMarkdown(relPath)) {
      const st = await this.backend.stat(this.root, relPath);
      if (st) this.index.setAsset(relPath, st);
      return;
    }

    const hash = contentHash(content);
    const cls = this.appWrites.classify(relPath, hash);

    // Move (delete-first ordering): a stashed delete with equal content is our pair.
    const pd = this.pendingDeletes.get(hash);
    if (pd && this.now() - pd.at <= MOVE_WINDOW_MS && pd.relPath !== relPath) {
      this.pendingDeletes.delete(hash);
      this.reindexNote(relPath, content);
      await this.finalizeMove(pd.relPath, relPath, pd.inbound);
      return;
    }

    if (cls === 'app-write') {
      // Our own echo; the index already reflects this write. No pipeline (R1).
      return;
    }

    const existed = this.index.getNote(relPath) !== undefined;
    this.reindexNote(relPath, content);
    if (!existed) this.pendingCreates.set(hash, { relPath, at: this.now() });
    this.firePipeline(relPath, cls === 'app-write-content-change' ? cls : 'external');
  }

  // ── internal: relocation / rewrites ─────────────────────────────────────────

  private async relocate(oldRel: string, newRel: string, mode: 'all' | 'path-only'): Promise<void> {
    return this.withLock(oldRel, async () => {
      if (!(await this.backend.exists(this.root, oldRel))) {
        throw new DenoteError('fs', `cannot relocate missing note: ${oldRel}`, { path: oldRel });
      }
      const inbound = this.index.inboundResolved(oldRel);
      const raw = await this.backend.readNote(this.root, oldRel);
      const content = normalize(raw);
      const hash = contentHash(content);
      const btime = this.index.getBtime(oldRel); // carry the true creation time across the rename

      await this.ensureParent(newRel);
      this.appWrites.recordPathOp(oldRel);
      this.appWrites.recordWrite(newRel, hash, 'app-write');
      await this.backend.renamePath(this.root, oldRel, newRel);

      const st = await this.backend.stat(this.root, newRel);
      this.index.removeNote(oldRel, { rebuild: false });
      const parsed = parseNote(newRel, content);
      this.index.setNote(parsed, hash, st?.mtime ?? this.now(), {
        rebuild: false,
        btime,
      });
      this.index.rebuildDerived();
      this.onIndexChange?.(oldRel, null);
      this.onIndexChange?.(newRel, parsed);

      await this.rekey(oldRel, newRel);
      await this.applyInboundRewrites(oldRel, newRel, inbound, mode);
    });
  }

  /** After an external move (D4a): re-key identity and rewrite path-form inbound links (S9). */
  private async finalizeMove(
    oldRel: string,
    newRel: string,
    inbound: ResolvedLink[],
  ): Promise<void> {
    await this.rekey(oldRel, newRel);
    await this.applyInboundRewrites(oldRel, newRel, inbound, 'path-only');
  }

  private async rekey(oldRel: string, newRel: string): Promise<void> {
    for (const h of this.rekeyHooks) await h(oldRel, newRel);
    const carry = this.snapshotGates.get(oldRel);
    if (carry) {
      this.snapshotGates.delete(oldRel);
      this.snapshotGates.set(newRel, carry);
    }
    await this.moveSnapshotDir(oldRel, newRel);
  }

  private async applyInboundRewrites(
    oldRel: string,
    newRel: string,
    inbound: ResolvedLink[],
    mode: 'all' | 'path-only',
  ): Promise<void> {
    const newNoMd = stripMd(newRel);
    const newBase = baseNoMd(newRel);
    const byFrom = new Map<string, { link: WikiLink; newTarget: string }[]>();
    for (const r of inbound) {
      if (r.resolution.kind !== 'note' || r.resolution.relPath !== oldRel) continue;
      const mt = r.resolution.matchType;
      if (mode === 'path-only' && mt !== 'path') continue;
      const newTarget = mt === 'path' ? newNoMd : newBase;
      const list = byFrom.get(r.fromPath) ?? [];
      list.push({ link: r.link, newTarget });
      byFrom.set(r.fromPath, list);
    }
    for (const [fromPath, edits] of byFrom) {
      if (fromPath === oldRel || fromPath === newRel) continue; // self-links: reindexed already
      await this.rewriteNoteLinks(fromPath, edits);
    }
  }

  private async rewriteNoteLinks(
    fromPath: string,
    edits: { link: WikiLink; newTarget: string }[],
  ): Promise<void> {
    return this.withLock(fromPath, async () => {
      const raw = await this.backend.readNote(this.root, fromPath);
      let text = normalize(raw);
      // Apply edits high-offset-first so earlier offsets stay valid.
      const sorted = [...edits].sort((a, b) => b.link.offsetStart - a.link.offsetStart);
      for (const e of sorted) {
        text = text.slice(0, e.link.offsetStart) + renderWikiLink(e.link, e.newTarget) + text.slice(e.link.offsetEnd);
      }
      await this.writeTagged(fromPath, text);
      this.reindexNote(fromPath, text);
      await this.snapshotNote(fromPath, text);
    });
  }

  // ── internal: primitives ────────────────────────────────────────────────────

  private async writeTagged(relPath: string, content: string, kind: WriteKind = 'app-write'): Promise<void> {
    this.appWrites.recordWrite(relPath, contentHash(content), kind);
    await this.backend.writeNote(this.root, relPath, content);
  }

  private reindexNote(relPath: string, content: string): void {
    const mtime = this.now();
    const parsed = parseNote(relPath, content);
    this.index.setNote(parsed, contentHash(content), mtime);
    this.onIndexChange?.(relPath, parsed);
  }

  private async ensureParent(relPath: string): Promise<void> {
    const d = dirname(relPath);
    if (d) await this.backend.createDir(this.root, d);
  }

  private firePipeline(relPath: string, cause: PipelineCause): void {
    this.onPipeline?.(relPath, cause);
  }

  private sweepPending(): void {
    const t = this.now();
    for (const [h, pd] of this.pendingDeletes) if (t - pd.at > MOVE_WINDOW_MS) this.pendingDeletes.delete(h);
    for (const [h, pc] of this.pendingCreates) if (t - pc.at > MOVE_WINDOW_MS) this.pendingCreates.delete(h);
    this.appWrites.sweep();
  }

  private withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.locks.set(
      key,
      run.catch(() => {}),
    );
    return run;
  }

  // ── internal: snapshots (D21) ────────────────────────────────────────────────

  private async writeSnapshot(relPath: string, content: string, gated: boolean): Promise<void> {
    const size = utf8Size(content);
    const now = this.now();
    const gate = this.snapshotGates.get(relPath) ?? {};
    if (gated && !shouldSnapshot(gate, size, now)) return;
    const dir = `${SNAPSHOT_ROOT}/${relPath}`;
    await this.backend.createDir(this.root, dir);
    await this.backend.writeNote(this.root, `${dir}/${snapshotFileName(now)}`, content);
    this.snapshotGates.set(relPath, { lastSnapshotAt: now, lastSize: size });
    await this.pruneNoteSnapshots(relPath, now);
    await this.enforceVaultCap();
  }

  private async pruneNoteSnapshots(relPath: string, now: number): Promise<void> {
    const dir = `${SNAPSHOT_ROOT}/${relPath}`;
    const files = await this.listSnapshotFiles(dir);
    for (const name of selectExpired(files, now)) {
      await this.backend.deletePath(this.root, `${dir}/${name}`);
    }
  }

  private async enforceVaultCap(): Promise<void> {
    const all = await this.listAllSnapshots();
    for (const f of selectOverCap(all, SNAPSHOT_CAP_BYTES)) {
      await this.backend.deletePath(this.root, `${SNAPSHOT_ROOT}/${f.relPath}/${f.name}`);
    }
  }

  private async listSnapshotFiles(dir: string): Promise<SnapshotFile[]> {
    const entries = await this.backend.listDir(this.root, dir).catch(() => []);
    const out: SnapshotFile[] = [];
    for (const e of entries) {
      if (e.isDir) continue;
      const name = lastSeg(e.relPath);
      const at = parseSnapshotName(name);
      if (at !== null) out.push({ name, at, size: e.size });
    }
    return out;
  }

  private async listAllSnapshots(): Promise<VaultSnapshotFile[]> {
    const out: VaultSnapshotFile[] = [];
    const walk = async (dirRel: string): Promise<void> => {
      const entries = await this.backend.listDir(this.root, dirRel).catch(() => []);
      for (const e of entries) {
        if (e.isDir) {
          await walk(e.relPath);
        } else {
          const name = lastSeg(e.relPath);
          const at = parseSnapshotName(name);
          if (at === null) continue;
          const owner = dirRel.slice(SNAPSHOT_ROOT.length + 1);
          out.push({ relPath: owner, name, at, size: e.size });
        }
      }
    };
    await walk(SNAPSHOT_ROOT);
    return out;
  }

  private async moveSnapshotDir(oldRel: string, newRel: string): Promise<void> {
    const from = `${SNAPSHOT_ROOT}/${oldRel}`;
    if (!(await this.backend.exists(this.root, from))) return;
    const to = `${SNAPSHOT_ROOT}/${newRel}`;
    const parent = dirname(to);
    if (parent) await this.backend.createDir(this.root, parent);
    await this.backend.renamePath(this.root, from, to);
  }
}

// ── module helpers ────────────────────────────────────────────────────────────

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Read `.denote/meta.json` for the vaultId, generating + writing it on first open (D2/S26). */
async function ensureMeta(
  backend: StorageBackend,
  root: string,
  now: () => number,
): Promise<VaultId> {
  if (await backend.exists(root, META_PATH)) {
    const raw = await backend.readNote(root, META_PATH).catch(() => null);
    try {
      const parsed = raw == null ? null : JSON.parse(raw);
      if (parsed && typeof parsed.vaultId === 'string') return parsed.vaultId;
    } catch {
      // Quarantine below; the Markdown files remain the source of truth.
    }
    if (raw != null) {
      await backend.writeNote(root, `${META_PATH}.corrupt-${Date.now()}`, raw);
      await backend.deletePath(root, META_PATH).catch(() => {});
    }
  }
  const vaultId = crypto.randomUUID();
  const meta = { schemaVersion: 1, vaultId, createdAt: new Date(now()).toISOString() };
  await backend.createDir(root, '.denote');
  await backend.writeNote(root, META_PATH, JSON.stringify(meta, null, 2) + '\n');
  return vaultId;
}
