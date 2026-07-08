# Progress Ledger

Update this file at the end of every pass: set status, date, record deviations from the brief
and anything the next agent must know. One pass in flight at a time; respect dependencies.

| Pass | Title | Depends on | Status | Completed | Notes |
|------|-------|-----------|--------|-----------|-------|
| 00 | Toolchain & scaffold | — | **next** | | Pre-flight done 2026-07-07: arm64, macOS 26.5.1, Xcode+Swift 6.3.2 ✓, Node 24 + pnpm 11 ✓, Rust 1.96.1 installed ✓, FoundationModels probe: importable, availability=available ✓ |
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

## Architect review checkpoints

Independent architect inspections of implemented code, distinct from pass DoDs. The owner
summons the architect at these points; implementation pauses on the next pass until the
review verdict lands here.

| Checkpoint | After pass | Focus | Status |
|-----------|-----------|-------|--------|
| A | 02 | Foundation: domain purity, S1 port vs reference script, parser fixtures quality, watcher echo/tagging (S8), fs containment (S22), move reconciliation (S9) | pending |
| B | 06 | AI plumbing: R1 loop test legitimacy, takeover state machine (S10), dirty-buffer deferral + op-log undo (S23), annotation/rejection stores, router localOnly enforcement | pending |
| C | 08 | Flagship quality: canonicalization behavior vs EXPECTED.md, topic sprawl check on a real vault, folder profiles/misfit, `_topics` byte-stability + freeze | pending |
| D | 09 | Money & privacy: budget gate is physically-uncrossable, batch durability (S27), spend reconciliation, localOnly in assembler AND router, Keychain handling | pending |
| E | 11 | Release audit: full-repo sweep, derived-data deletion drill, conflict handling, private-repo default, EXPECTED.md + ACCEPTANCE.md end-to-end | pending |

Unscheduled trigger: summon the architect immediately whenever anything sits in **Blocked**,
a deviation touches an S- or D-number, or a checkpoint's focus area was reworked afterward.

Review outcomes are logged under this table (date, verdict, corrective commands issued).

## Owner inputs required

Things only the owner (Kevin) can provide. When a pass reaches a step needing a missing
input, the agent STOPS that step, marks it here as `awaiting-owner`, tells the owner exactly
what is needed and why, and continues with the rest of the pass if independent.

| Input | Needed by | Status | Notes |
|-------|-----------|--------|-------|
| LICENSE choice for the repo | any time (repo is public with no license = all rights reserved) | awaiting-owner | agent adds the file once told |
| App icon / final branding | pass 10 (build polish) | awaiting-owner | default Tauri icon until then |
| Anthropic API key | pass 09 (entered by owner in Settings → AI, stored in Keychain — never give it to an agent in chat) | awaiting-owner | pass 09 dev/tests use mock until owner enters key and runs verification |
| Apple Intelligence enabled on the Mac | pass 07 (sidecar `capabilities()` will report it) | **verified 2026-07-07** | architect probe: `SystemLanguageModel.default.availability == available` |

## Deviations log

(append entries: date, pass, what deviated from the brief, why)

## Blocked

(empty)
