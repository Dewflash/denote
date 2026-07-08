# Progress Ledger

Update this file at the end of every pass: set status, date, record deviations from the brief
and anything the next agent must know. One pass in flight at a time; respect dependencies.

| Pass | Title | Depends on | Status | Completed | Notes |
|------|-------|-----------|--------|-----------|-------|
| 00 | Toolchain & scaffold | — | **done** | 2026-07-08 | Tauri 2 + React 19 + TS scaffold at repo root (identifier `com.dewflash.denote`, product name `DeNote`). Source tree per MASTERPLAN §3 (empty `index.ts` files w/ header comments). Tailwind v4 + `src/app/tokens.css` (light/dark via `prefers-color-scheme`, `data-theme` override). Vitest + ESLint flat config w/ domain-purity boundary rule (`no-restricted-imports` on `src/domain/**`) — probed with a `react` import, confirmed it fails lint, then removed. `pnpm tauri dev` builds and opens the 3-pane placeholder shell; `pnpm test`/`pnpm lint` pass. Only `opener` Tauri plugin enabled (fs/dialog/global-shortcut deferred). No Swift sidecar or AI deps added (`sidecar/apple-ai/` has a README stub only). |
| 01 | Domain core: parser, types, graph builder | 00 | **done** | 2026-07-08 | Pure `src/domain/`: `types.ts` (MASTERPLAN §5 + `WikiLink.heading` S2 + `ParsedNote.warnings` per brief), `sha256.ts` (pure FIPS-180-4, see deviation), `hashing.ts` (S1 verbatim port of the reference; all 12 vectors + R1 property test green), `parser.ts` (unified/remark blocks + masked inline scanner, S2/S3/S5), `links.ts` (S4 + ghost identity + link-index builder), `backlinks.ts` (D5, computed only), `graphBuilder.ts` (D6/D6a/D7/D17 hub model, deterministic sorted output), `takeover.ts` (D9/S10 pure decision fn). 119 tests pass (48-case parser corpus + S3 vectors, hashing vectors+property, links, backlinks, takeover, graphBuilder snapshots, vision-corpus deterministic layer, sha256 vs node:crypto). `pnpm test`/`pnpm lint`/`tsc`/`pnpm build` all clean. Reference script still ALL GREEN. Next: pass 02 → **architect checkpoint A** follows. |
| 02 | Vault engine: fs, watcher, repository, indexes | 01 | **done** | 2026-07-08 | Rust core: `containment.rs` (S22 canonicalize-then-verify + shared ignore set; 6 unit tests incl. symlink-escape & `../` green via `cargo test --lib`), `fs_commands.rs` (`read_note`/`write_note` atomic tmp+fsync+rename S7, `list_vault_files` ignore-filtered, `list_dir`, `create_dir`/`delete_path`/`rename_path`/`stat_path`/`path_exists`, `register_vault_root` w/ managed `VaultRoots`), `watcher.rs` (`notify`-based recursive watcher → `denote://fs-event`, ignore-filtered in Rust, rename-mode mapping). TS: `services/storage.ts` (StorageBackend interface + `isIgnoredPath`), `tauriStorage.ts`, `watcherBridge.ts` (300ms per-path debounce), `snapshots.ts` (D21 pure policy), `errors.ts` (S20 `DenoteError`), `state/appWriteRegistry.ts` (S8 content-hash signatures + path-ops, consume-once, 5s window), `state/vaultIndex.ts` (live index, backlinks recomputed never stored), `state/repository.ts` (openVault/createVault/createNote/saveNote/renameNote/moveNote/deleteNote/snapshotNote; all writes tagged D23; per-note mutex + per-vault event chain S7/D29; rename refactor S9 preserving heading+alias; move reconciliation D4a via `registerRekeyHook`; meta.json bootstrap). 146 tests pass (27 new: integration temp-dir vaults for all DoD cases + appWriteRegistry + snapshots). `pnpm test`/`lint`/`build`, `cargo test --lib`, and hash reference script all green. Next: **architect checkpoint A** before pass 03. |
| 03 | App shell UI: layout, tree, editor, backlinks | 02 | **next** | | Checkpoint A passed — cleared to implement. NOTE for this pass: the FIRST manual DoD step (create vault) is also the first-ever exercise of the real tauriStorage→Rust path (tests use the node backend), so verify `.denote/meta.json` bootstrap and note listing work in the running app before anything else. |
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

Model assignment (architect recommendation): Opus 4.8 at effort `high` for passes 01, 02,
06, 07, 08, 09 (escalate to `xhigh` if 02/06/07/08 struggle); Sonnet 5 at `high` for passes
00, 03, 04, 05, 10, 11. One pass per fresh session. Two consecutive DoD failures on a pass =
stop and summon the architect, do not keep retrying.

## Architect review checkpoints

Independent architect inspections of implemented code, distinct from pass DoDs. The owner
summons the architect at these points; implementation pauses on the next pass until the
review verdict lands here.

| Checkpoint | After pass | Focus | Status |
|-----------|-----------|-------|--------|
| A | 02 | Foundation: domain purity, S1 port vs reference script, parser fixtures quality, watcher echo/tagging (S8), fs containment (S22), move reconciliation (S9) | **done 2026-07-08 — PASS w/ 2 architect fixes** |
| B | 06 | AI plumbing: R1 loop test legitimacy, takeover state machine (S10), dirty-buffer deferral + op-log undo (S23), annotation/rejection stores, router localOnly enforcement | pending |
| C | 08 | Flagship quality: canonicalization behavior vs EXPECTED.md, topic sprawl check on a real vault, folder profiles/misfit, `_topics` byte-stability + freeze | pending |
| D | 09 | Money & privacy: budget gate is physically-uncrossable, batch durability (S27), spend reconciliation, localOnly in assembler AND router, Keychain handling | pending |
| E | 11 | Release audit: full-repo sweep, derived-data deletion drill, conflict handling, private-repo default, EXPECTED.md + ACCEPTANCE.md end-to-end | pending |

Unscheduled trigger: summon the architect immediately whenever anything sits in **Blocked**,
a deviation touches an S- or D-number, or a checkpoint's focus area was reworked afterward.

Review outcomes are logged under this table (date, verdict, corrective commands issued).

- 2026-07-08 · unscheduled quick inspection of pass 00 · **verdict: PASS, no corrections.**
  Architect independently re-verified: approved-stack-only deps (no AI/fs/dialog/shortcut
  plugins; opener only), identifier/product name correct, MASTERPLAN §3 tree present,
  tokens.css with light/dark + data-theme override, .gitignore complete, sidecar stub only.
  Domain-purity rule probed live with react AND @tauri-apps imports — both correctly fail
  lint with a clear message; baseline lint/test green (1/1). Ledger claims matched reality
  exactly. Cleared to proceed to pass 01.

- 2026-07-08 · unscheduled inspection of pass 01 · **verdict: PASS, no corrections; both
  deviations APPROVED.** Architect ran an independent differential probe (temporary test,
  removed after): domain `contentHash` vs the reference algorithm on 54 adversarial inputs
  the implementation had never seen (BOM+ai combos, `...` closers, tab indentation, `--- `
  near-miss closer, uppercase `AI:`, unterminated fm, CRLF, NFD, 40 seeded key-order
  permutations) — byte-identical on all. Parser hostile battery green: inline-code and
  unclosed-fence masking, indented-code exclusion, `![[x#h|a|b]]` → heading `h` + alias
  `a|b`, unicode tags, `#123` rejected, no throws on malformed input. (One probe assertion
  initially failed due to the ARCHITECT's own swapped arguments — implementation was
  correct.) links.ts implements S4 order + fold + shortest-then-lex tie exactly;
  graphBuilder is sorted-deterministic with hub model — vision-corpus test asserts the
  "0 note→note edges" anti-goal explicitly. Deviation 1 (pure in-domain SHA-256) approved:
  reasoning is sound (webview + synchronous R1 requirement), cross-checked vs node:crypto;
  Deviation 2 (remark satellite deps) approved under D20. MASTERPLAN §5 synced with
  `ParsedNote.warnings`. Suite 119/119, lint clean, reference script ALL GREEN. Cleared for
  pass 02; checkpoint A (post-02) will re-sweep this foundation plus the vault engine.

- 2026-07-08 · **CHECKPOINT A (post-pass-02)** · **verdict: PASS with 2 architect fixes
  applied; all 4 deviations APPROVED (one codified into SPECS).**
  Verified by direct read + independent runs: containment.rs is a correct
  canonicalize-then-verify boundary (rejects `../`, absolute, unregistered roots, symlink
  escapes via deepest-existing-ancestor; correctly ALLOWS `.denote/` through commands while
  ignoring it in listings/watcher); every fs command routes through `contained_path`; no
  generic file access exists. S8 registry: hash-matched consume-once signatures, 5s window,
  path-ops for deletes — the misclassification-negative test (external edit inside the
  window) is present. S9/D4a: move reconciliation keyed by contentHash, 2s window, rekey
  hooks, both event orderings tested. Integration suite covers every DoD case incl.
  path/filename/title-form rename rewriting preserving heading+alias. Snapshot policy
  matches D21 exactly. Suites: 146 TS + 6 Rust green, lint/build green, reference ALL GREEN.
  **Architect fixes:** (1) Rust `write_note` used `with_extension` (extension REPLACEMENT),
  so `a.md`/`a.txt` would share one tmp file — fixed to append per S7; notably the TS test
  backend already appended correctly, i.e. the bug lived only on the untestable-by-vitest
  production side (the exact prod/test divergence the deviation log flagged — pass 03's
  first manual step must exercise the real Rust path). (2) `*.denote-tmp` added to the
  shared ignore set (Rust + TS + test) so atomic-write tmp files never emit watcher events —
  gap existed in SPECS too; S7 amended. **Deviation rulings:** notify=6 pin OK;
  StorageBackend injection OK (good pattern); enrichment-enqueue deferral to pass 6 OK —
  pass-6 agent MUST wire in-app saves → S12 queue (it owns the queue); NFC deviation
  APPROVED AND ADOPTED — implementation's fs-reported-bytes + fold-comparisons approach is
  safer than the original blanket-NFC S6 wording; S6 amended to codify it. Cleared for
  pass 03.

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

- 2026-07-08 · pass 01 · **Hashing uses a pure in-domain SHA-256 (`src/domain/sha256.ts`),
  not `node:crypto`.** The reference script (`hash_spec_test.mjs`) uses `node:crypto` because
  it is a Node script, but domain code runs in the Tauri webview too (data flow: write →
  hash → parse), where `node:crypto` is unavailable, and D3a hashing must stay synchronous
  (R1) so Web Crypto's async API is unsuitable. The pure implementation is dependency-free,
  browser+node safe, and cross-checked byte-for-byte against `node:crypto` in
  `tests/domain/sha256.test.ts` (known answers + varied inputs across block boundaries). The
  hashed bytes (`stripAiBlock` output) are unchanged, so all S1 vectors match the reference.
- 2026-07-08 · pass 01 · **Parser satellite deps added under D20** (which selects
  unified/remark): `unified`, `remark-parse`, `remark-frontmatter`, `yaml` (the last two named
  in the pass brief), plus ecosystem helpers `unist-util-visit` and `mdast-util-to-string`.
  No new architectural decision — these implement D20/D28. No math plugin wired, so S5 math
  masking is inactive this pass (masks fenced/indented code, inline code, HTML, and the
  frontmatter region).
- 2026-07-08 · pass 01 · **`ParsedNote.warnings: string[]` added** (best-effort, never-throw
  parser per the brief) and **`WikiLink.heading?`** per S2 — both supersede the MASTERPLAN §5
  shapes as the brief/SPECS direct. Domain unit tests live under `tests/domain/` (brief:
  "tests in `tests/`"); `vite.config.ts` `test.include` extended to cover `tests/**/*.test.ts`.
  Parser fixture corpus is data-driven at `tests/fixtures/parser/cases.ts`.

- 2026-07-08 · pass 02 · **`notify = "6"` added to `src-tauri/Cargo.toml`.** Not a new
  decision — the fs watcher is pre-specified by MASTERPLAN §3 ("notify watcher") and the
  pass-02 brief. Pinned to v6 (v8 available) for a stable API surface; revisit if needed.
- 2026-07-08 · pass 02 · **Storage is injected behind a `StorageBackend` interface**
  (`services/storage.ts`); production uses `tauriStorage` (Rust commands), tests use a
  node:fs backend (`tests/helpers/nodeStorage.ts`). This is what lets the DoD run as real
  temp-dir integration tests in Vitest without a Tauri runtime. The Rust watcher itself is not
  Vitest-testable; watcher LOGIC (S8 classify, S9/D4a reconcile) is tested by feeding
  `Repository.onWatcherEvent` synthetic events, which is where the risk lives.
- 2026-07-08 · pass 02 · **Enrichment pipeline is not enqueued on app-originated saves yet.**
  Per S8, the watcher fires the pipeline for `external` (and future `app-write-content-change`)
  events; the app's own write echoes are suppressed (R1). `Repository` exposes an `onPipeline`
  hook for the watcher path. Wiring a user's in-app save → enrichment queue (S12) and the
  per-write-kind trigger mapping (D23) belongs to pass 6, which owns the queue. No behavior a
  pass-02 owner check exercises depends on it.
- 2026-07-08 · pass 02 · **Move detection is clean for delete→create (the order S9 states);**
  a rarer create→delete ordering re-keys identity correctly but fires one spurious pipeline
  run on the create — harmless because enrichment is hash-gated + idempotent (D26/R1). macOS
  filename NFC normalization is not applied to relPaths coming from the Rust listing/watcher
  (would need a new unicode-normalization crate); link *targets* are NFC-normalized in the
  domain layer as before. Snapshots store the newly-saved version as a point-in-time
  checkpoint (filename = epoch millis), a valid reading of D21's copy-on-write history.

## Blocked

(empty)
