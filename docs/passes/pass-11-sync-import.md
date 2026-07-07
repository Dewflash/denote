# Pass 11 — Sync & import: git/GitHub, external import, dedupe

## Objective
The deliberately-last interfacing layer: version-controlled vault history with GitHub sync,
and importing external content without duplication.

## Deliverables
- **Git-backed vault history (D21 extension):** opt-in per vault. `git init` inside the vault
  (`.denote/` gitignored except `meta.json` and `ai/topics.json` — annotations/embeddings/
  cache are machine-local); auto-commit debounced batches (e.g. every 10 min of activity or
  on app close) with generated messages ("Edited 3 notes in Finance/"). UI: per-note history
  timeline (snapshots + commits merged view), diff view, restore-version (as new snapshot,
  non-destructive). Use a Rust git library (`git2`) — do not shell out.
- **GitHub sync:** connect existing remote or create repo via `gh`-style OAuth device flow
  (token in Keychain). Manual sync button + optional auto-sync on interval. Conflict policy
  v1: pull --rebase; on conflict, never merge markers into notes — keep local version, write
  remote version alongside as `Note (conflict YYYY-MM-DD).md`, surface a conflicts panel.
  Document this limitation prominently.
- **Import:** sources — folder of .md/.txt (recursive), Obsidian vault (preserve structure;
  map `.obsidian` nothing; wikilinks already compatible), single files via drag-drop onto
  vault rail. Pipeline: hash every incoming body (D3a normalization) → exact-hash duplicates
  skipped with report; near-duplicates (embedding cosine ≥ 0.95 vs existing) flagged into an
  import-review list (import/skip/import-anyway per item) — never silently dropped.
- Post-import: batch index + embed + (user-confirmed) enrichment run, with the pass-9 budget
  gate if cloud routing is selected.

## Pitfalls
- Git in a folder the watcher observes: `.git/` must be in watcher ignore rules from the
  start of the pass, and app-write tagging (D23) applies to checkout/restore operations —
  restoring an old version IS a file write; it must trigger the normal pipeline exactly once.
- Never auto-push without the user having enabled auto-sync; first push requires explicit
  confirm showing repo visibility (private/public) — a church-notes vault pushed public by
  default would be catastrophic. Default new repos: PRIVATE.
- localOnly (D18) is about AI backends, not git — but surface a warning when enabling GitHub
  sync on a localOnly vault (user signaled sensitivity).
- Obsidian import: don't attempt plugin/theme migration; notes and folder structure only.

## Definition of Done
Round-trip: enable history → edit → timeline shows commits → restore old version (pipeline
runs once) → connect private GitHub repo → push → clone elsewhere manually and verify plain
readable markdown → import an Obsidian test vault with planted exact + near duplicates →
exact skipped, near flagged for review. All prior tests green. Update PROGRESS: project v1
complete; open a "post-1.0 candidates" section (plugins, mobile, publishing, market-data
insights enrichment).
