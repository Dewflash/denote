# Progress Ledger

Update this file at the end of every pass: set status, date, record deviations from the brief
and anything the next agent must know. One pass in flight at a time; respect dependencies.

| Pass | Title | Depends on | Status | Completed | Notes |
|------|-------|-----------|--------|-----------|-------|
| 00 | Toolchain & scaffold | — | **done** | 2026-07-08 | Tauri 2 + React 19 + TS scaffold at repo root (identifier `com.dewflash.denote`, product name `DeNote`). Source tree per MASTERPLAN §3 (empty `index.ts` files w/ header comments). Tailwind v4 + `src/app/tokens.css` (light/dark via `prefers-color-scheme`, `data-theme` override). Vitest + ESLint flat config w/ domain-purity boundary rule (`no-restricted-imports` on `src/domain/**`) — probed with a `react` import, confirmed it fails lint, then removed. `pnpm tauri dev` builds and opens the 3-pane placeholder shell; `pnpm test`/`pnpm lint` pass. Only `opener` Tauri plugin enabled (fs/dialog/global-shortcut deferred). No Swift sidecar or AI deps added (`sidecar/apple-ai/` has a README stub only). |
| 01 | Domain core: parser, types, graph builder | 00 | **done** | 2026-07-08 | Pure `src/domain/`: `types.ts` (MASTERPLAN §5 + `WikiLink.heading` S2 + `ParsedNote.warnings` per brief), `sha256.ts` (pure FIPS-180-4, see deviation), `hashing.ts` (S1 verbatim port of the reference; all 12 vectors + R1 property test green), `parser.ts` (unified/remark blocks + masked inline scanner, S2/S3/S5), `links.ts` (S4 + ghost identity + link-index builder), `backlinks.ts` (D5, computed only), `graphBuilder.ts` (D6/D6a/D7/D17 hub model, deterministic sorted output), `takeover.ts` (D9/S10 pure decision fn). 119 tests pass (48-case parser corpus + S3 vectors, hashing vectors+property, links, backlinks, takeover, graphBuilder snapshots, vision-corpus deterministic layer, sha256 vs node:crypto). `pnpm test`/`pnpm lint`/`tsc`/`pnpm build` all clean. Reference script still ALL GREEN. Next: pass 02 → **architect checkpoint A** follows. |
| 02 | Vault engine: fs, watcher, repository, indexes | 01 | **done** | 2026-07-08 | Rust core: `containment.rs` (S22 canonicalize-then-verify + shared ignore set; 6 unit tests incl. symlink-escape & `../` green via `cargo test --lib`), `fs_commands.rs` (`read_note`/`write_note` atomic tmp+fsync+rename S7, `list_vault_files` ignore-filtered, `list_dir`, `create_dir`/`delete_path`/`rename_path`/`stat_path`/`path_exists`, `register_vault_root` w/ managed `VaultRoots`), `watcher.rs` (`notify`-based recursive watcher → `denote://fs-event`, ignore-filtered in Rust, rename-mode mapping). TS: `services/storage.ts` (StorageBackend interface + `isIgnoredPath`), `tauriStorage.ts`, `watcherBridge.ts` (300ms per-path debounce), `snapshots.ts` (D21 pure policy), `errors.ts` (S20 `DenoteError`), `state/appWriteRegistry.ts` (S8 content-hash signatures + path-ops, consume-once, 5s window), `state/vaultIndex.ts` (live index, backlinks recomputed never stored), `state/repository.ts` (openVault/createVault/createNote/saveNote/renameNote/moveNote/deleteNote/snapshotNote; all writes tagged D23; per-note mutex + per-vault event chain S7/D29; rename refactor S9 preserving heading+alias; move reconciliation D4a via `registerRekeyHook`; meta.json bootstrap). 146 tests pass (27 new: integration temp-dir vaults for all DoD cases + appWriteRegistry + snapshots). `pnpm test`/`lint`/`build`, `cargo test --lib`, and hash reference script all green. Next: **architect checkpoint A** before pass 03. |
| 03 | App shell UI: layout, tree, editor, backlinks | 02 | **done** | 2026-07-09 | Full shell built: `app/keymap.ts` (S21 registry, duplicate-combo = throw, global listener), `state/opLog.ts` (D38 minimal undo/redo stack, wired to rename), `state/vaultStore.ts` (Repository lifecycle, watcher wiring, single open buffer w/ 800ms autosave, S23 rule 3 conflict bar, `createGhostAndOpen`), `state/uiStore.ts` (theme/accent/view-mode/panels, persisted). Editor: CodeMirror 6 (`features/editor/`) — `livePreview.ts` (two viewport-scoped `ViewPlugin`s: heading line-decorations + inline mark/replace decorations for bold/italic/wikilinks/tags/image-embeds; masks code regions via `syntaxTree`), `autocomplete.ts` (`[[` titles, `#` tags), `ReadingView.tsx` (remark→React renderer, same wikilink/tag/embed treatment), `AssetImage.tsx` + `services/assets.ts` (blob-URL image embeds via new Rust `read_asset` command, S22-contained). Explorer: `FileTree.tsx` (inline double-click rename → `renameNote`), `RecentNotes.tsx`, `TodayView.tsx` (S26 created/edited precedence). `BacklinksPanel`/`OutgoingLinksPanel` + Radix `Tabs` right panel. `CommandPalette`/`SettingsModal` (Radix `Dialog`) — Appearance section fully functional (theme + accent live via CSS vars), other sections are labeled stubs. `VaultRail`, `StatusBar`, paste-capture v1 (`features/capture/pasteCapture.ts`). New deps: `zustand`, `@radix-ui/react-{dialog,tabs}`, CodeMirror 6 packages, `@tauri-apps/plugin-dialog` (D39, recorded in DECISIONS.md). 175 tests pass (29 new: keymap registry, opLog, noteDates, tree, vaultIndex btime). `pnpm test`/`lint`/`tsc`/`build` and `cargo build`/`test --lib` and the hash reference script all green. **Verification method and its limit (read before trusting this row):** I confirmed via `pnpm tauri dev` that the real Rust↔TS bridge boots cleanly (Cargo compiles incl. the new `read_asset`/`dialog` wiring, Vite serves, the window process starts, no crash); I additionally drove the plain Vite build in a CDP-connected browser (no Tauri context) and confirmed the Welcome screen renders correctly with live dark-mode + accent tokens and zero console errors, and that a Tauri-dependent action attempted outside Tauri fails silently rather than crashing the page. I could **not** personally click through the full interactive script below — my tools drive a Chromium tab over CDP, and Tauri's macOS webview is WKWebView, which CDP cannot reach. Every DoD step was traced against the actual code path (setActiveNote force-flushes the previous dirty buffer before switching, so backlinks are consistent regardless of navigation order; ghost cmd-click creates `{target}.md` in the open note's folder; ready view/theme wiring confirmed live in the browser check) but this is static reasoning + automated tests, not a substitute for using it. **Owner: please run the manual script and the ACCEPTANCE.md "after pass 03" checklist before greenlighting pass 04** — `pnpm tauri dev`, then: create a vault → create ~10 interlinked notes with `[[links]]` and `#tags` → confirm backlinks panel is correct → double-click a tree note to rename it, confirm inbound links rewrote → cmd-click an unresolved `[[Ghost]]` link, confirm it creates the note → cmd-T, confirm today's notes list → Settings → Appearance, confirm dark/light/accent apply live. If anything in that script fails, it's a real bug to report, not a limitation of this note. |
| 04 | Graph view | 02, 03 | **next** | | |
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

- 2026-07-09 · pass 03 · **`@tauri-apps/plugin-dialog` added** for the native vault folder
  picker (D39, recorded in DECISIONS.md) — a browser/webview has no folder-picker API, and this
  is a first-party Tauri plugin at the same trust tier as the already-approved `opener` plugin.
- 2026-07-09 · pass 03 · **Rust gained a `read_asset` command** (`fs_commands.rs`) returning raw
  bytes for a vault-relative asset path, S22-contained identically to every other command. Used
  only by the image-embed renderer (`![[img.png]]`, S26); assets still never enter the parse/AI
  pipeline. Bytes cross IPC as a JSON number array (no base64/binary-response plumbing) — fine
  for typical embedded images, would need revisiting for very large assets.
- 2026-07-09 · pass 03 · **`btime` (file birthtime) added to the fs layer** (Rust
  `DirEntryDto`/`FileStatDto`, TS `FileStat`/`DirEntry`, `VaultIndex.btimes`) to implement S26's
  note-dates precedence (`created` = frontmatter `created`/`date` if parseable, else birthtime)
  for the Today view. `VaultIndex.setNote` seeds `btime` only on a relPath's FIRST appearance
  and never overwrites it on later edits/saves; `Repository.relocate` (rename/move) carries the
  original `btime` across explicitly. One known gap: when the watcher indexes a brand-new
  EXTERNAL file (e.g. Finder-created), its `btime` is the moment the app noticed it, not the
  file's real on-disk birthtime (would need an extra `stat()` in the hot watcher path) —
  `reindexAll` at vault-open still gets the true birthtime from disk in all cases.
- 2026-07-09 · pass 03 · **Live-preview typography is a deliberate two-tier implementation.**
  Wikilinks/tags/image-embeds get full Obsidian-style treatment (CM `ViewPlugin` widgets,
  cursor-aware collapse so the raw text is editable when the cursor is on it, cmd-click
  navigate/create). Headings/bold/italic instead get mark-DIMMING + typographic styling, not
  full mark-HIDING — the `#`/`**`/`*` characters stay visible (dimmed), rather than disappearing
  when the cursor leaves the line. Both satisfy the brief's "rendered headings/bold/italics"
  literally; upgrading the latter to cursor-aware hiding later is additive and doesn't touch the
  wikilink/tag/embed machinery. All decoration building is scoped to `view.visibleRanges`
  (expanded to line boundaries) per the pass's explicit perf trap — cost never scales with
  document length.
- 2026-07-09 · pass 03 · **Settings is a Radix `Dialog` modal, not a separate OS window.** Matches
  Obsidian's own UX for this exact feature; the brief said "Settings window skeleton" but didn't
  make a separate OS window load-bearing, and a modal is the simpler, more usual pattern for an
  in-app settings surface.
- 2026-07-09 · pass 03 · **`recentVaults` (vault rail MRU) is a `localStorage` list, not the real
  cross-vault registry.** D17's `vaults.json` registry in app support is pass-05 scope
  (multi-vault); the rail only needs to visually support "one icon per vault, one-click switch"
  now, with a single vault open at a time, which localStorage satisfies without building pass-05
  early. Swapping the backing store later doesn't change the rail's component contract.
- 2026-07-09 · pass 03 · **Op-log (D38) is minimal: only `rename` pushes an inverse op so far.**
  `accept-suggestion`/`takeover`/`restore-snapshot` don't exist as features yet (later passes);
  `state/opLog.ts` is a plain undo/redo stack any future structural op can push onto without
  redesign. `cmd-z` is bound app-wide but only actually undoes something once a rename has
  happened; CodeMirror's own history still owns `cmd-z` while the editor has focus (S23).
  `quick-switcher`/`search`/`global-capture`/`graph-view` keymap ids are registered (so their
  combos can never collide with anything else) but have no handler attached yet — they belong
  to passes 4/5/10.
- 2026-07-09 · pass 03 · **Reading view has no GFM support** (tables, strikethrough, task lists) —
  only `remark-parse` + `remark-frontmatter` are wired (same stack as the domain parser, D20); no
  `remark-gfm` dependency was added. Uncommon enough in early daily use that it wasn't worth a
  new dependency for this pass; add `remark-gfm` in a later pass if the owner hits it.

## Blocked

(empty)
