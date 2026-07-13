// Pass 02 Definition of Done — integration tests against real temp-dir vaults:
//   open→index · external edit→index update · rename→inbound links rewritten ·
//   Finder-style move (delete+create)→identity preserved · app-write classified (no pipeline).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contentHash } from '../../src/domain';
import { Repository } from '../../src/state/repository';
import {
  cleanup,
  externalRename,
  externalWrite,
  makeClock,
  makeTempVault,
  nodeStorage,
} from '../helpers/nodeStorage';

let root: string;
const backend = nodeStorage();

beforeEach(async () => {
  root = await makeTempVault();
});
afterEach(async () => {
  await cleanup(root);
});

describe('open → index', () => {
  it('indexes notes, computes backlinks, records assets, and bootstraps meta.json', async () => {
    await externalWrite(root, 'a/Note A.md', '# Note A\nSee [[Note B]].\n#alpha');
    await externalWrite(root, 'b/Note B.md', '# Note B\nBack to [[Note A]].');
    await externalWrite(root, 'img.png', 'binary-ish');

    const repo = await Repository.openVault(backend, root);

    expect(repo.listNotePaths().sort()).toEqual(['a/Note A.md', 'b/Note B.md']);
    expect(repo.getParsed('a/Note A.md')?.tags).toEqual(['alpha']);
    // Backlinks are computed (D5): B is linked from A.
    expect(repo.getBacklinks('b/Note B.md').map((bl) => bl.fromPath)).toEqual(['a/Note A.md']);
    // Asset indexed by path only (S26).
    expect(repo.index.assets.has('img.png')).toBe(true);
    // meta.json created with a vaultId (S26/D2).
    const meta = JSON.parse(await backend.readNote(root, '.denote/meta.json'));
    expect(meta.schemaVersion).toBe(1);
    expect(typeof meta.vaultId).toBe('string');
    expect(repo.vaultId).toBe(meta.vaultId);
  });

  it('reuses an existing vaultId on re-open', async () => {
    const r1 = await Repository.openVault(backend, root);
    const id1 = r1.vaultId;
    const r2 = await Repository.openVault(backend, root);
    expect(r2.vaultId).toBe(id1);
  });

  it('is resilient: a malformed note never aborts indexing', async () => {
    await externalWrite(root, 'bad.md', '---\n: : broken yaml : :\n---\n# Bad');
    await externalWrite(root, 'good.md', '# Good');
    const repo = await Repository.openVault(backend, root);
    expect(repo.listNotePaths().sort()).toEqual(['bad.md', 'good.md']);
  });
});

describe('external edit → index update', () => {
  it('re-indexes and fires the pipeline as external', async () => {
    await externalWrite(root, 'note.md', '# Note\nno links yet');
    const onPipeline = vi.fn();
    const clock = makeClock();
    const repo = await Repository.openVault(backend, root, { now: clock.now, onPipeline });

    // External editor rewrites the file (bypasses the repository → no signature).
    await externalWrite(root, 'note.md', '# Note\nnow links [[Other]]');
    await repo.onWatcherEvent({ relPath: 'note.md', kind: 'modify' });

    expect(repo.getParsed('note.md')?.links.map((l) => l.targetTitle)).toEqual(['Other']);
    expect(onPipeline).toHaveBeenCalledWith('note.md', 'external');
  });
});

describe('folder creation', () => {
  it('creates an empty folder through the repository without entering the note pipeline', async () => {
    const onPipeline = vi.fn();
    const repo = await Repository.openVault(backend, root, { onPipeline });

    await expect(repo.createFolder('Projects\\Ideas//')).resolves.toBe('Projects/Ideas');
    expect(await backend.exists(root, 'Projects/Ideas')).toBe(true);
    expect(repo.index.allFolders()).toEqual(['Projects', 'Projects/Ideas']);
    expect(repo.listNotePaths()).toEqual([]);

    const reopened = await Repository.openVault(backend, root);
    expect(reopened.index.allFolders()).toEqual(['Projects', 'Projects/Ideas']);

    await expect(repo.createFolder('../outside')).rejects.toThrow();

    // A recursive watcher can report the directory itself; it must not become a note or trigger AI.
    await repo.onWatcherEvent({ relPath: 'Projects/Ideas', kind: 'create' });
    expect(onPipeline).not.toHaveBeenCalled();
  });
});

describe('app-write → classified (no re-pipeline)', () => {
  it('does not fire the pipeline for the app\'s own write echo (R1)', async () => {
    await externalWrite(root, 'note.md', '# Note');
    const onPipeline = vi.fn();
    const clock = makeClock();
    const repo = await Repository.openVault(backend, root, { now: clock.now, onPipeline });

    await repo.saveNote('note.md', '# Note\nedited by app');
    // The watcher now echoes our own write back.
    await repo.onWatcherEvent({ relPath: 'note.md', kind: 'modify' });

    expect(onPipeline).not.toHaveBeenCalled();
    // Index still reflects the app write.
    expect(await backend.readNote(root, 'note.md')).toBe('# Note\nedited by app');
  });
});

describe('rename → inbound links rewritten (S9)', () => {
  it('rewrites path-, filename-, and title-form links, preserving heading + alias', async () => {
    await externalWrite(
      root,
      'A.md',
      '# A\n[[B]] and [[sub/B]] and [[sub/B|the alias]] and [[B#Section]]',
    );
    await externalWrite(root, 'sub/B.md', '# B');
    const repo = await Repository.openVault(backend, root);

    await repo.renameNote('sub/B.md', 'sub/C.md');

    const a = await backend.readNote(root, 'A.md');
    expect(a).toContain('[[C]]');
    expect(a).toContain('[[sub/C]]');
    expect(a).toContain('[[sub/C|the alias]]');
    expect(a).toContain('[[C#Section]]');
    expect(a).not.toContain('[[B]]');
    expect(a).not.toContain('[[sub/B');

    // File moved on disk; index reflects the new path.
    expect(await backend.exists(root, 'sub/C.md')).toBe(true);
    expect(await backend.exists(root, 'sub/B.md')).toBe(false);
    expect(repo.getParsed('sub/C.md')).toBeDefined();
    expect(repo.getParsed('sub/B.md')).toBeUndefined();
  });
});

describe('Finder-style move (delete+create) → identity preserved (D4a/S9)', () => {
  it('re-keys via the move hook, rewrites path-form links, and fires no pipeline', async () => {
    await externalWrite(root, 'a/x.md', '# X\nbody');
    await externalWrite(root, 'ref.md', '# Ref\nlink [[a/x]] and by-name [[x]]');
    const onPipeline = vi.fn();
    const clock = makeClock();
    const repo = await Repository.openVault(backend, root, { now: clock.now, onPipeline });

    const rekeys: Array<[string, string]> = [];
    repo.registerRekeyHook((oldP, newP) => {
      rekeys.push([oldP, newP]);
    });

    // Simulate the Finder move: file relocated on disk, then delete+create events arrive.
    await externalRename(root, 'a/x.md', 'b/x.md');
    await repo.onWatcherEvent({ relPath: 'a/x.md', kind: 'delete' });
    clock.advance(500); // within the 2s move window
    await repo.onWatcherEvent({ relPath: 'b/x.md', kind: 'create' });

    // Identity preserved: indexed at the new path, old path gone.
    expect(repo.getParsed('b/x.md')).toBeDefined();
    expect(repo.getParsed('a/x.md')).toBeUndefined();
    // Re-key hook fired with old→new (annotation/embedding stores hook in here, pass 6).
    expect(rekeys).toEqual([['a/x.md', 'b/x.md']]);
    // Path-form inbound link rewritten; filename-form left intact (S9 move rule).
    const ref = await backend.readNote(root, 'ref.md');
    expect(ref).toContain('[[b/x]]');
    expect(ref).toContain('[[x]]');
    // A move is not a content change → no enrichment pipeline.
    expect(onPipeline).not.toHaveBeenCalled();
  });

  it('in-app moveNote re-keys and rewrites only path-form inbound links', async () => {
    await externalWrite(root, 'a/x.md', '# X');
    await externalWrite(root, 'ref.md', '# Ref\n[[a/x]] and [[x]]');
    const repo = await Repository.openVault(backend, root);
    const rekeys: Array<[string, string]> = [];
    repo.registerRekeyHook((o, n) => rekeys.push([o, n]));

    await repo.moveNote('a/x.md', 'b/x.md');

    expect(await backend.exists(root, 'b/x.md')).toBe(true);
    expect(await backend.exists(root, 'a/x.md')).toBe(false);
    expect(rekeys).toEqual([['a/x.md', 'b/x.md']]);
    const ref = await backend.readNote(root, 'ref.md');
    expect(ref).toContain('[[b/x]]');
    expect(ref).toContain('[[x]]'); // filename-form untouched on a move (S9)
  });

  it('treats a delete with no matching create as a real delete', async () => {
    await externalWrite(root, 'gone.md', '# Gone');
    const clock = makeClock();
    const repo = await Repository.openVault(backend, root, { now: clock.now });
    await externalRename(root, 'gone.md', 'elsewhere.md'); // pretend only delete is seen for gone
    await repo.onWatcherEvent({ relPath: 'gone.md', kind: 'delete' });
    clock.advance(3000); // past the 2s window
    expect(repo.getParsed('gone.md')).toBeUndefined();
  });
});

describe('repository writes are atomic + snapshotted (S7/D21)', () => {
  it('creates a snapshot on save', async () => {
    const repo = await Repository.openVault(backend, root);
    await repo.createNote('note.md', '# Note\nv1');
    const snaps = await backend.listDir(root, '.denote/snapshots/note.md');
    expect(snaps.length).toBeGreaterThanOrEqual(1);
  });

  it('tags writes so contentHash of the stored file matches what was written', async () => {
    const repo = await Repository.openVault(backend, root);
    await repo.createNote('note.md', '# Note');
    const onDisk = await backend.readNote(root, 'note.md');
    expect(contentHash(onDisk)).toBe(contentHash('# Note'));
  });

  it('restores old content as app-write-content-change so the watcher runs the pipeline once', async () => {
    const onPipeline = vi.fn();
    const repo = await Repository.openVault(backend, root, { onPipeline });
    await repo.createNote('note.md', '# Note\nv1');
    await repo.saveNote('note.md', '# Note\nv2');

    await repo.restoreNoteVersion('note.md', '# Note\nv1');
    await repo.onWatcherEvent({ relPath: 'note.md', kind: 'modify' });

    expect(await backend.readNote(root, 'note.md')).toBe('# Note\nv1');
    expect(onPipeline).toHaveBeenCalledTimes(1);
    expect(onPipeline).toHaveBeenCalledWith('note.md', 'app-write-content-change');
  });
});
