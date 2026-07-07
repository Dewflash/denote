# Pass 05 — Search & multi-vault

## Objective
Full-text search with filters; true multi-vault: registry, fast switching, combined graphs.

## Deliverables
- `services/searchIndex.ts`: MiniSearch (D15) over title, headings, body, tags; rebuilt on
  vault open, incrementally updated on index events. Fields boosted: title > headings > tags
  > body.
- Search UI: cmd-shift-F panel — results with highlighted snippets; filters: `tag:x`,
  `folder:x`, `vault:x`, `has:ghosts`; click navigates.
- Quick switcher (cmd-O): fuzzy note-title jump across all OPEN vaults.
- Multi-vault registry in app support (`vaults.json`: id, name, path, color, localOnly flag —
  D17/D18). UI: vault rail lists all registered vaults; add-vault flow (folder picker →
  bootstrap or adopt existing `.denote/`); per-vault accent color used on rail + hulls +
  headers.
- Repository holds N open vaults concurrently; all stores keyed by vaultId (verify pass-02
  discipline actually held; fix drift now).
- Graph vault selector: checkbox set of open vaults → combined graph (D17). Wikilink
  resolution stays vault-scoped; cross-vault edges only from (future) AI layers.
- Settings → Vaults page: manage registry, set localOnly per vault (enforcement lands pass 6
  router; persist the flag now).

## Pitfalls
- Rebuild-on-load must not block UI: index in a worker or chunked async; show progress in the
  status bar.
- Search index memory: one MiniSearch instance per vault (drop on close), not one global.
- Vault adoption must never touch existing user files beyond creating `.denote/`.
- Moving a registered vault on disk: registry stores path; on open-failure prompt to
  re-locate (match by vaultId in `.denote/meta.json`).

## Definition of Done
Two-vault manual script: register second vault → switch via rail (<100ms perceived) →
combined graph shows both hull sets (when structural toggle on) with vault colors → search
filters work → quick switcher jumps across vaults. Tests: search index update on
edit/rename/delete; registry CRUD.
