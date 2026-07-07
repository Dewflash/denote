# Pass 02 — Vault engine: fs, watcher, repository, indexes

## Objective
Open/create real vaults on disk; the repository becomes the only mutation path; indexes stay
live under external edits; rename/move handled per D4/D4a.

## Normative specs for this pass
SPECS **S7** (atomic writes, per-note mutex, ordering — D29), **S8** (app-write tagging
protocol, exact signature/window semantics), **S9** (rename/move/retitle rules — note the
three distinct cases and the move re-key list).

## Deliverables
- Rust commands (`src-tauri`): `read_note`, `write_note`, `list_vault_files` (respecting
  ignore rules: `.denote/`, dotfiles), `create/rename/delete/move`, and a `notify`-based
  watcher streaming debounced events to the frontend.
- `services/storage.ts` — thin typed bridge over the commands.
- Repository (`state/` + orchestration module): `openVault, createVault, createNote(relPath),
  saveNote(relPath, body), renameNote(old, new), moveNote, deleteNote, snapshotNote`.
  All writes tagged per **D23** (maintain a short-lived set of expected-write signatures;
  watcher events matching a signature are classified `app-write`).
- `.denote/` bootstrap: `meta.json` with `schemaVersion: 1`, generated `vaultId` (uuid).
- In-memory indexes built via pass-01 domain functions on vault open; incrementally updated
  on events. Backlinks recomputed from the link index (never stored).
- Rename refactor: rewriting inbound `[[links]]` across the vault, preserving aliases
  (`[[Old|alias]]` → `[[New|alias]]`), single undoable batch, through the repository.
- Move reconciliation (**D4a**): watcher delete+create with equal contentHash within a window
  (2s) = move → remap indexes and (future) annotations/embeddings via a re-keying hook the
  annotation store will register in pass 6. Design the hook now.
- Snapshots (**D21**): copy-on-write into `.denote/snapshots/<relPath>/<timestamp>.md`,
  debounced (≥5 min between snapshots per note or ≥30% size delta), pruning policy
  (keep all <24h, dailies <30d, then weeklies; cap 50MB/vault).

## Pitfalls
- The watcher WILL deliver events for the app's own writes — D23 classification is not
  optional; without it pass 7 creates feedback loops (R1).
- fs events on macOS arrive coalesced and out of order; debounce per-path (300ms) and always
  re-stat + re-hash before acting.
- Vault open must be resilient: a malformed note never aborts indexing (collect warnings).
- Multi-vault comes in pass 5, but key EVERYTHING by vaultId now (D17).

## Definition of Done
Integration tests against temp-dir vaults: open→index; external edit→index update;
rename→inbound links rewritten; Finder-style move (delete+create)→identity preserved;
app-write correctly classified (no re-pipeline). All prior tests green.
