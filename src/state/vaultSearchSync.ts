// src/state/vaultSearchSync.ts — wires ONE `NoteSearchIndex` (D15: one instance per vault) to a
// `Repository`'s `onIndexChange` hook, so search stays live on every create/save/rename/move/
// delete — including EXTERNAL edits and deletes via the watcher. Kept Tauri-free (unlike
// vaultStore.ts) so it's testable against a real `Repository` over a temp-dir vault, the same
// pattern tests/integration/vault.test.ts already uses.

import type { IndexChangeHook, Repository } from './repository';
import { docFromNote, NoteSearchIndex, type SearchDoc } from '../services/searchIndex';

function hasGhostLink(repo: Repository, relPath: string): boolean {
  return repo.index
    .getLinkIndex()
    .some((r) => r.fromPath === relPath && r.resolution.kind === 'ghost');
}

export function buildSearchDocsFor(repo: Repository): SearchDoc[] {
  return repo.index.allNotes().map((n) => docFromNote(n, hasGhostLink(repo, n.relPath)));
}

/** `onIndexChange` must be supplied to `Repository.openVault`/`createVault` at construction
 *  time, before the `Repository` object exists — so this returns the hook up front (closing
 *  over a not-yet-assigned `repo`) plus an `attach(repo)` finisher to call once the repo
 *  resolves. `attach` also does the initial full build: `reindexAll()`'s bulk load never fires
 *  `onIndexChange` (by design — see its doc comment in repository.ts), so the index would
 *  otherwise stay empty until the first edit. */
export function createSearchIndexBinding(index: NoteSearchIndex): {
  onIndexChange: IndexChangeHook;
  attach: (repo: Repository) => Promise<void>;
} {
  let repo: Repository | undefined;
  const onIndexChange: IndexChangeHook = (relPath, note) => {
    if (!repo) return; // defensive: onIndexChange never fires before attach() in practice
    if (note === null) index.remove(relPath);
    else index.upsert(docFromNote(note, hasGhostLink(repo, relPath)));
  };
  return {
    onIndexChange,
    async attach(r: Repository) {
      repo = r;
      await index.rebuild(buildSearchDocsFor(r)); // chunked/async (D15 pitfall: never blocks the UI)
    },
  };
}
