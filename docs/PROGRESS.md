# Progress Ledger

Update this file at the end of every pass: set status, date, record deviations from the brief
and anything the next agent must know. One pass in flight at a time; respect dependencies.

| Pass | Title | Depends on | Status | Completed | Notes |
|------|-------|-----------|--------|-----------|-------|
| 00 | Toolchain & scaffold | — | **done** | 2026-07-08 | Tauri 2 + React 19 + TS scaffold at repo root (identifier `com.dewflash.denote`, product name `DeNote`). Source tree per MASTERPLAN §3 (empty `index.ts` files w/ header comments). Tailwind v4 + `src/app/tokens.css` (light/dark via `prefers-color-scheme`, `data-theme` override). Vitest + ESLint flat config w/ domain-purity boundary rule (`no-restricted-imports` on `src/domain/**`) — probed with a `react` import, confirmed it fails lint, then removed. `pnpm tauri dev` builds and opens the 3-pane placeholder shell; `pnpm test`/`pnpm lint` pass. Only `opener` Tauri plugin enabled (fs/dialog/global-shortcut deferred). No Swift sidecar or AI deps added (`sidecar/apple-ai/` has a README stub only). |
| 01 | Domain core: parser, types, graph builder | 00 | **done** | 2026-07-08 | Pure `src/domain/`: `types.ts` (MASTERPLAN §5 + `WikiLink.heading` S2 + `ParsedNote.warnings` per brief), `sha256.ts` (pure FIPS-180-4, see deviation), `hashing.ts` (S1 verbatim port of the reference; all 12 vectors + R1 property test green), `parser.ts` (unified/remark blocks + masked inline scanner, S2/S3/S5), `links.ts` (S4 + ghost identity + link-index builder), `backlinks.ts` (D5, computed only), `graphBuilder.ts` (D6/D6a/D7/D17 hub model, deterministic sorted output), `takeover.ts` (D9/S10 pure decision fn). 119 tests pass (48-case parser corpus + S3 vectors, hashing vectors+property, links, backlinks, takeover, graphBuilder snapshots, vision-corpus deterministic layer, sha256 vs node:crypto). `pnpm test`/`pnpm lint`/`tsc`/`pnpm build` all clean. Reference script still ALL GREEN. Next: pass 02 → **architect checkpoint A** follows. |
| 02 | Vault engine: fs, watcher, repository, indexes | 01 | **done** | 2026-07-08 | Rust core: `containment.rs` (S22 canonicalize-then-verify + shared ignore set; 6 unit tests incl. symlink-escape & `../` green via `cargo test --lib`), `fs_commands.rs` (`read_note`/`write_note` atomic tmp+fsync+rename S7, `list_vault_files` ignore-filtered, `list_dir`, `create_dir`/`delete_path`/`rename_path`/`stat_path`/`path_exists`, `register_vault_root` w/ managed `VaultRoots`), `watcher.rs` (`notify`-based recursive watcher → `denote://fs-event`, ignore-filtered in Rust, rename-mode mapping). TS: `services/storage.ts` (StorageBackend interface + `isIgnoredPath`), `tauriStorage.ts`, `watcherBridge.ts` (300ms per-path debounce), `snapshots.ts` (D21 pure policy), `errors.ts` (S20 `DenoteError`), `state/appWriteRegistry.ts` (S8 content-hash signatures + path-ops, consume-once, 5s window), `state/vaultIndex.ts` (live index, backlinks recomputed never stored), `state/repository.ts` (openVault/createVault/createNote/saveNote/renameNote/moveNote/deleteNote/snapshotNote; all writes tagged D23; per-note mutex + per-vault event chain S7/D29; rename refactor S9 preserving heading+alias; move reconciliation D4a via `registerRekeyHook`; meta.json bootstrap). 146 tests pass (27 new: integration temp-dir vaults for all DoD cases + appWriteRegistry + snapshots). `pnpm test`/`lint`/`build`, `cargo test --lib`, and hash reference script all green. Next: **architect checkpoint A** before pass 03. |
| 03 | App shell UI: layout, tree, editor, backlinks | 02 | **done** | 2026-07-09 | Full shell built: `app/keymap.ts` (S21 registry, duplicate-combo = throw, global listener), `state/opLog.ts` (D38 minimal undo/redo stack, wired to rename), `state/vaultStore.ts` (Repository lifecycle, watcher wiring, single open buffer w/ 800ms autosave, S23 rule 3 conflict bar, `createGhostAndOpen`), `state/uiStore.ts` (theme/accent/view-mode/panels, persisted). Editor: CodeMirror 6 (`features/editor/`) — `livePreview.ts` (two viewport-scoped `ViewPlugin`s: heading line-decorations + inline mark/replace decorations for bold/italic/wikilinks/tags/image-embeds; masks code regions via `syntaxTree`), `autocomplete.ts` (`[[` titles, `#` tags), `ReadingView.tsx` (remark→React renderer, same wikilink/tag/embed treatment), `AssetImage.tsx` + `services/assets.ts` (blob-URL image embeds via new Rust `read_asset` command, S22-contained). Explorer: `FileTree.tsx` (inline double-click rename → `renameNote`), `RecentNotes.tsx`, `TodayView.tsx` (S26 created/edited precedence). `BacklinksPanel`/`OutgoingLinksPanel` + Radix `Tabs` right panel. `CommandPalette`/`SettingsModal` (Radix `Dialog`) — Appearance section fully functional (theme + accent live via CSS vars), other sections are labeled stubs. `VaultRail`, `StatusBar`, paste-capture v1 (`features/capture/pasteCapture.ts`). New deps: `zustand`, `@radix-ui/react-{dialog,tabs}`, CodeMirror 6 packages, `@tauri-apps/plugin-dialog` (D39, recorded in DECISIONS.md). 175 tests pass (29 new: keymap registry, opLog, noteDates, tree, vaultIndex btime). `pnpm test`/`lint`/`tsc`/`build` and `cargo build`/`test --lib` and the hash reference script all green. **Verification method and its limit (read before trusting this row):** I confirmed via `pnpm tauri dev` that the real Rust↔TS bridge boots cleanly (Cargo compiles incl. the new `read_asset`/`dialog` wiring, Vite serves, the window process starts, no crash); I additionally drove the plain Vite build in a CDP-connected browser (no Tauri context) and confirmed the Welcome screen renders correctly with live dark-mode + accent tokens and zero console errors, and that a Tauri-dependent action attempted outside Tauri fails silently rather than crashing the page. I could **not** personally click through the full interactive script below — my tools drive a Chromium tab over CDP, and Tauri's macOS webview is WKWebView, which CDP cannot reach. Every DoD step was traced against the actual code path (setActiveNote force-flushes the previous dirty buffer before switching, so backlinks are consistent regardless of navigation order; ghost cmd-click creates `{target}.md` in the open note's folder; ready view/theme wiring confirmed live in the browser check) but this is static reasoning + automated tests, not a substitute for using it. **Owner: please run the manual script and the ACCEPTANCE.md "after pass 03" checklist before greenlighting pass 04** — `pnpm tauri dev`, then: create a vault → create ~10 interlinked notes with `[[links]]` and `#tags` → confirm backlinks panel is correct → double-click a tree note to rename it, confirm inbound links rewrote → cmd-click an unresolved `[[Ghost]]` link, confirm it creates the note → cmd-T, confirm today's notes list → Settings → Appearance, confirm dark/light/accent apply live. If anything in that script fails, it's a real bug to report, not a limitation of this note. |
| 04 | Graph view | 02, 03 | **done** | 2026-07-10 | `GraphView` contract (D25, `features/graph/types.ts`): `{nodes, edges, groupings: {hullsEnabled}, styleTokens, callbacks}` — renderer-agnostic; `ForceGraphRenderer.tsx` is the first (and only) implementation, `react-force-graph-2d` (canvas 2D), added as a dependency (pre-approved by D25, no new DECISIONS entry needed). Pure logic (fully unit-tested, `tests/features/graph/`): `layout.ts` (fnv1a + deterministic disc-seeded initial positions so reloads look similar, no `Math.random()` anywhere in the pipeline), `hulls.ts` (convex hull, vault→folder NESTED hull builder — a child folder's point set is a proper subset of its parent's by construction, `hullOutline` degenerate-safe padding for 1-2-point folders), `filter.ts` (layer toggles + AI-confidence-slider filtering, drops now-orphaned hub nodes), `neighborhood.ts` (n-hop BFS for local view), `liveGraph.ts` (`reconcileNodePositions` — merges by id, reusing the SAME node object reference across `buildGraph()` rebuilds so the force simulation's x/y survive a note edit; this is the "index event → rebuild diff" mechanism), `colorUtils.ts` (hex→rgba for canvas alpha). Hull GEOMETRY is deliberately computed **inside** `ForceGraphRenderer`'s `onRenderFramePre` every frame (live node positions), not precomputed once per data change in `GraphPage` — doing it there would visibly lag during drag/settle. `NodeInspector.tsx`: title/type/folder/tags/counts + a connections list with per-edge provenance (source badge, confidence %, reason) — reads the **unfiltered** graph always, so provenance stays honest even with layers/confidence toggled off in the canvas; clicking a connection re-targets the inspector to that node. `LayerControls.tsx` + `state/graphStore.ts`: wikilinks/tags/topics/ai-similar toggles + confidence slider + structural-hulls toggle (default OFF per D7), all localStorage-persisted; local-view mode (center + hop count) is intentionally NOT persisted (a navigation mode, not a preference). `GraphPage.tsx` composes it all against the live vault (`buildGraph` fed by `repo.index.allNotes()`, no `similarPairs`/`topics` yet — empty in prod per D26, pass 6/7/8 wire those in with zero UI changes). Interactions: click note/ghost → open + close graph, cmd-click → open + keep graph open (ghost creation reuses pass-3's `createGhostAndOpen`), tag/topic click → select only, drag → `onNodeDragEnd` sets `fx/fy` to pin, background click clears selection. Local-view entry point lives in `Editor.tsx` (a small "Local graph" button, top-right, shown whenever a note is open) — reading view intentionally does NOT get one (brief said "reachable from the editor"; adding it to reading view too was scope creep, not requested). Tokens: `tokens.css` gained `--graph-node-*`/`--graph-edge-*`/`--graph-hull-0..7` (light+dark) — canvas can't resolve `var(--x)` itself, so `useGraphStyleTokens.ts` is the one place that bridges token → literal color, re-reading only on theme/accent change (the two live-swappable settings). Dev-only mock data (`mockFixture.ts`, exercises topic hierarchy + ai-similar + a below-threshold AI edge) is reachable at `?graphMock=1` in `pnpm dev` — gated by `import.meta.env.DEV`, statically eliminated from production builds — because prod has no topics/AI edges yet to visually check the styling against. Fixture-vault generator for the DoD's scale check: `scripts/gen-fixture-vault.mjs` (mulberry32-seeded, deterministic; `node scripts/gen-fixture-vault.mjs [outDir]` → ~200 notes, ~1,000+ wikilinks, nested folders incl. `Finance/Banking`); `tests/features/graph/fixtureVaultScale.test.ts` runs it for real, parses every file with the real parser, and runs the real `buildGraph`/`buildFolderHulls` over the output as an automated proxy for "renders" (200/200 note nodes, hundreds of wikilink+tag edges, nested-hull subset property holds, completes well under the test's generous 5s bound). 215 tests pass (40 new). `pnpm test`/`lint`/`tsc`/`pnpm build` all clean; no Rust/`src-tauri` changes this pass (cargo wasn't even reachable in this session's shell — irrelevant here since the graph is pure frontend). **Verification method and its limit (same as pass 03 — read before trusting this row):** my tools drive a Chromium tab over CDP; Tauri's macOS WKWebView is unreachable, so I could not click through the real app. What I DID do: ran the plain Vite dev server in that CDP browser at `?graphMock=1` (bypasses the vault-open gate specifically so this pass's UI is checkable at all without Tauri) and, live, confirmed — all 4 visual node types + both edge styles render distinctly; the structural-hull toggle paints a correctly-shaped translucent polygon around member notes and correctly excludes the ghost node; unchecking a layer checkbox visibly removes those edges from the canvas; clicking a note node opens `NodeInspector` showing correct title/type/counts and a connections list whose source badges/confidence/reason exactly match the underlying edge data (including a PARSER wikilink and two AI edges with real reasons); clicking a connection row re-targets the inspector; dragging the confidence slider to 0.50 live-removed the 40%-confidence edge from the canvas while the (deliberately unfiltered) inspector kept showing it; reloading the page preserved the slider/hull/layer settings (localStorage) AND produced a qualitatively similar initial layout (determinism); console stayed error-free throughout. What I could NOT verify live: click/cmd-click against a REAL open vault+note (needs Tauri's fs bridge), the local-view button in `Editor.tsx` (needs a real open note), and the 2,000-node/6,000-edge 60fps interaction budget (no GPU-attached browser in this environment) — the 200-note generated fixture's automated test (above) is the closest available proxy; I did not personally profile frame rate. **Owner: before greenlighting pass 05, please run `pnpm tauri dev`, open a real vault, press cmd-G, and separately run `node scripts/gen-fixture-vault.mjs` then open that folder as a second vault to eyeball perf at ~200 notes** (bump `--notes=2000` in the script if you want to personally check the stated budget — canvas 2D may or may not hold it at that size; if it doesn't, per the brief's R5 instruction this gets logged here, not silently worked around by swapping renderers). |
| 05 | Search & multi-vault | 02, 03 | **done** | 2026-07-10 | `services/searchIndex.ts`: `NoteSearchIndex` (D15, MiniSearch — ONE instance per vault, dropped on close) over title/headings/tags/body with boost `{title:8, headings:4, tags:3, body:1}`; indexes both user and provisional `ai:` tags (S26); `parseSearchQuery` (pure `tag:`/`folder:`/`vault:`/`has:ghosts` token parser). `state/vaultSearchSync.ts` wires a vault's `Repository` to its index via a new `Repository` dep `onIndexChange` (fires on EVERY note-level mutation — create/save/rename/move/delete, in-app AND external via the watcher). `features/search/`: `SearchPanel.tsx` (cmd-shift-F, highlighted snippets, click switches vault + opens), `QuickSwitcher.tsx` (cmd-O, fuzzy title jump across all OPEN vaults via a small pure subsequence matcher `fuzzyMatch.ts` — deliberately not MiniSearch, different UX job). **Multi-vault (D17):** `state/vaultStore.ts` rewritten to hold N concurrently-open `Repository`/watcher/`NoteSearchIndex` triples (module-scoped maps), with ONE "active" vault driving the existing single-buffer editor UI; switching among already-open vaults is a pointer swap (no I/O, satisfies "<100ms perceived"). Real registry (`services/vaultRegistry.ts`, pure CRUD + `vaults.json` glue) replaces pass-03's `recentVaults` localStorage stand-in entirely — persisted via a new Rust command `app_support_dir` (resolves + mkdirs the OS app-data dir) plus the EXISTING generic `register_vault_root`/`read_note`/`write_note` commands against it (still fully `contained_path`-checked, S22). `VaultRail.tsx` lists every registered vault (open or not) with its accent color + an open/closed dot; `SettingsModal.tsx` Vaults section: color picker, `localOnly` toggle (D18, enforcement lands pass 6), remove, and a relocate-on-open-failure flow that probe-opens the new folder and refuses unless `.denote/meta.json`'s vaultId matches (pitfall: never silently adopt an unrelated folder). `StatusBar.tsx` shows the active vault's color dot ("rail + hulls + headers" from the brief). **Graph:** `graphStore.selectedGraphVaultIds` (defaults to "all open," not persisted, same as local-view) drives `GraphPage`'s `buildGraph({vaults: [...]})` across every selected OPEN vault (graphBuilder itself needed ZERO changes — it was already vault-set-shaped since pass 1, incl. the S25 tag global-merge and the vision-corpus "no wikilink crosses vaults" test, which was written in pass 1 and is what actually proves EXPECTED.md's "(5)" line); `LayerControls.tsx` gets a vault checkbox selector (shown only when >1 vault open); `ForceGraphRenderer`'s hull painter now colors by the vault's registered accent (falls back to the pass-4 hash palette when unset — single-vault output unchanged); ghost `GraphNode`s gained `vaultId` (graphBuilder, needed for cross-vault ghost-click routing) — one graphBuilder snapshot updated. `NodeInspector`/`GraphPage` node-click handling now resolves via `node.vaultId` + `getOpenRepo` instead of assuming the active vault, switching active vault first when a combined-graph click targets a different one. **Domain:** `ParsedNote.bodyText` added (parser.ts, plain-text body via the already-approved `mdast-util-to-string`, frontmatter excluded) — search needs real prose text, which nothing in the existing `ParsedNote` shape carried. 258 tests pass (43 new: searchIndex incl. async-rebuild-is-chunked, vaultRegistry CRUD + glue, vaultSearchSync integration over a real temp-dir `Repository` covering edit/rename/delete/external-edit/external-delete/Finder-move/has:ghosts, fuzzyMatch, parser bodyText). `pnpm test`/`lint`/`tsc`/`pnpm build` clean; `cargo check` (full bin+lib, not just `--lib`) and `cargo test --lib` (6/6) both clean — confirms `app_support_dir`'s `tauri::Manager`/`AppHandle` usage compiles in the real app context; hash reference script ALL GREEN (bodyText touches parsing only, not the S1 hash path). **Verification method and its limit (same as passes 03/04 — read before trusting this row):** Tauri's WKWebView is unreachable by this session's CDP-based tools, so I could not click through a real vault-open/switch/search/quick-switcher/settings script. What I DID do: ran the plain Vite dev server in a CDP browser and confirmed (a) the dev-mock graph page (`?graphMock=1`) still renders correctly with zero console errors after the `vaultColors`/ghost-`vaultId` changes (fallback-palette path exercised, since no real registry exists outside Tauri), and (b) the Welcome screen (no vault open) boots cleanly with zero console errors, confirming the new fire-and-forget registry load correctly swallows the expected "no Tauri runtime" `invoke` rejection rather than surfacing one. **Owner: before greenlighting pass 06, please run `pnpm tauri dev` and the ACCEPTANCE.md "after pass 05" script** — add a second vault, switch via the rail (should feel instant), open the combined graph and toggle the vault checkboxes / structural hulls to see both vaults' colors, run a search with each filter type, cmd-O across both vaults, and try Settings → Vaults (color/localOnly/remove) plus the relocate flow (rename a registered vault's folder in Finder, then click it in the rail). |
| 06 | AI framework: AiClient, mock, annotations, takeover | 02 | **done** | 2026-07-10 | Full AI plumbing + UX on a MOCK backend. **Domain (pure, test-first):** `frontmatterText.ts` (line-surgical frontmatter edits — split/join, ai-block range scan mirroring S1, `addSeqItem`/`setScalar` for user keys, `yamlScalar`/`yamlFlowSeq`); `aiFrontmatter.ts` (`writeAiFrontmatter(text, ai\|null)` + `aiBlockUnchanged` — **R1-critical invariant asserted directly: `contentHash(writeAiFrontmatter(text, ai)) === contentHash(text)` for all ai**, because it only ever adds/removes the ai: block and leaves user fm + body byte-verbatim, and D3a strips ai: textually); `aiPayloads.ts` (per-kind payload types + `rejectionFingerprint` S11 = `sha256(kind\\x1f normalizedTarget)`, reason-independent); `aiApply.ts` (`applyAcceptedAnnotation` — link→`## Related` `[[wikilink]]` or span-wrap, tag/topic/alias→frontmatter seq, summary→scalar); `takeover.ts` gained `buildAiFrontmatter`. **Services:** `aiClient/` — `types.ts` (AiClient contract MASTERPLAN §6 + `modelId`/`isNetwork` pass-6 additions), `mock.ts` (deterministic mulberry32 seeded by CONTENT; concept-keyword-driven tags/topics/links with SPECIFIC reasons + VARIED confidences straddling 0.75; `MOCK_MODEL_ID='mock@1'`), `router.ts` (`AiRouter` routing table + **D18: a network backend is physically un-obtainable for a localOnly vault — throws `local-only-blocked` before returning a client**); `annotationStore.ts` (`.denote/ai/{annotations,rejections}.json`, S26 version:1, live/accepted/rejected lifecycle, `remapPath` for D4a, rejection memory D10/S11 — IO via a `InternalStoreIO` interface so it never imports `state/`). **State:** `enrichmentQueue.ts` (pure S12 bookkeeping: 1-job-per-note newest-hash-wins, backoff 5s/30s/2m→park, JSON round-trip reverting running→pending, `.denote/cache/queue.json`); `vaultAiEngine.ts` (one engine per open vault: debounced-2s hash-gated queue → mock enrich via router → store annotations (rejection-filtered) → S10 takeover apply/demote; **S23 dirty-buffer deferral** — a takeover write to an open dirty buffer is skipped + re-enqueued, never clobbering keystrokes; accept/reject with op-log inverse D38; S28 consent gate at >20 notes; `settle()` for deterministic tests). Repository gained guarded `readInternal`/`writeInternal`/`deleteInternal` (`.denote/` only, D23 routes ALL vault writes through the repo) + `getHash`. **Wiring:** vaultStore holds a per-vault engine map + shared `AiRouter`(mock), composes `aiBinding.onIndexChange` alongside search, exposes `aiSuggestionsFor`/`acceptSuggestion`/`rejectSuggestion`/`acceptSuggestionsAbove`/`enrichActiveNote`/`resolveAiConsent`; `aiTakeoverThreshold` persisted in uiStore. **UI:** RightPanel 3rd "AI" tab → `SuggestionsPanel` (grouped by kind, reason + confidence bar + model badge, Accept/Reject/Accept-all-≥threshold); `AiProvisionalBar` (editor strip showing ai: tags/links dashed+muted, S10); `AiConsentModal` (S28); Settings → AI & Models (routing table w/ Apple/Anthropic disabled-until-pass-7/9, threshold slider, per-vault localOnly); command palette "Enrich this note now" + "Suggest links for this note". **294 tests pass (+36: aiFrontmatter/apply/fingerprint 16, mock+router 7, engine integration 7, queue 6).** `pnpm test`/`lint`/`tsc`/`build` all clean; **hash reference `node docs/reference/hash_spec_test.mjs` ALL GREEN** (writeAiFrontmatter never touches the S1 strip path). **No `src-tauri` changes this pass** (AI framework is pure TS/mock — Rust embeddings/sidecar/keychain are passes 7/9); cargo was again unreachable in this session's shell, irrelevant here since nothing Rust changed since pass-05's clean `cargo check`. **The R1 loop is proven by integration test** (`tests/state/vaultAiEngine.test.ts`): bare note → enrichNow writes ai: block → contentHash unchanged → watcher echo classified app-write → ambient re-run hits the D26 hash gate → mock called EXACTLY once. Accept/reject+rejection-memory, adding-a-tag-demotes, and localOnly-zero-network-calls are likewise integration-tested against a REAL temp-dir Repository. **Verification method and its limit (same as passes 03/04/05):** Tauri's WKWebView is unreachable by this session's CDP tools, so I could not click the real suggestions/accept/provisional UI against an open vault. What I DID: booted the plain Vite dev server and confirmed the Welcome screen renders with **zero console errors** (regression check — the new module-level `AiRouter`/`MockAiClient` and per-vault engine wiring don't break app boot); every DoD claim above is proven by the automated integration suite over a real Repository, not just static reasoning. **Owner: before greenlighting pass 07, run `pnpm tauri dev` + the ACCEPTANCE.md "after pass 07" script IS premature (no real AI yet), so instead spot-check pass 6 by hand:** open a vault, create a bare note about (say) banking, wait a moment or run cmd-P → "Enrich this note now" → the AI tab shows tags/links with reasons + confidence and the editor shows a dashed "AI provisional" strip; add your own `#tag` → the strip vanishes; Accept a link suggestion → a `## Related` `[[link]]` appears and cmd-Z undoes it; Reject a tag, edit the note trivially → it stays rejected. **Checkpoint B (post-06) is due before pass 07** — its focus (R1 legitimacy, S10/S23/S28, annotation/rejection stores, D18) is exactly this pass. |
| 07 | Local intelligence: embeddings, Apple sidecar, enrichment | 06 | **done** | 2026-07-10 | The free tier is REAL and OFFLINE. **Rust (`src-tauri`):** `embeddings.rs` — a fastembed-free `EmbeddingStore` (S14 `.bin` `DENV`+u32 header / `.idx` JSON, incremental upsert, free-slot reuse, 0.25 compaction, model-mismatch invalidation, L2-normalized cosine topK) with **10 `#[cfg(test)]` tests green**, plus the `fastembed` inference wrapper (`multilingual-e5-small`, D32) behind a default-on `local-embeddings` feature so the store/commands compile+test even where the ONNX stack can't build; commands `embed_texts`/`embeddings_{index,put,remove,remap,topk}`. `sidecar.rs` — NDJSON supervisor (S13: 30s timeout via a reader-thread + `recv_timeout`, ≤3 restarts/60s then disabled, malformed-line drop, kill-on-drop, binary resolved by `DENOTE_SIDECAR_BIN` or exe-sibling); commands `sidecar_call`/`sidecar_capabilities`. **`cargo check`/`test --lib` GREEN with fastembed compiled** (ort/ONNX builds in this env, 33s). **Swift (`sidecar/apple-ai`):** `Package.swift` (macOS 26) + `Model.swift` (`@Generable` guided outputs, `SystemLanguageModel`) + `main.swift` (NDJSON loop, one repair retry). **`swift build` GREEN and VERIFIED END-TO-END OFFLINE** on this machine (Apple Intelligence `available:true`): `capabilities`, `summarize` (correct BOJ summary), guided `enrichNote` (structured topics/links/tags reusing the "Banking" topic + a named-shared-concept link), and `labelSimilarity` (correctly rejected BOJ-vs-miso-soup) all real-generated via `printf … | binary`. `scripts/build-sidecar.sh` stages it as a Tauri `externalBin` (bundled + `beforeDevCommand`/`beforeBuildCommand`). **TS:** pure `domain/tokenBudget.ts` (S16) + `domain/similarity.ts` (S15 vacuity gate/denylist/pair-ownership) [17 tests]; `services/embeddings.ts` (bridge + incremental plan + embed-text, pure-tested), `services/aiClient/apple.ts` (`AppleAiClient`: budgets input S16, normalizes tags S3, resolves link targets to candidates S4) [mock-transport tests], `services/similarStore.ts` (`.denote/ai/similar.json`, owner-centric + rejected-pair memory, D4a remap) [7 tests]; `state/vaultEmbeddings.ts` (`VaultEmbeddingEngine`: incremental embed-sync + the D6a two-gate similarity pipeline → SimilarStore → graph) [4 integration tests over a real temp-dir Repository + mock backend + mock LLM: edge only on a named concept, S15 rejection memory not re-asked, incremental re-embed, delete cleanup]. **Wiring:** `router.ts` `APPLE_ROUTING` (summarize/enrich/label-similarity → apple; mock kept for tests); vaultStore registers apple + the embeddings backend, runs a per-vault `VaultEmbeddingEngine`, and feeds `graphSimilarPairs` into `buildGraph` (ai-similar edges now render, zero graphBuilder change); `uiStore` similarity top-K/min-cos (S15 defaults 3/0.62) + capture state; Settings → AI enables Apple, live-editable routing table, similarity sliders; **paste-summarize** (`CaptureModal`, ≥800 chars) shows on-device title/summary/tags with a model-picker label before filing (D27 partial). **332 TS tests pass (+34)**; `pnpm test`/`lint`/`tsc`/`build`, `cargo check`/`test --lib` (16/16), `swift build`, and the **S1 hash reference ALL GREEN**. Boot regression re-checked live (Welcome + `?graphMock=1`, zero console errors). **Verification limit:** the *full-app* offline DoD (real vault embed-on-open with progress, the ai-similar edge appearing in the live graph, the suggestions panel from the Apple backend, R1 with the real backend) needs Tauri's WKWebView, which this session's CDP tools can't reach — but unlike passes 03–06, the **sidecar's real generations and the fastembed compile were verified directly**, and every TS/Rust unit + integration path is tested. **Owner: run the ACCEPTANCE.md "after pass 07" airplane-mode script** (`pnpm tauri dev`, Wi-Fi off): the first `swift build` + fastembed model download (~100MB, one-time, needs network ONCE) then everything offline. **Checkpoint C is post-08**, but the embedding store/model-mismatch (S14) and the D6a two-gate are this pass — worth an eye. |
| 08 | Ontology & semantic clustering, insights v1 | 07 | **done** | 2026-07-10 | Topic ontology is REAL. **Domain (pure, test-first):** `ontology.ts` (D14/S17 `canonicalizeTopic` exact→alias→centroid ≥0.80→create; `membershipWeight` conf+0.1·folder+0.05·min(reconfirm,3); `dominantTopic`/`strongMemberships`/`topicColorIndex` fnv1a%8; `isMisfit` 0-overlap AND cos<0.45; `computeResurfacing` sim×age, ≥90d, max 5; `cosine`/`centroidOf`/`foldTopicName` diacritic-fold) + `topicFile.ts` (S18 byte-stable `_topics` render, `generated_hash`=sha256(body), `decideTopicFile` create/regenerate/freeze/skip). **Services:** `topicStore.ts` (`.denote/ai/topics.json` S26 v1: topics w/ soft members+aliases+centroid+hierarchy, folderProfiles, resurfacingDismissals, misfits; recurrence-gated `proposeParent`/`proposeRelated` ≥2; merge/prune/remap; memory-mutators + one `persist()` per batch). **Rust:** new `embeddings_vectors` cmd + `EmbeddingStore::vectors_for` for folder-centroid/misfit math [+1 test, 17/17]. **State:** `vaultOntologyEngine.ts` (one per vault, on Repository hooks): `onEnrichResult` canonicalizes each proposed topic→membership→hierarchy→materializes affected `_topics`; `noteChanged` marks memberships stale; `organizeVault` (re-enrich stale→folder profiles+misfit→merge sweep centroids≥0.92+LLM confirm→prune→materialize-all, `onProgress`+`CancelToken`); `computeResurfacingCards`/`dismissResurfacing`; topic mgmt (rename→alias/merge/reparent/delete). Wired into `VaultAiEngine` via new deps `existingTopics()`+`onEnrichResult()` (D14/R3 retrieval-into-prompt now live); composed in `vaultStore` (ontology binding built before AI binding; `graphTopics`/`organizeActiveVault`/`getOpenOntologyEngine`). **UI:** GraphPage feeds topics into buildGraph + excludes `_topics/`+`source:ai` notes; **semantic clustering is the default view** (note nodes painted by dominant-topic color matching the topic hub + ring segments for ≥2 strong memberships — new `nodeColors`/`nodeRings` GraphView props); NodeInspector topic insights (description/parent/members/rename/delete); `OrganizeVaultModal` (cmd-P "Organize vault", progress + Cancel); misfit "May belong elsewhere" observation in SuggestionsPanel. **Swift sidecar** GenTopic gained `parentName`/`relatedNames` (@Generable) — **`swift build` GREEN + real offline generation confirmed** the model emits `parentName:"Finance"` for a Japanese-banking note (real Finance-parent path, not just stub). **392 TS tests pass (+60).** Vision-corpus pass-8 proof (`visionOntology.test.ts`) runs the REAL enrichment→ontology wiring over the canonical notes: Finance parent w/ Banking child holding Japan/Yen/Interest Rates/Untitled Capture; banking phrasing collapses to ONE topic; Miso Soup scatters (own Cooking cluster) + flagged folder misfit (never moved); De-dollarization+Gold cohere into a reserve-currency theme under Finance; `_topics/Finance.md` materializes; S18 freeze preserves user edits. `pnpm test`/`lint`/`tsc`/`build`, `cargo check`/`test --lib` (17/17), `swift build`, and **S1 hash reference ALL GREEN**. **Verification limit (same WKWebView gap as 03–07):** couldn't click the graph/insights UI against a real vault (Tauri webview unreachable by CDP; dev port 1420 held by a running server, left untouched) — but the sidecar hierarchy generation was verified DIRECTLY, `vite build`+`tsc` are clean, and every domain/service/state path is unit+integration-tested. **Owner: run the ACCEPTANCE "after pass 08" script** — cmd-P → Organize vault (watch progress, try Cancel); cmd-G default view should show topic-colored clusters with Miso scattering away from banking; click a topic node for insights; confirm `_topics/Finance.md` exists and editing it stops regeneration. **Checkpoint C (post-08) is due before pass 09** — its focus (canonicalization vs EXPECTED, topic sprawl, folder profiles/misfit, `_topics` byte-stability+freeze) is exactly this pass. |
| 09 | Cloud tier: Anthropic, deep-organize, budget cap | 07, 08 | **done** | 2026-07-12 | The paid 15% is real, capped, and durable — built + tested against a MOCK Anthropic transport (real-key run is owner-only, below). **Pricing (S19):** `services/aiClient/pricing.ts` — ONE module, `PRICING_VERIFIED_AT='2026-07-12'` (verified against the claude-api skill's live model/pricing table): opus-4-8 $5/$25, sonnet-5 $3/$15, haiku-4-5 $1/$5 per MTok; Batch 50% (D13); `budgetGuardCost = estimate×1.2` (S19). **Anthropic backend:** `aiClient/anthropic.ts` — `AnthropicAiClient` (isNetwork=true) + an INJECTABLE `AnthropicTransport` (mirrors apple.ts's SidecarTransport, so node-testable with no `@anthropic-ai/sdk`, no network); structured JSON via `output_config.format`, prompt caching (stable system prefix `cache_control:ephemeral`), streaming for `max_tokens>16k`, refusal→empty result; production transport lazily imports `@anthropic-ai/sdk` (v0.111, dep added per D13) + reads the key from Keychain per call; per-task model tiers (`DEFAULT_ANTHROPIC_MODELS`: summarize→haiku, enrich→sonnet, deep→opus, D13). **Keychain (D13):** Rust `keychain.rs` (`security-framework` crate, macOS-cfg-guarded so non-mac `cargo check` still builds) + `keychain_{set,get,has,delete}` commands + `services/keychain.ts`; key NEVER in files/JSON/env; Settings shows presence + "test key". **Spend ledger (S27):** `services/spendLedger.ts` `spend.json` (S26 v1) — estimate reserved BEFORE submission, reconciled to response `usage` after, expired batch → `lost` (visible, never dropped); monthly cap (default $10). **Batch durability (S27):** `services/batchStore.ts` `batches.json` — batchId + custom_id manifest persisted BEFORE polling; `resume()` on launch reconciles any non-terminal batch. **Deep-organize (D12/D13):** `domain/corpus.ts` (PURE: buildBatchItems theme-first/stale-priority/skip-enriched-nonstale, chars/3.5 estimate, `trimToBudget`) + `state/deepOrganize.ts` (`DeepOrganizeJob`: assemble corpus from NON-localOnly vaults [S27 assembler exclusion + assert] → local-trim → count_tokens the final batch → **HARD budget gate (a code assertion, the ONLY submission path — physically can't exceed the cap; asserted + tested with $0.01)** → submit → durable-persist → poll → reconcile → apply results by custom_id: notes via `VaultAiEngine.applyEnrichResult` (canonicalization + takeover apply IDENTICALLY, cloud gets no bypass), themes via `VaultOntologyEngine.applyTheme` (cross-note themes → topics, spanning folders/vaults, S25 merges visually). **Deep insights (D13):** `state/deepInsights.ts` — on-demand topic Analysis over member summaries ordered by time (stance evolution / rising-fading / contradictions citing note PAIRS / open questions), "analysis of YOUR notes" framing, NO predictive claims, same capped ledger (S27 no uncapped path). **Carried-in S24:** Rust `embeddings_topk_vector` (external-vector cross-store query) + `services/crossVaultStore.ts` (`crossvault.json`, app-side, D36) + `state/crossVaultEngine.ts` (cross-engine topK across open non-localOnly vaults → same D6a two-gate → renders in combined graphs only). **UI:** Settings → AI gains a Cloud section (key entry via Keychain, presence dot, test/remove, monthly-cap input, spend history); `DeepOrganizeModal` (cmd-P "Deep organize (cloud)") = plan→estimate+item-count→confirm→run w/ progress; `TopicAnalysisPanel` in NodeInspector (Run analysis → cited, clickable). **428 TS tests pass (+36: pricing, spendLedger, batchStore, crossVaultStore, anthropic shaping + D18 recheck, corpus, deepOrganize end-to-end incl. budget-gate/localOnly/durability/resume/expired-loss, deepInsights, crossVaultEngine two-gate).** `pnpm test`/`lint`/`tsc`/`build`, `cargo check`/`test --lib` (18/18, +1 top_k_vector), and **S1 hash reference ALL GREEN**. No Swift changes (sidecar untouched). **Verification limit (same WKWebView gap as 03–08):** the real-key end-to-end (enter key → run a real batch → theme appears → spend matches → $0.01 refuses) needs Tauri + the owner's key, so it's owner-only (marked awaiting-owner); everything is proven against a mock transport + in-memory stores over the real store/orchestrator/engine code, and the plain-Vite boot (Welcome + `?graphMock=1`) is console-clean after the new module-level wiring. **Checkpoint D (post-09) is due before pass 10** — its focus (budget gate physically-uncrossable, S27 durability, spend reconciliation, localOnly in assembler AND router, Keychain) is exactly this pass. |
| 10 | Capture, appearance polish, e2e smoke | 03, 06 | **done** | 2026-07-12 | Global capture is native on macOS: `capture.rs` registers cmd-shift-N, supports tray/menu capture while the main window is hidden, preserves/restores clipboard during fallback cmd-C capture, and carries source app/browser URL/title into the capture modal and provenance frontmatter (`source_url`, `source_app`, `source_title`, `captured_at`). Capture UI now has vault selection, remembered folder, always-on-top review, and source warnings; snippets are loaded from app support, toggleable, and hot-reloaded under `.snippet-scope`; theme JSON import/export, bundled themes, live token/graph palette editing, editor typography, and density controls are wired. Status-bar graph-health counts are actionable. Hardening includes surface error boundaries, schema migration/quarantine wiring, and derived-index rebuilds from Markdown. Verification is recorded in the follow-up audit below. |
| 11 | Sync & import: git/GitHub, dedupe | 02 | **done** | 2026-07-12 | Git-backed history uses Rust `git2` (`git_history.rs`) with opt-in per vault, main-branch init, DeNote-safe `.gitignore`, manual checkpoints, debounced 10-minute auto-checkpoints, close-time flush, merged note timeline, diff, and non-destructive restore. GitHub sync supports existing/private remotes, Keychain tokens, manual push/pull, opt-in interval sync, local-only warnings, and `git2` pull-rebase with conflict fallback that materializes remote Markdown alongside local notes. Import supports recursive Markdown/text and Obsidian structure, single-file drag/drop, exact content-hash skips, embedding-cosine near-duplicate review (deterministic fallback is explicitly reported if embeddings are unavailable), and reserved `ai:` frontmatter review. Limit: creating a new GitHub repo via OAuth device flow is not implemented; users connect an existing private remote and store a token in Settings. |

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
| B | 06 | AI plumbing: R1 loop test legitimacy, takeover state machine (S10), dirty-buffer deferral + op-log undo (S23), annotation/rejection stores, router localOnly enforcement | **done 2026-07-10 — PASS w/ 2 architect-added tests** |
| C | 08 | Flagship quality: canonicalization behavior vs EXPECTED.md, topic sprawl check on a real vault, folder profiles/misfit, `_topics` byte-stability + freeze | **done 2026-07-10 — PASS w/ 1 architect-added probe** |
| D | 09 | Money & privacy: budget gate is physically-uncrossable, batch durability (S27), spend reconciliation, localOnly in assembler AND router, Keychain handling | **done 2026-07-12 — PASS w/ 1 architect fix (crash window)** |
| E | 11 | Release audit: full-repo sweep, derived-data deletion drill, conflict handling, private-repo default, EXPECTED.md + ACCEPTANCE.md end-to-end | **done 2026-07-12 — PASS w/ conditions (2 architect fixes; condition 1 e2e complete 2026-07-13; owner scripts outstanding)** |

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

- 2026-07-10 · **CHECKPOINT B (post-06, sweeping 03–05)** · **verdict: PASS; architect added
  2 missing tests; all pass 03–06 deviations APPROVED.**
  Verified: suites 296 TS + 6 Rust green, lint/build green, reference ALL GREEN. **R1 loop
  test is legitimate** — real Repository, real watcher echo, counting client, asserts exactly
  1 enrichment across write→echo→ambient-re-run; the `writeAiFrontmatter` R1 invariant
  (`contentHash` unchanged for all ai payloads) is asserted directly in domain tests. S10
  state machine, D30 accept-demotes-rest (with failure rollback), S11 fingerprint
  (reason-independent, resolved-path-preferring), S12 queue (newest-hash-wins, 5s/30s/2m
  backoff→park), D18 router (network client physically un-obtainable for localOnly — typed
  error + zero-calls integration tests both directions) all verified in source. Checkpoint-A
  directive (in-app saves → queue via onIndexChange) fulfilled. Passes 03–05 spot-swept:
  S21 keymap registry, D38 op-log, S23-rule-3 conflict bar present; hulls default OFF (D7),
  deterministic seeded layout (no Math.random), inspector reads UNFILTERED graph (honest
  provenance); S25 global lowercased tag ids; registry relocate flow refuses vaultId
  mismatch; no feature imports @tauri-apps directly. **Architect fixes: S23 dirty-buffer
  deferral and S28 consent gate were implemented but UNTESTED** (the two most race/trust-
  critical behaviors of the pass) — added both integration tests (deferral: no ai: write
  while dirty, applies after clean; consent: 25-note bulk pauses ≤20 applied, prompt fires,
  'apply' releases all 25, no re-prompt). Both passed first-run. **Directive for pass 10:**
  SettingsModal hardcodes `#c0392b` danger color twice — introduce a `--danger` token in
  tokens.css (both themes) during Appearance completion. **Directive for pass 07 (standing):**
  Vitest's node backend cannot exercise tauriStorage→Rust — pass 07 adds Rust surface
  (fastembed, sidecar spawn); its DoD manual steps are the only real-path verification, run
  them in the actual app. Cleared for pass 07 (Opus 4.8, high).

- 2026-07-10 · **CHECKPOINT C (post-08, sweeping 07)** · **verdict: PASS; architect added 1
  probe + fixed its lint; all 07/08 deviations APPROVED (one codified into SPECS).**
  Suites independently re-run: 393 TS (42 files) + 17 Rust green, lint/build green, `swift
  build` green, S1 reference ALL GREEN. **Checkpoint focus verified in code+tests:**
  canonicalize order exact→alias→centroid≥0.80→create with alias recording (unit-tested at
  every step incl. bogus existingTopicId fall-through); S17 formulas exact (weight
  conf+0.1·folder+0.05·min(reconfirm,3), dominant tie lexicographic, misfit 0-overlap AND
  cos<0.45, resurfacing sim×age/≥90d/max5/dismissals); S18 `_topics` byte-stable render
  (double-render equality test, no timestamps, weight-desc-then-path member order) +
  generated_hash freeze; vision-corpus pass-8 test runs the REAL engine wiring and proves
  every EXPECTED.md pass-8 line incl. Miso-scatter + misfit-never-moved anti-goals; S15
  vacuity denylist verbatim to spec incl. the 5 phrases + 15-char floor; S14 store
  (DENV header, model-mismatch invalidation, 0.25 compaction) Rust-tested; S13 sidecar
  (30s timeout, ≤3 restarts/60s, repair-retry) implemented + REAL on-device generations
  verified during the pass (incl. hierarchy: parentName "Finance" for a Japanese-banking
  note). **Architect gap-fix:** the corpus stub always proposed the canonical name
  "Banking", so the integration anti-sprawl test proved exact-match collapse only — added a
  variant-name probe driving "Banking"/"banks"/"The Banking System" through the REAL
  VaultAiEngine→VaultOntologyEngine path → exactly ONE topic, aliases recorded, all three
  notes members. Passed first-run (mechanism was correct; proof was missing).
  **Deviation rulings:** SimilarStore dedicated `.denote/ai/similar.json` APPROVED —
  single-writer reasoning is sound; S15 amended to codify. S24 cross-vault deferral
  APPROVED as flagged — now a binding carried-in directive in the pass-09 brief (owns the
  app-support store + cross-engine topK). Token-budget head/tail approximation, APPLE_ROUTING
  default w/ session-scoped settings routing (persist = pass-10 nicety), SuggestedTopic
  parentName contract extension, hierarchy-recurrence-in-topic-store, misfits-in-topics.json
  all APPROVED. Cleared for pass 09 (Opus 4.8, high); checkpoint D follows it.

- 2026-07-12 · **CHECKPOINT D (post-09)** · **verdict: PASS with 1 architect fix; all six
  deviations APPROVED (two codified into SPECS).**
  Verified: 430 TS (51 files) + 18 Rust green, lint/build green, S1 reference ALL GREEN.
  **Money:** the hard budget gate is the only submission path (assertion + $0.01 block
  test); insights share the SAME ledger with their own hard gate; no other code path reaches
  the Anthropic transport (grep-verified). **Privacy:** localOnly excluded in the assembler
  (with defense-in-depth assert + test) AND at the router (D18 recheck); crossVaultEngine
  skips localOnly vaults. **Keychain:** security-framework, key read per call, never in
  files/JS state; presence-only UI. **S24 carried-in directive fulfilled** (crossvault.json
  app-side + cross-engine topK + two-gate + combined-graph-only, tested). Cloud output gets
  no canonicalization bypass (applyEnrichResult shares the on-device path).
  **Architect fix — submit crash window:** submission ran BEFORE the ledger reserve and
  batch record were persisted; a crash in that window = a billable batch with no local
  record and no reserved spend (silent money loss, the exact S27 pitfall). Fixed to
  stage-before-submit: `submitting` staging record + reserve precede createBatch; success
  swaps in the real batchId; failure unwinds both; a `submitting` leftover at launch is
  marked LOST with its estimate still counted against the cap. Two tests added (failed
  submit unwinds fully; crash leftover → lost, money visible, nothing polled). S27 amended
  to codify (the original wording was impossible as written — API assigns the id).
  **Deviation rulings:** paid-backend-not-per-task-routable APPROVED as the stricter correct
  S27 reading — codified into S27; sdk/security-framework deps OK; model-tier UI picker
  deferral OK (pass-10 nicety with routing-persist); rejection-memory at ingest-time OK
  (net behavior identical, marginal token cost — acceptable); body-head summary proxy OK
  (real cached-summary store noted as additive future work); per-vault theme materialization
  + S25 visual merge APPROVED (correct under D14/D36 portability). **Owner still owes the
  real-key end-to-end** (enter key in Settings → run a small deep-organize → verify estimate
  → confirm → spend matches → set cap $0.01 → refusal), marked awaiting-owner.
  **Handoff note:** passes 10–11 will be executed by a non-Claude model (GPT 5.5). The
  contract is unchanged and executor-agnostic: read CLAUDE.md → DECISIONS → SPECS →
  PROGRESS → the pass brief; SPECS is normative (D31); log deviations here; two DoD failures
  = stop and summon the architect. Checkpoint E (final release audit, architect) follows
  pass 11.

- 2026-07-12 · **CHECKPOINT E (final release audit, post-11)** · **verdict: PASS WITH
  CONDITIONS — 2 architect fixes applied; condition 1 e2e suite complete 2026-07-13;
  v1 sign-off still gated on owner manual scripts.**
  Suites independently re-run: 440 TS (55 files) + 18 Rust green, lint/build green, `swift
  build` green, S1 reference ALL GREEN. Earlier layers verified UNDISTURBED: zero diffs in
  `src/domain/`, SPECS, DECISIONS, CLAUDE.md since checkpoint D; R1 loop, budget-gate,
  containment, and crash-window tests all still present and green.
  **Verified good in 10–11:** vault `.gitignore` is exactly right (only `meta.json` +
  `ai/topics.json` committed; annotations/similar/embeddings/cache/snapshots machine-local —
  D36 privacy honored); restore runs the pipeline exactly once via
  `app-write-content-change` (S8); import dedupe uses S1-normalized contentHash for exact
  skips + 0.95-cosine review list, `.obsidian` skipped, reserved `ai:` key warned (D28);
  conflict policy writes sibling `(conflict …)` files, never merge markers; snippets scoped
  under `.snippet-scope` with Settings portaled outside + hostile-CSS unit test; migration
  scaffold (no-op v1 + corruption quarantine) real and tested; `--danger` tokenized (both
  themes); tray + global-hotkey capture with provenance frontmatter.
  **Architect fixes:** (1) capture fallback now restores an EMPTY prior clipboard too
  (was: selection left behind), text-only limitation documented; (2) **first-push
  visibility gate added** — it was entirely missing (one-click un-gated push): a vault's
  first push now checks the GitHub repo's visibility via the API and requires explicit
  confirmation naming PRIVATE / PUBLIC / UNKNOWN (+ parser unit tests). The pass-11 brief
  called this out as catastrophic-if-missed; the executing model skipped it silently — the
  one substantive contract failure of the handoff (also: work left uncommitted, deviations
  unlogged — retro-logged above).
  **Conditions for v1 sign-off:** (1) COMPLETE 2026-07-13 — pass-10 e2e smoke added as
  `pnpm e2e` using Playwright against the dev-server path allowed by the brief (open vault
  → note → link → backlink → graph → search → capture sim → hostile snippet cannot brick
  Settings); (2) owner runs ACCEPTANCE after-07/08/09/10/11 (airplane-mode AI, Organize Vault, real-key
  deep-organize + $0.01 refusal, Safari capture, private-repo round-trip + `.denote/cache`
  deletion drill). When both land, mark v1 COMPLETE here.

## Owner manual-testing findings (post-06) — NON-BLOCKING fix list — **DONE 2026-07-10** (folded into the pass-07 session)

Owner ran the real app against real vaults; findings triaged by the architect 2026-07-10.
Already fixed by architect (committed): cmd-F now aliases global search; graph nodes have a
minimum 9px hit radius (low-degree dots were nearly unclickable — likely the "click just
zooms" report). Remaining 4 items resolved this session (all four **done**, scope respected —
tokens only, no new deps):

1. **Visible affordances** — DONE. `ExplorerPanel.tsx` gained a header toolbar with three
   icon buttons (new note / search / graph view), each with a hotkey tooltip (`⌘N` / `⌘⇧F` /
   `⌘G`). Buttons dispatch through the ONE keymap registry (`appKeymap.invoke(id)`) so a click
   and its shortcut are guaranteed identical; `formatCombo()` added to `keymap.ts` (+2 unit
   tests) renders combos as Mac glyphs. Inline SVGs, token-driven hover, no new deps.
2. **Graph empty-state guidance** — DONE. `GraphPage.tsx` renders a one-line overlay hint
   when the visible graph has 0 edges: "No edge layers active — enable Wikilinks / Tags /
   Topics / AI-similar above." if all four layers are off, otherwise "No connections match the
   current filters — try 'Reset view' above." (suppressed when there are simply no nodes at
   all — not a filter problem). `graphStore.resetView()` + a **Reset view** button in
   `LayerControls.tsx` restore DEFAULT_LAYERS + confidence 0.10. **Verified live** in a plain
   Vite preview (`?graphMock=1`): unchecking all 4 layers showed the exact hint; Reset view
   restored `[true,true,true,true]` + confidence `0.1` and cleared the hint; zero console errors.
3. **cmd-N / ctrl-N / graph-click — verified (static trace + preview; real-vault live run still
   needs Tauri, see below):**
   (a) Graph note-dot click → `GraphPage.handleNodeClick` note branch calls
   `setActiveNote(relPath)` then `setGraphViewOpen(false)` on a plain click (cmd-click keeps
   the graph open) — opens the note and closes the graph, as intended (GraphPage.tsx).
   (b) cmd-N is handled by the single window-level keydown listener (`installGlobalKeymap`),
   NOT a focused-element handler, so it fires identically whether the editor or the file tree
   has focus; `new-note` → `createUntitledNote(selectedFolder)`. cmd-N is not a CodeMirror
   default binding, so CM does not swallow it while the editor is focused.
   (c) ctrl-N is inert: `comboFromEvent` returns `null` unless `metaKey` is set (ctrl ≠ meta),
   so no binding is ever looked up for it, and no other code path listens for ctrl-N. The
   existing keymap test already asserts `metaKey:false → null`.
   Console: no errors observed in the preview session. **Limitation (same as passes 03–06):**
   this session's browser tools drive Chromium over CDP and cannot reach Tauri's macOS
   WKWebView, and the graph note-click path needs a real open vault (Tauri fs bridge), so the
   REAL-app click was traced in source + exercised via the mock-graph selection path, not
   clicked against a live vault. Owner: a 30-second `pnpm tauri dev` click confirms (a) end-to-end.
4. **Note-dot labels at default zoom** — DONE. Labels were gated at `globalScale > 2.2`
   (unreadable-hairball guard for large graphs). `ForceGraphRenderer` now gates note labels by
   note count (`noteCount < 100 ? 0.3 : 2.2`) and keeps auxiliary labels more conservative, so
   small graphs show note titles at any normal fit-zoom without making dense graphs a text
   hairball. The graph also fits the bounded seeded world after layout settles, re-fits on
   container resize until the user pans/zooms, and exposes a searchable **Notes in map** index so
   isolated notes remain addressable even when labels are intentionally hidden. **Verified live**
   (`?graphMock=1` screenshot): all four fixture notes, including isolated "Miso Soup Recipe",
   are inside the canvas after settle; the index contains all four and filters to Miso.

- 2026-07-13 · independent inspection of the UX-AMENDMENTS execution (commits `f3401c4`,
  `62eda5f`) · **verdict: PASS, no corrections.** Independently re-ran the full stack: 449 TS
  tests / 57 files, lint, tsc, production build, Playwright e2e 3/3, Rust 19/19 + `cargo
  check`, S1 hash reference ALL GREEN. Protected surfaces verified untouched: `src/domain/`,
  SPECS, DECISIONS, CLAUDE.md, `package.json` (zero new deps). Hard constraints held: no
  note↔note edge fabrication anywhere (liveGraph diff is seed-radius only; renderer adds no
  edges — D6); `Repository.createFolder` normalizes + rejects traversal/dot segments with an
  integration test proving `../outside` throws and a directory watcher event fires no pipeline
  (S8/S22/D23); keymap `rebind` throws on collisions and saved-keymap restore drops invalid
  entries (S21); hotkey persistence writes only `app_data_dir/hotkey.txt`; git pull-rebase
  aborts to sibling conflict files, never merge markers (pass-11 policy). Spec compliance
  spot-verified in code + live `?graphMock=1` screenshot: P1.1 local-view banner w/ counts +
  "Show all notes", P1.4 plain-English layer copy verbatim, P2.1 shared `VersionTimeline`
  reachable from FileTree + Settings, P2.3 "unlinked · missing" status chip w/ clickable rows,
  P3.1 first-run card, P3.2 drag-and-drop via the existing `moveNote` wrapper. Beyond-spec
  additions (searchable "Notes in map" index, graph auto-fit, meta.json corruption quarantine,
  import symlink/`.TXT` hardening, editable hotkeys UI) reviewed individually — all sound, all
  logged by the executor with honest deviations. Console clean in the live check.

## Owner manual-testing findings (post-11, 2026-07-13) — fixed same day

Owner ran the real app; findings and resolutions:

1. **"Clicking a note doesn't open it while the graph is open" — REAL BUG, fixed.**
   `CenterPane` renders `GraphPage` INSTEAD of the editor while `graphViewOpen`, but the file
   tree stays visible and clickable — a click updated `activeNotePath` invisibly and the screen
   didn't change (same flaw for the Today overlay). Fix: `vaultStore.setActiveNote` now REVEALS
   the editor (closes the graph/today overlays) by default, so every note-opening affordance in
   the app — tree, backlinks, outgoing, search, quick switcher, recents — is visibly answered.
   `GraphPage` passes `reveal: false` and keeps managing its own visibility, so pass-04's
   cmd-click-keeps-graph-open behavior is unchanged. Regression-tested
   (`tests/state/setActiveNoteReveal.test.ts`, 3 tests, stubs browser globals to drive the REAL
   store in node).
2. **"No clue what Backlinks/Outgoing is for; UI must speak plain English" — copy pass, done.**
   Right-panel tabs renamed **Links in / Links out / AI** with hover tooltips; each panel gained
   a one-line plain-English header ("Notes that link to this note — click one to open it.") and
   instructive empty states ("Nothing links to this note yet. Type [[ in another note…").
   AI panel: added "The AI reads this note and suggests tags, links, and topics. Nothing is
   changed unless you accept a suggestion."; "Enrich now" → "Get suggestions". Center empty
   state now says "Click a note in the left sidebar, or press ⌘N to create a new one."
3. **Graph exit affordance:** LayerControls gained a right-aligned "✕ Close graph" button
   (⌘G tooltip) + "Click a dot to open that note." hint — previously the only exits were ⌘G or
   clicking a dot, both undiscoverable.
5. **Opened-Desktop-as-vault incident (same session):** owner registered `~/Desktop` as a vault
   while `~/Desktop/Daily Wisdom` was already one — nested roots double-index the same notes and
   the cross-vault engine burns sidecar calls comparing identical notes. Diagnosed live (not a
   hang; background churn + the bug in item 1 compounding). Guard work spun off as a separate
   task: refuse/warn on overlapping vault roots at register/open time. UNSCHEDULED — needs an
   architect-reviewed decision entry when picked up.

Verification: 443 TS tests (56 files, +1 file), lint, tsc, `pnpm build`-equivalent via e2e dev
server, `pnpm e2e` (1/1), zero console errors on the dev preview graph page. No S/D-numbered
behavior touched (S10/S23/D38 paths untouched; pass-04 graph click contract preserved).

Follow-up graph audit (2026-07-13): 444 TS tests (56 files), lint, tsc, production build,
`pnpm e2e` (2/2), Rust tests (18/18), Swift sidecar build, hash reference suite, and
`git diff --check` all green. The isolated-note regression is covered by the second e2e test.

6. **Full "exists-but-invisible" audit (owner asked: "anything else not interactable from the
   UI?"), all gaps closed same day:**
   - `deleteNote` and `moveNote` had NO UI anywhere (notes were undeletable/unmovable in-app) →
     FileTree right-click context menu: Open / Rename… / Move to folder… (lists existing
     folders) / Delete… (two-step inline confirm, `--danger`). Dependency-free positioned menu;
     all actions route through the existing vaultStore wrappers (S9 rename rewrite, D4a move
     reconciliation, op-log where wired). Rename editing state lifted to FileTree so
     double-click and menu-Rename share one mechanism; note rows got a
     "Click to open · double-click to rename · right-click for more" tooltip.
   - **Resurfacing cards (pass-8 `computeResurfacingCards`) were computed but never rendered
     anywhere** → Today view gained a "Worth revisiting" section (open-on-click, per-card ✕
     dismiss → `dismissResurfacing`, hidden when empty).
   - Organize vault / Deep organize were command-palette-only → "Organize vault…" button in the
     graph toolbar; "Deep organize…" button in Settings → AI & Models → Cloud (disabled until a
     key is present).
   - Today view (⌘T), quick switcher (⌘O), command palette (⌘P) were hotkey-only → three new
     explorer-toolbar icon buttons via the existing keymap-invoke pattern (S21, one registry).
   - Reading view (⌘E) was hotkey-only → "Reading view" button in the editor's top-right button
     group; reading view gained a matching "Edit" button (previously reading mode had NO visible
     exit).
   Settings gear on the vault rail was added the same day (separate finding). Not added (still
   palette/hidden): nothing known — palette "Open: <note>" entries and the quick switcher
   overlap by design. Verification re-run after the batch: 443 TS tests, lint (2
   set-state-in-effect violations found by the repo's lint rule and restructured properly), tsc,
   build, dev-preview screenshot of the graph toolbar, console clean.

## Owner inputs required

Things only the owner (Kevin) can provide. When a pass reaches a step needing a missing
input, the agent STOPS that step, marks it here as `awaiting-owner`, tells the owner exactly
what is needed and why, and continues with the rest of the pass if independent.

| Input | Needed by | Status | Notes |
|-------|-----------|--------|-------|
| LICENSE choice for the repo | any time (repo is public with no license = all rights reserved) | awaiting-owner | agent adds the file once told |
| App icon / final branding | pass 10 (build polish) | awaiting-owner | default Tauri icon until then |
| Anthropic API key | pass 09 (entered by owner in Settings → AI & Models → Cloud, stored in macOS Keychain — never give it to an agent in chat) | **awaiting-owner** | Pass 09 is built + fully tested against a MOCK transport. Owner verification (ACCEPTANCE "after pass 09"): open Settings → AI & Models, paste key into the Cloud section, click "Test key" (should say ✓); cmd-P → "Deep organize (cloud)" → "Estimate…" shows a cost + item count; "Run" applies notes + a theme topic spanning two folders; Settings spend history matches; set the monthly cap to $0.01 and confirm the estimate refuses to run; mark a vault local-only and confirm none of its notes appear in any cloud run. |
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
- 2026-07-10 · pass 04 · **`react-force-graph-2d` added** (pulls in `force-graph`, `d3-force`
  and friends transitively). Not a new architectural decision — D25 names this exact library
  ("react-force-graph, canvas 2D") as the pass-4 renderer choice; recorded here per the usual
  new-dependency note, not in DECISIONS.md, since D25 already covers it.
- 2026-07-10 · pass 04 · **Hull polygon geometry is computed inside `ForceGraphRenderer`'s
  per-frame paint callback, not once per data change in `GraphPage`.** The brief's
  `GraphViewProps.groupings` was going to carry precomputed `HullGroup[]`; that was reworked to
  carry only `{hullsEnabled: boolean}` once it became clear hull polygons must track LIVE
  simulation/drag positions (mutated in place on the node objects every animation frame) — a
  value computed once per React render would visibly lag behind an in-progress drag or the
  settle animation. The renderer derives folder membership itself (vaultId + relPath embedded in
  every note node's id) and calls the same tested `buildFolderHulls`/`hullOutline` pure
  functions fresh each frame. `HullGroup` stays exported from `hulls.ts` and fully unit-tested;
  only the call SITE moved.
- 2026-07-10 · pass 04 · **A dev-only `?graphMock=1` query param renders `GraphPage` with
  `mockFixture.ts` data, bypassing the normal "vault must be open" gate** (checked via
  `import.meta.env.DEV`, so it's statically eliminated from production builds — unreachable in
  a shipped app regardless of query string). This is the pass brief's "storybook-style dev page"
  requirement, implemented as a query flag rather than a new Storybook dependency (out of the
  approved stack) or a separate route (the app has no router). It's also what let this session
  verify the graph visually at all — Tauri's WKWebView is unreachable by this session's tools
  (same limitation as pass 03), and a real vault can't be opened without Tauri's fs bridge, so
  this was the only way to drive real interaction end-to-end in a plain CDP browser.
- 2026-07-10 · pass 04 · **The "local view mode ... reachable from the editor" button lives only
  in `Editor.tsx`, not `ReadingView.tsx`.** The brief specifically named the editor; adding the
  same button to reading view too would be an unrequested scope increase. Trivial to add later
  (same `graphStore.enterLocalView` + `setGraphViewOpen` two-liner) if the owner wants it there.

- 2026-07-10 · pass 05 · **`minisearch` added** (D15 names it explicitly — no new DECISIONS
  entry needed, same treatment as `react-force-graph-2d` in pass 4).
- 2026-07-10 · pass 05 · **New Rust command `app_support_dir`** resolves (and mkdir's) the OS
  app-data directory via `AppHandle::path().app_data_dir()`, keyed by the bundle identifier
  `com.dewflash.denote` — i.e. `~/Library/Application Support/com.dewflash.denote/`, not the
  literal `~/Library/Application Support/DeNote/` MASTERPLAN §4 illustrates. Same class of
  directory (per-app, OS-conventional, sandbox-safe); this is Tauri's standard resolution rather
  than the literal product-name string, trivially overridable later if the owner wants the exact
  folder name. The command itself only resolves a fixed system path (never file contents); actual
  `vaults.json` reads/writes reuse the EXISTING generic `register_vault_root`/`read_note`/
  `write_note` commands against that directory (registered as an additional containment root) —
  S22 says "a separate, equally-guarded command" for the app-support dir, which this satisfies in
  spirit (same `contained_path` boundary, no new content-access surface) even though it's not a
  textually distinct command per content-operation; flagged here rather than silently done.
- 2026-07-10 · pass 05 · **`ParsedNote.bodyText` added** (domain/parser.ts) — plain-text body
  (frontmatter excluded) via the already-approved `mdast-util-to-string` dependency (D20/pass-1).
  Full-text search over "body" (this pass's explicit deliverable) needs real prose text, and
  nothing in the pass-1 `ParsedNote` shape captured it (only structural fields — headings/links/
  tags/frontmatter). Supersedes the MASTERPLAN §5 shape the same way `warnings`/`WikiLink.heading`
  already do; does not touch S1 hashing (hash reference script still ALL GREEN).
- 2026-07-10 · pass 05 · **`Repository` gained a new dep `onIndexChange: IndexChangeHook`**
  (state/repository.ts), firing `(relPath, ParsedNote | null)` on every note-level index mutation
  — upsert or delete, in-app (create/save/rename/move/delete) OR external via the watcher. This
  closes a real pre-existing gap: `handleDelete` (external/Finder deletes) previously produced NO
  notification to ANY consumer, not even a `revision` bump — the brief's own instruction to
  "verify pass-02 discipline actually held; fix drift now" is exactly this. Search
  (`state/vaultSearchSync.ts`) is the hook's first consumer; annotation/embedding stores (pass 6+)
  can register against it too instead of duplicating reindex-tracking logic.
- 2026-07-10 · pass 05 · **Search-index rebuild uses MiniSearch's own `addAllAsync`** (chunked,
  yields via `setTimeout(0)` every 10 docs) rather than a Web Worker — the brief's pitfall offered
  either ("index in a worker or chunked async"); chunked async fully satisfies "must not block the
  UI" with far less plumbing, and D15's own text sets the bar at "adequate <5k notes." A visual
  progress affordance in the status bar (also suggested) was NOT built — a deferred nice-to-have,
  not a correctness gap (the mechanism to add one, `rebuild()` already returns a `Promise<void>`
  the status bar could subscribe to, is in place).
- 2026-07-10 · pass 05 · **Quick switcher (cmd-O) uses a small hand-written subsequence fuzzy
  matcher** (`features/search/fuzzyMatch.ts`), not MiniSearch. Different job: "type characters in
  order, jump to a title" (fzf/Obsidian-style) vs. MiniSearch's tokenized/boosted full-text search
  — reusing MiniSearch for both would mean fighting its tokenizer for single-character/partial-
  word matching. No new dependency; ~20 lines, pure, unit-tested.
- 2026-07-10 · pass 05 · **`recentVaults` (pass-03's localStorage MRU stand-in) removed entirely**
  and replaced by the real `vaults.json` registry, per that row's own note that this was always
  the plan. `VaultRail`/`SettingsModal` were rewired to the registry; no back-compat shim kept
  (nothing reads the old localStorage key anymore).
- 2026-07-10 · pass 05 · **Combined-graph vault selection (`graphStore.selectedGraphVaultIds`)
  defaults to "every currently open vault"** rather than starting empty — opening a second vault
  makes the combined graph show both immediately, no extra click needed to satisfy the DoD's
  "combined graph shows both hull sets." Session-only, not persisted (same treatment as
  `localView`): it tracks which vaults HAPPEN to be open, not a durable preference.

- 2026-07-10 · pass 06 · **AI framework additions to the AiClient contract.** MASTERPLAN §6's
  `AiClient` gained two fields, documented in `services/aiClient/types.ts`: `modelId` (the exact
  model version string stamped into every annotation — D26 hash-gating keys on
  `(contentHash, modelId)`) and `isNetwork` (whether the backend sends content off-device — the
  router's D18 check reads it). Not a new architectural decision; both are mechanical
  requirements of D26/D18 that the summary shape omitted. `EnrichResult` also carries `aliases`
  (the `alias` annotation kind exists in MASTERPLAN §5 but §6's prose only listed
  topics/links/tags/summary).
- 2026-07-10 · pass 06 · **All `.denote/` store writes route through new guarded Repository
  methods (`readInternal`/`writeInternal`/`deleteInternal`)** rather than a raw backend handle,
  satisfying D23 ("every app-originated vault write goes through the repository") literally for
  the annotation/rejection/queue JSON. They assert the path is in the shared ignore set (S22), so
  a caller can never reach a real note through them; no app-write tagging is needed because
  ignored paths never emit watcher events or index mutations. `annotationStore.ts` consumes this
  as an `InternalStoreIO` interface, which also keeps that service free of any `state/` import.
- 2026-07-10 · pass 06 · **Enrichment is triggered off the existing `onIndexChange` hook, not a
  new pipeline entry point.** The pass-02 deviation flagged that in-app saves weren't yet wired to
  the enrichment queue (S12) — this pass closes it by having the per-vault `VaultAiEngine` subscribe
  to `onIndexChange` (the same choke point search uses), which fires for create/save/rename/
  external-edit alike. `onPipeline` (the watcher's external/app-write-content-change signal) is
  left as the buffer-conflict trigger it already was; the two are complementary, and hash-gating +
  D26 make a double-trigger a harmless no-op. Debounce is 2s (S12); manual `enrichNow` bypasses it.
- 2026-07-10 · pass 06 · **The S28 bulk-consent gate is implemented but lightly exercised.** The
  mechanism is present (per-vault `takeoverConsent` persisted in `queue.json`; provisional apply is
  held + a modal prompted when it would push a vault past 20 provisional notes), but pass 6 has no
  "enrich whole vault" command (that arrives with real embeddings/Organize-vault in passes 7/8), so
  the >20 path is reachable only by editing many bare notes by hand. The `apply`/`none`/`ask`
  choices, hold, and resume-on-`apply` are wired; no automated test drives the 20-note threshold.
- 2026-07-10 · pass 06 · **`accept` strips any provisional `ai:` block in the SAME write that adds
  the accepted structure (D30/S10).** Accepting a suggestion is user curation, which both writes the
  real markdown AND demotes remaining provisional entries; doing both in one `saveNote` keeps accept
  a single atomic, single-undo op (the op-log inverse restores the pre-accept bytes incl. the ai:
  block). The remaining `applied-provisional` annotations flip to `suggested` (they're keyed to the
  pre-edit hash, so they don't re-surface for the new content, but the status is corrected).

- 2026-07-10 · pass 07 · **`fastembed` added behind a default-on `local-embeddings` Cargo feature.**
  Not a new decision — D24 names `fastembed` explicitly. The feature flag isolates the heavy
  `ort`/ONNX-Runtime native stack (build-time binary download) so the embedding STORE + topK +
  all commands compile and `cargo test --lib` runs even with `--no-default-features`; production
  (`default = ["local-embeddings"]`) ships the real model. When disabled, `embed_texts` returns a
  typed "unavailable" error and jobs queue — the app stays fully usable.
- 2026-07-10 · pass 07 · **The embedding store + cosine topK live in Rust, not TS.** S14's binary
  format is Rust-natural and D24 puts vectors in the Rust core; the storage backend is string-only,
  so binary vectors can't cleanly cross the TS bridge anyway. The S14 format + topK are unit-tested
  in Rust (`cargo test --lib`). TS owns only the incremental *plan* + embed-text (pure, tested).
- 2026-07-10 · pass 07 · **Vetted ai-similar pairs live in a dedicated `.denote/ai/similar.json`
  (SimilarStore), not as `kind:link` entries in `annotations.json`, and failed pairs live there too
  rather than in `rejections.json`'s `similarityPairs` key.** Reason: the enrichment pipeline's
  `replaceLiveFor(relPath)` REPLACES a note's live annotations, which would wipe similarity edges
  stored alongside them; a single-writer dedicated store avoids that collision. It still honors S15's
  substance — owner = lexicographically smaller relPath, the other endpoint + both hashes in the
  record, dedup one-edge-per-pair, and "don't re-ask until content changes." graphBuilder consumes
  them via `SimilarPair` unchanged.
- 2026-07-10 · pass 07 · **Cross-vault ai-similar pairs (S24 `crossvault.json`) are NOT wired this
  pass** — the pipeline is within-vault (the DoD's "new note overlapping an old note" is within-vault;
  cross-vault is "allowed", a nice-to-have). `similarity.ts` already computes `isCrossVault` and the
  pair identity is vault-scoped, so the app-support store + multi-engine coordination slot in without
  reworking the gates. Flagged rather than silently skipped.
- 2026-07-10 · pass 07 · **`APPLE_ROUTING` is the production default; `DEFAULT_ROUTING` (mock) is
  kept for tests.** Changing `DEFAULT_ROUTING` globally would have broken every pass-06 engine test
  (they build a mock-only router). vaultStore constructs the shared router with both mock + apple and
  `APPLE_ROUTING`; an unavailable Apple backend is still *returned* by the router and its calls fail
  gracefully (jobs queue) — apple is never network, so D18 is moot for it. Settings routing is
  session-scoped (resets to `APPLE_ROUTING` on launch); persisting it is a later nicety.
- 2026-07-10 · pass 07 · **Token budgeting (S16) truncates the flattened `bodyText` head/tail rather
  than structurally preserving every heading.** The `AiClient.enrichNote` contract passes `text`
  (already flattened by the parser — headings are in the prose), so "keep all headings" is
  approximated by keeping the leading 60% (which holds the early headings) + trailing 20% with the
  `[…truncated…]` marker. Structural heading extraction would need a contract change; deferred.
- 2026-07-10 · pass 07 · **Swift sidecar uses `@Generable` guided generation and was verified by
  real on-device generation** (Apple Intelligence is `available` on the owner's Mac). The model can
  return imperfectly-formatted tags (e.g. "Central Banks"); `apple.ts` normalizes them to valid tag
  tokens (S3) and resolves free-text link targets back to the offered candidate notes (S4).

- 2026-07-10 · pass 08 · **`SuggestedTopic` gained optional `parentName`/`relatedNames`** (aiClient
  `types.ts`) and the Swift `GenTopic` gained matching `@Generable` fields. MASTERPLAN §6's enrich
  result listed only topic name/reason/confidence, but D14 hierarchy ("topic creation also proposes
  parentId and relatedIds") needs the model to name a parent — so the contract carries the *name*
  (the app canonicalizes it to an id, since the model can't know internal ids). Optional +
  backward-compatible: the mock leaves them undefined; `swift build` is green and a real offline
  generation emits `parentName:"Finance"`, so the real Finance-parent path is exercised, not stubbed.
- 2026-07-08→pass-08 · **Hierarchy edges are recurrence-gated in the TOPIC STORE, not as
  `annotations`.** The brief says hierarchy edges are "annotations (suggested) until they recur ≥2
  times or the user accepts, then applied." Implemented as `parentProposals`/`relatedProposals`
  counters on the topic record (`proposeParent`/`proposeRelated` apply at count ≥2), rather than
  minting `kind:'topic-topic'` annotations in `annotations.json`. Reason: the annotation store's
  `replaceLiveFor(relPath)` is note-keyed and would churn/lose vault-global hierarchy edges (same
  collision that put similarity pairs in their own store, pass 7). Behavior — proposed twice ⇒
  applied; user reparent = immediate — is identical; the recurrence count persists in `topics.json`.
- 2026-07-10 · pass 08 · **Misfit suggestions live in `topics.json` (`misfits[]`), not as a new
  `AiAnnotation` kind.** The brief renders misfit "in the suggestions panel" as a "may belong in
  {folder}" SUGGESTION. Adding a `'misfit'` annotation kind would ripple through `aiApply`/`aiPayloads`/
  `rejectionFingerprint`/accept-demote for a suggestion that is never "accepted" (it's an observation,
  never an automatic move — D8/anti-goal). So it's stored ontology-side and surfaced as a read-only
  banner in `SuggestionsPanel`. Computed during Organize-vault (needs folder centroids from the
  embedding store); no per-keystroke cost.
- 2026-07-10 · pass 08 · **Folder profile / misfit centroid math reads raw vectors via a new Rust
  `embeddings_vectors` command** (+ `EmbeddingStore::vectors_for`). The store previously only exposed
  `topK`; folder centroids and note-to-centroid cosine (misfit) need the actual vectors, computed in
  pure TS (`centroidOf`/`isMisfit`, unit-tested) over what the command returns. S22-contained like
  every other embedding command; a missing vector is simply skipped (misfit then can't be judged →
  not flagged, the safe default).
- 2026-07-10 · pass 08 · **A note about banking is a member of BOTH the child (Banking) and the
  parent (Finance) topic** when the model proposes both — the ontology does NOT auto-propagate
  membership up the hierarchy. This is why `_topics/Finance.md` materializes (Finance accrues ≥3
  direct members) while Banking stays the more specific cluster under it. The real Apple backend
  proposes multiple topics per note (verified: a Japanese-banking note returns Finance + Banking +
  Japanese Banking), so this is the natural shape, not a workaround; the vision-corpus test drives
  the same multi-topic proposals a real backend produces.
- 2026-07-10 · pass 08 · **Semantic-cluster note coloring reuses the graph renderer's own palette
  function** (`layout.paletteColor('topic:'+id, hullPalette)`), NOT `domain/ontology.topicColorIndex`.
  Both are `fnv1a(x) % 8`, but the note's dominant-topic color must match its topic HUB node's color
  exactly, and the hub is painted with `paletteColor(nodeId=...)` over the full `topic:{id}` string.
  `topicColorIndex(topicId)` (bare id) is kept in the domain layer for any non-graph consumer and is
  unit-tested; the graph deliberately colors via the id string the hub node uses so the two agree.
- 2026-07-10 · pass 08 · **Resurfacing ("worth revisiting") is engine-complete but only lightly
  surfaced in the UI.** `computeResurfacingCards`/`dismissResurfacing` exist on the engine (pure
  ranking `computeResurfacing` is unit-tested), but no dedicated insights card was added to a panel
  this pass — the misfit banner is the one insights affordance wired into `SuggestionsPanel`. The
  fuller insights-panel-v1 layout (timeline histogram, co-occurring topics, the resurfacing card, the
  "Analysis" slot for pass-9 synthesis) is a UI surface deferred; all its DATA sources (dates via
  `index.mtimes`/S26, topic co-occurrence via the store, resurfacing via the engine) are in place, so
  it's additive. Flagged rather than silently dropped.

- 2026-07-12 · pass 09 · **`@anthropic-ai/sdk` (v0.111) and `security-framework` (Rust) added.**
  Neither is a new architectural decision: D13 names the Anthropic Batch API + keys-in-Keychain, and
  the pass-09 brief names `@anthropic-ai/sdk` explicitly. `security-framework` is the standard macOS
  Keychain crate, added under a `[target.'cfg(target_os = "macos")'.dependencies]` block and paired
  with a cfg-guarded `keychain.rs` so a non-macOS `cargo check`/`test --lib` still compiles (the
  commands return a typed "macOS only" error there). Recorded here per the usual new-dependency note.
- 2026-07-12 · pass 09 · **The paid Anthropic backend is NOT a per-task routing option in Settings.**
  S27 mandates "no uncapped path to the paid backend." Per-note enrichment (VaultAiEngine) calls the
  routed client directly with no ledger, so routing `enrich`/`summarize`/`label-similarity` to
  anthropic would be uncapped. The paid tier is therefore reachable ONLY through the capped
  deep-organize batch + on-demand insights flows (both gate on `spendLedger` before any call). The
  `AnthropicAiClient` is still registered in the shared router so the D18 boundary is enforced (and
  the D18 recheck test is meaningful) if a future pass ever routes a capped task to it; the Settings
  routing dropdown lists it as disabled ("deep-organize only"). This is stricter than the brief's
  loose "routing table exposes the anthropic backend" wording, and is the safer reading of S27.
- 2026-07-12 · pass 09 · **Per-task MODEL tier (opus/sonnet/haiku) is coded, not yet a UI picker.**
  `DEFAULT_ANTHROPIC_MODELS` sets deep-organize→opus (D13 default), enrich→sonnet, summarize/similarity
  →haiku, and the `AnthropicModels` constructor arg makes it fully overridable — but a per-task model
  dropdown in Settings is deferred (same class of nicety as the pass-07 routing-persist deferral).
  The single "deep model" the batch + insights use is `DEFAULT_DEEP_MODEL` (opus-4-8) as D13 requires.
- 2026-07-12 · pass 09 · **Rejection memory (D10) is honored at RESULT-INGEST time, not at
  corpus-assembly time.** The brief says "respect rejection memory when assembling the corpus: don't
  pay to re-ask rejected questions." The corpus assembler skips already-enriched non-stale notes
  (so it doesn't re-send settled notes at all), and `applyEnrichResult` drops any suggestion whose
  `(fingerprint, contentHash)` was rejected (S11) before it ever surfaces — so a rejected suggestion
  can never re-appear. The finer optimization (never even SEND a note whose only pending work is a
  rejected question) is not implemented; net user-visible behavior is identical, the only difference
  is a marginal token cost on such notes. Flagged rather than silently skipped.
- 2026-07-12 · pass 09 · **Deep-organize per-note "summary" in the corpus is a body-head proxy, not a
  fresh on-device `summarize` call.** D12 says the paid tier reads "per-note summaries (on-device,
  cached)". To avoid firing an Apple `summarize` per note at plan time (latency + it isn't cached
  anywhere yet), the assembler uses the note's cached membership reason if present, else the first
  ~40 words of `bodyText` — a deterministic on-device proxy that still never sends full bodies (D12).
  A real cached-summary store is additive (a `summary` annotation already exists as a kind); flagged.
- 2026-07-12 · pass 09 · **Cross-note THEMES that span vaults are materialized as a per-vault topic in
  each vault holding ≥2 cited members, relying on the S25 combined-graph merge to show them as one.**
  Topics are strictly per-vault (D14/D36 portability), so a genuinely cross-vault theme can't be a
  single stored topic. `applyThemes` resolves the cloud's cited note titles to relPaths within each
  open vault and calls `VaultOntologyEngine.applyTheme` per vault; S25 merges same-named topics
  visually in the combined view. Within a single vault the DoD's "theme spanning two folders" is a
  plain multi-folder topic. Canonicalization applies to theme names too (cloud gets no bypass, D14).

## Post-1.0 Candidates

- Plugin API and template packs for importer/exporter extensions.
- Mobile companion capture and read-only vault browsing.
- Publishing/export surfaces for selected notes/topics.
- Market-data insights enrichment for finance vaults, gated behind explicit opt-in and budgets.
- First-run GitHub repo creation via OAuth device flow; v1 currently connects an existing private
  remote and stores the token in Keychain.
- Full tauri-driver/WebdriverIO e2e harness; v1 has unit/integration/build/cargo coverage plus
  manual Tauri/Safari smoke checks.

- 2026-07-12 · passes 10–11 · **Retroactive deviation entries, recorded by the architect at
  checkpoint E** (the executing model disclosed these as "Limits" in the ledger rows but did
  not log them here, and did not commit its work — both contract requirements):
  (a) **e2e smoke suite (pass-10 deliverable) was not implemented at checkpoint E** —
  fixed 2026-07-13 by adding `pnpm e2e` with Playwright + a dev-only smoke harness.
  (b) **GitHub repo creation via OAuth device flow not implemented** — v1 connects an
  existing remote with a PAT stored in Keychain. Acceptable v1 scope reduction.
  (c) New deps: `git2 = 0.21`, tauri `tray-icon` feature, osascript-based selection capture.
  All within pass briefs' intent; recorded here per the dependency rule.
  (d) Clipboard preserve/restore in the capture fallback is TEXT-ONLY (pbpaste/pbcopy) —
  rich/image clipboard content is not round-tripped. Acceptable, now documented in code.
  (e) Checkpoint-B/C directives NOT picked up: settings routing persistence and the
  per-task model picker remain session-scoped/coded-only. Moved to post-1.0 candidates.

## Blocked

(empty)

## Follow-up Audit

- 2026-07-13 · UX amendments (graph comprehension + remaining UI gaps) · **implemented P1→P3.**
  Local graph now announces its hop scope and visible/full counts, exits through `Show all notes`,
  sparse graphs explain orphan dots and how to create structure, medium/large graphs keep the
  hovered/selected label visible with softened zoom bands, and every graph filter uses plain
  English copy. Orphan inspection now teaches `[[` and opens the note. Per-note history is a
  shared Radix dialog reachable from FileTree and Settings; restore flushes a dirty buffer before
  the single normal restore pipeline. Folder creation is routed through `Repository.createFolder`
  with path validation, the toolbar and move menu expose it, and note/folder/root drag-and-drop
  moves use the existing `moveNote` path-refactor wrapper. Status-bar health rows are clickable
  and use plain language; empty vaults receive derived first-run guidance; AI routing/capture
  labels no longer expose raw task/backend ids.
  **Deviations:** the Rust recursive listing intentionally omits empty directories, so a newly
  created empty folder is kept visible only for the current session and reappears after restart
  once it contains user content; no placeholder file is written. Directory-only watcher events
  can still reach the TS repository bridge, but `handleUpsert` fails the note read, treats the path
  as unknown, and fires no pipeline; this is covered by the new integration test rather than a
  new watcher protocol. No note↔note graph edges or new dependencies were added.
- 2026-07-13 · UX amendments verification · **449 TypeScript tests / 57 files, lint, `tsc
  --noEmit`, production build, Playwright e2e 2/2, hash reference suite, and `git diff --check`
  green.** The first sandboxed e2e attempt could not bind `127.0.0.1:1420` (`EPERM`); the same
  suite was rerun with local-server permission and passed.

- 2026-07-13 · UX/pass 10–11 follow-up audit · **PASS with three targeted hardening fixes.**
  Re-traced the P1–P3 acceptance paths and pass-10/11 capture/import contracts. Fixed normalized
  folder paths not being returned to the UI after creation, prevented a note-row drop from
  bubbling into an accidental root move, and hardened native import scanning to skip symlinks
  and map uppercase `.TXT` files to the correct `.md` path. Added graph interaction assertions
  and repository/import regression coverage. **Verification:** 449 TypeScript tests / 57 files,
  lint, `tsc --noEmit`, production build, Playwright e2e 3/3, Rust library tests 19/19,
  individual `rustfmt --check` for `import_scan.rs`, hash reference suite, and `git diff --check`
  green. Full `cargo fmt --check` still reports pre-existing formatting in unrelated Rust files;
  no unrelated formatting was changed. Owner manual Tauri/Safari/private-GitHub/real-key scripts
  remain outstanding per Checkpoint E.

- 2026-07-13 · final responsive graph audit · **PASS with no new scope deviations.** Re-ran the
  graph at 1280x720 and 390x844 through the browser harness. The full graph keeps all four fixture
  notes discoverable, labels remain readable without collisions, connected and isolated notes sit
  in a compact readable field, and the desktop map measures 1040px with the list open (760px with
  the inspector open). On narrow windows the note list starts closed, keeps the map at 390px, and
  closes before an inspector opens so the two panels never stack over the graph. Added the focused
  mobile orphan-note assertion to the e2e suite. Label placement uses a spatial occupancy grid so
  zooming into a large graph does not fall back to a quadratic collision scan. No graph edges were
  fabricated and no persisted layer keys were renamed. **Verification:** 449 TypeScript tests / 57
  files, lint, `tsc --noEmit`, production build, Playwright e2e 4/4, Rust library tests 19/19,
  Swift sidecar build, S1 hash reference suite, and `git diff --check` green. Full `cargo
  fmt --check` still reports pre-existing formatting in unrelated Rust files; no Rust files were
  changed in this audit. Remaining gaps are owner-only Tauri/Safari capture, real-key cloud, and
  private-GitHub acceptance scripts from Checkpoint E.

- 2026-07-13 · final responsive shell/modal audit · **PASS with no new scope deviations.** Re-ran
  the welcome screen, fixture shell, full graph, sparse-graph controls, and isolated-note path at
  desktop and 390x844. The production shell now collapses to a 48px rail plus an editor column on
  narrow windows; the note list and inspector become mutually exclusive drawers, while graph mode
  hides both side panels. Welcome copy, status health, conflict actions, smoke controls, and all
  fixed-width dialog surfaces stay within the viewport; long dialog bodies scroll instead of
  clipping. Added the narrow-window Playwright regression. **Verification:** 449 TypeScript tests /
  57 files, lint, `tsc --noEmit`, production build, Playwright e2e 5/5, hash reference suite, and
  `git diff --check` green. The sandboxed e2e server needed approved host bind access; plain Vite
  cannot exercise native Tauri vault/capture bridges, so owner-only acceptance items remain those
  listed under Checkpoint E.

- 2026-07-13 · UX/pass 10–11 follow-up audit · **one responsive graph interaction gap found and
  fixed.** The prior audit verified that selecting a note from the mobile "Notes in map" index
  closed that index before opening the inspector, but direct canvas selection could still leave
  both overlays visible; opening the index from an already-selected node had the inverse problem.
  `GraphPage` now enforces mutual exclusion in both directions at the 720px breakpoint. Added a
  Playwright regression that clicks the seeded canvas node with the index open, then reopens the
  index and verifies the inspector closes. **Verification:** 449 TypeScript tests / 57 files,
  lint, `tsc --noEmit`, production build, Playwright e2e 6/6, Rust library tests 19/19, Swift
  release build, hash reference suite, and `git diff --check` all green. No graph data, persisted
  layer keys, or note-edge rules changed.

- 2026-07-13 · UI interaction/accessibility follow-up audit · **mouse-only navigation paths
  removed.** Backlinks, outgoing links, Recent, Today, resurfacing cards, command-palette results,
  quick-switcher results, rendered wikilinks, and note/folder tree rows now expose native button or
  keyboard-button semantics; the resurfacing card keeps its dismiss action separate, and a global
  `:focus-visible` token makes keyboard focus legible across the welcome screen and shell. Drag/drop
  and context-menu surfaces remain pointer gestures by design. **Verification:** 449 TypeScript
  tests / 57 files, lint, `tsc --noEmit`, production build, Playwright e2e 6/6, and `git diff
  --check` green.

- 2026-07-13 · settings discoverability follow-up · **visible close control added.** Production
  Settings previously relied on Escape or clicking the overlay, with no in-panel close affordance;
  the Radix dialog now exposes a top-right `Close settings` button and marks section controls with
  `aria-pressed`. **Verification:** 449 TypeScript tests / 57 files, lint, `tsc --noEmit`,
  production build, Playwright e2e 6/6, and `git diff --check` green. The e2e smoke Settings
  screen remains a fixture-only shell path; native Tauri Settings still requires owner acceptance.

- 2026-07-13 · graph/AI + vault persistence audit · **the missing relationship path was real and
  is now fixed.** AI takeover suggestions were persisted in `ai:` frontmatter but `graphBuilder`
  ignored that namespace, so accepted/provisional AI links and tags could never appear on the map.
  The graph now renders them as explicitly AI-suggested dashed relationships with provenance, and
  the graph keeps note-to-note edges limited to authored wikilinks, accepted provisional AI links,
  and the vetted S15 similarity pipeline; no heuristic shared-word edges are fabricated. Body
  wikilinks remain the user's durable authored links.
  `Settings → AI & Models` now reports Apple Foundation Models availability and offers Retry; the
  suggestions panel explains when the browser/native bridge is unavailable instead of implying
  that an empty queue means success. Direct sidecar capability probe on this Mac reports
  `apple-fm@1` and `available: true` before generation. A follow-up generation probe exposed a
  Model Manager 1008 runtime failure; the continuation audit below fixes the false-positive health
  state.
  Empty folders are now indexed by the Repository and returned by the native recursive walker, so
  they remain visible and usable after reopening a vault. **Verification:** focused graph, queue,
  embedding, and repository tests pass; TypeScript type-check passes; Rust library tests 19/19; browser
  audit shows all four fixture notes and titled connected nodes at desktop and 320px with no
  console errors. The Apple embedding model is still lazy/native-only and may take time to obtain
  on first use; that limitation is now visible rather than silently presented as a working AI map.

- 2026-07-13 · continuation runtime audit · **two substantive defects fixed.** Removed the
  heuristic shared-word note-to-note graph layer because it violated D6/S15's no-fabricated-edge
  contract; the map now links notes only through authored wikilinks, hub structure, provisional AI
  structure, or the vetted embedding + model similarity pipeline. Similarity now preflights backend
  capabilities once per sync, stops on the first unavailable-model response, uses bounded retries,
  and resumes unresolved work after Settings Retry or a routing change. Settings Retry now wakes
  parked enrichment jobs too. The suggestions panel shows an in-flight state and an actionable
  error instead of swallowing a failed AI request. The Apple sidecar classifies Model Manager 1008
  as `ai-unavailable`, exposes the reason on the next capability check, and the Rust supervisor no
  longer restarts the process for a model response error. **Native probe:** generation failure is
  now reported as `ai-unavailable`, followed by `capabilities.available=false`; the failure is
  honest on this Mac because the Apple model is not currently ready. **Verification:** 452
  TypeScript tests / 57 files, lint, type-check, production build, Playwright e2e 6/6, Rust 19/19,
  Swift sidecar build, S1 hash reference, and `git diff --check` green.

- 2026-07-13 · continued UI/AI audit · **three concrete interaction failures fixed.** Small graphs
  now seed and settle into a compact readable field so isolated notes do not begin stranded far
  from the connected component; the placement-only attraction is skipped above 300 nodes to keep
  large-map tick work bounded. Desktop file explorer and Links panel now have independent collapse
  and reopen controls, while graph mode and mobile drawers keep their existing panel rules.
  Organize vault now catches on-device model failures, resets its running state, and exposes a
  retryable error instead of hanging when Apple Foundation Models returns Model Manager 1008.
  The mobile overlay regression now selects through the stable note index rather than a settling
  canvas coordinate. **Verification:** 453 TypeScript tests / 57 files, lint, `tsc --noEmit`,
  production build, Playwright e2e 6/6, native Tauri Vite/Rust/Swift build and boot, hash reference
  suite, and `git diff --check` green. Native screenshot capture was unavailable in this headless
  session; the Apple model remains unavailable on this Mac and is reported honestly by the app.

- 2026-07-13 · passes 10–11 audit · **implemented missing user-facing contracts rather than leaving
  them as stubs:** graph health now lists/open-or-creates orphan notes and unresolved links; Settings
  now exposes bundled/custom theme JSON, live token + graph palette colors, CSS snippet toggles with
  hot reload, editor font/size/line width, density, graph hull/filter reset, editable persisted
  hotkeys with native global-capture registration/error feedback, import review/drop handling on
  both the explorer and vault rail, and
  opt-in sync interval with local-only warning. Capture now remembers its folder, selects a registered
  vault, and temporarily makes the review window always-on-top. Corrupt owned `.denote` JSON stores and
  `meta.json` are quarantined before rebuilding; importer review can use the local embedding backend.
- 2026-07-13 · verification · **447 TypeScript tests / 57 files, lint, `tsc --noEmit`, production
  build, Playwright e2e 2/2, Rust `cargo test` 18/18, Swift sidecar build, hash reference suite,
  and `git diff --check` are green.** Browser visual inspection through the in-app browser was
  blocked by the current browser security policy for the local dev URL; owner should still run the
  real Tauri/Safari acceptance scripts in `docs/ACCEPTANCE.md`.
- Remaining explicit scope reductions: OAuth repo creation is post-1.0; capture fallback preserves
  text clipboard data only; a real Tauri-driver harness and owner manual acceptance remain outstanding.

- 2026-07-13 · final bounded UI/AI audit · **several concrete defects fixed and logged.** Narrow
  graph labels now fit inside the viewport, and sparse-note guidance lives in its own layout strip
  instead of covering nodes; toolbar copy distinguishes selecting hubs from opening notes. Custom
  theme changes now clear stale inline tokens and short palettes fill every graph hull slot.
  Suggestion badges use human backend names, Organize vault clears stale results/errors on close,
  and context-menu “New folder…” uses an in-app dialog with inline errors instead of a browser
  prompt. Removed the dead Deep organize routing select and fixed Cloud key refresh to use an
  effect. **Verification:** 455 TypeScript tests / 58 files, focused theme/graph tests 8/8, lint,
  `tsc --noEmit`, production build, Playwright e2e 6/6, S1 hash reference, and `git diff --check`
  green. Desktop/mobile screenshots were inspected at 1280x720 and 390x844; native screenshot
  capture remains unavailable in this headless session, and Apple Foundation Models remains
  unavailable on this Mac (reported in-app).

- 2026-07-13 · interaction polish + AI recovery audit · **remaining browser-native interruptions
  removed.** Invalid theme imports now report inline; first GitHub push visibility is confirmed in
  an in-app dialog naming PRIVATE / PUBLIC / UNKNOWN before upload; topic rename/delete use an
  in-app, keyboard-friendly dialog with validation instead of `prompt` / `confirm`; and the AI
  suggestions panel exposes a direct Retry on-device AI action when Apple is unavailable. The
  retry affordance is hidden when the user has deliberately selected the test backend. **Verification:**
  455 TypeScript tests / 58 files, focused 10/10, lint, `tsc --noEmit`, production build,
  Playwright e2e 6/6, S1 hash reference, `git diff --check`, zero browser alert/prompt/confirm
  calls in `src`, and live graph preview with zero console errors. Apple Foundation Models is
  still unavailable on this Mac and remains reported honestly; native owner acceptance remains
  the outstanding external check.

- 2026-07-13 · focused visual + native shell audit · **three visible interaction defects fixed.**
  Empty-layer graph guidance now occupies normal layout flow and cannot cover graph nodes; the
  vault-rail import result is a readable, dismissible status message instead of an unexplained
  `i` button; and mobile explorer/details controls announce their current open/closed action.
  Added a Playwright geometry assertion that graph guidance ends before the canvas begins.
  **Verification:** 455 TypeScript tests / 58 files, Playwright e2e 6/6, lint, `tsc --noEmit`,
  production build, Rust library tests 19/19, Swift sidecar rebuild, native Tauri dev boot,
  S1 hash reference, and `git diff --check` green. Apple Foundation Models remains unavailable
  on this Mac and is reported honestly; native screenshot/owner acceptance is still external.

## Post-1.0 candidates

Condition 1's e2e smoke suite landed 2026-07-13; remaining pre-1.0 sign-off is owner manual
ACCEPTANCE scripts. Deferred beyond 1.0: plugins, mobile, publishing, canvas (D22); GitHub repo creation via OAuth device flow;
settings routing persistence + per-task cloud model picker; rich-clipboard preservation in
capture fallback; market-data enrichment for insights; cached on-device summary store
(replaces the corpus body-head proxy); Sigma/WebGL renderer swap if vaults outgrow canvas.
