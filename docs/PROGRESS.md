# Progress Ledger

Update this file at the end of every pass: set status, date, record deviations from the brief
and anything the next agent must know. One pass in flight at a time; respect dependencies.

| Pass | Title | Depends on | Status | Completed | Notes |
|------|-------|-----------|--------|-----------|-------|
| 00 | Toolchain & scaffold | — | **next** | | |
| 01 | Domain core: parser, types, graph builder | 00 | pending | | |
| 02 | Vault engine: fs, watcher, repository, indexes | 01 | pending | | |
| 03 | App shell UI: layout, tree, editor, backlinks | 02 | pending | | |
| 04 | Graph view | 02, 03 | pending | | |
| 05 | Search & multi-vault | 02, 03 | pending | | |
| 06 | AI framework: AiClient, mock, annotations, takeover | 02 | pending | | |
| 07 | Local intelligence: embeddings, Apple sidecar, enrichment | 06 | pending | | |
| 08 | Ontology & semantic clustering, insights v1 | 07 | pending | | |
| 09 | Cloud tier: Anthropic, deep-organize, budget cap | 07, 08 | pending | | |
| 10 | Capture, appearance polish, e2e smoke | 03, 06 | pending | | |
| 11 | Sync & import: git/GitHub, dedupe | 02 | pending | | |

Statuses: `pending` → `next` → `in-progress` → `done` (or `blocked` with a Blocked section
below explaining exactly what and why).

## Deviations log

(append entries: date, pass, what deviated from the brief, why)

## Blocked

(empty)
