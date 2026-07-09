// pass-05 DoD: "Tests: search index update on edit/rename/delete." Exercises the real
// Repository (temp-dir vault, no Tauri) wired to a NoteSearchIndex via createSearchIndexBinding,
// including the watcher-driven external-edit/delete/move paths (S9/D4a) that vaultStore.ts can't
// be unit-tested for directly (it imports the Tauri runtime).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Repository } from '../../src/state/repository';
import { createSearchIndexBinding } from '../../src/state/vaultSearchSync';
import { NoteSearchIndex } from '../../src/services/searchIndex';
import {
  cleanup,
  externalRename,
  externalWrite,
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

async function openWithSearch(): Promise<{ repo: Repository; index: NoteSearchIndex }> {
  const index = new NoteSearchIndex();
  const binding = createSearchIndexBinding(index);
  const repo = await Repository.openVault(backend, root, { onIndexChange: binding.onIndexChange });
  await binding.attach(repo);
  return { repo, index };
}

describe('vaultSearchSync', () => {
  it('the initial build indexes every note already on disk', async () => {
    await externalWrite(root, 'a.md', '# A\nAbout interest rates.');
    await externalWrite(root, 'b.md', '# B\nAbout miso soup.');
    const { index } = await openWithSearch();
    expect(index.size).toBe(2);
    expect(index.search('interest').map((h) => h.relPath)).toEqual(['a.md']);
  });

  it('createNote adds the new note to the search index', async () => {
    const { repo, index } = await openWithSearch();
    await repo.createNote('new.md', '# New\nMentions dollarization.');
    expect(index.search('dollarization').map((h) => h.relPath)).toEqual(['new.md']);
  });

  it('saveNote (edit) updates the indexed content, not a duplicate', async () => {
    await externalWrite(root, 'a.md', '# A\nOriginal text about apples.');
    const { repo, index } = await openWithSearch();
    await repo.saveNote('a.md', '# A\nNow about oranges instead.');
    expect(index.search('apples').length).toBe(0);
    expect(index.search('oranges').map((h) => h.relPath)).toEqual(['a.md']);
    expect(index.size).toBe(1);
  });

  it('an EXTERNAL edit (watcher path) updates the index too', async () => {
    await externalWrite(root, 'a.md', '# A\nOriginal text about apples.');
    const { repo, index } = await openWithSearch();
    await externalWrite(root, 'a.md', '# A\nNow mentions bananas.');
    await repo.onWatcherEvent({ relPath: 'a.md', kind: 'modify' });
    expect(index.search('bananas').map((h) => h.relPath)).toEqual(['a.md']);
  });

  it('renameNote re-keys the index (old path gone, new path present)', async () => {
    await externalWrite(root, 'old.md', '# Old\nAbout kiwis.');
    const { repo, index } = await openWithSearch();
    await repo.renameNote('old.md', 'new.md');
    expect(index.has('old.md')).toBe(false);
    expect(index.search('kiwis').map((h) => h.relPath)).toEqual(['new.md']);
  });

  it('deleteNote removes the note from the index', async () => {
    await externalWrite(root, 'a.md', '# A\nAbout grapes.');
    const { repo, index } = await openWithSearch();
    await repo.deleteNote('a.md');
    expect(index.size).toBe(0);
    expect(index.search('grapes').length).toBe(0);
  });

  it('an EXTERNAL delete (watcher path) removes the note from the index too', async () => {
    await externalWrite(root, 'a.md', '# A\nAbout pears.');
    const { repo, index } = await openWithSearch();
    await backend.deletePath(root, 'a.md');
    await repo.onWatcherEvent({ relPath: 'a.md', kind: 'delete' });
    expect(index.has('a.md')).toBe(false);
  });

  it('an external Finder move (delete+create) re-keys the index, not remove+leave-orphaned', async () => {
    await externalWrite(root, 'old.md', '# Old\nAbout plums.');
    const { repo, index } = await openWithSearch();
    await externalRename(root, 'old.md', 'moved/old.md');
    await repo.onWatcherEvent({ relPath: 'old.md', kind: 'delete' });
    await repo.onWatcherEvent({ relPath: 'moved/old.md', kind: 'create' });
    expect(index.has('old.md')).toBe(false);
    expect(index.search('plums').map((h) => h.relPath)).toEqual(['moved/old.md']);
    expect(index.size).toBe(1);
  });

  it('has:ghosts flags a note with an unresolved wikilink, not one whose links all resolve', async () => {
    await externalWrite(root, 'a.md', '# A\nSee [[Nonexistent]].');
    await externalWrite(root, 'b.md', '# B\nSee [[A]].');
    const { index } = await openWithSearch();
    expect(index.search('', { hasGhosts: true }).map((h) => h.relPath)).toEqual(['a.md']);
  });

  it('has:ghosts clears once the target is created and the source note is re-touched', async () => {
    await externalWrite(root, 'a.md', '# A\nSee [[Nonexistent]].');
    const { repo, index } = await openWithSearch();
    await repo.createNote('Nonexistent.md', '# Nonexistent\n');
    // Creating the target alone doesn't retroactively refresh OTHER notes' cached hasGhost flag
    // (that would need a full link-index sweep on every upsert); the next edit to the source
    // note recomputes it — same "stale until reconfirmed" pattern as topic membership (S17).
    await repo.saveNote('a.md', '# A\nSee [[Nonexistent]].');
    expect(index.search('', { hasGhosts: true }).length).toBe(0);
  });
});
