# UX Amendments — graph comprehension + remaining UI/UX gaps

**Status:** open · **Author:** owner findings (Kevin) triaged against verified code, 2026-07-13
**Executor:** any implementation agent (written to be run without asking questions)

---

## How to execute this document

1. Read `CLAUDE.md`, then `docs/DECISIONS.md` and `docs/SPECS.md`. They are binding and
   outrank this document wherever they overlap (D31).
2. Work the problems in priority order (P1 → P3). Each problem states verified current
   behavior (with file references), what SHOULD be the case, what must NOT be done, and an
   acceptance check.
3. Copy/labels given in this document are exact — use them verbatim unless they collide with
   something at implementation time (then log the deviation in `docs/PROGRESS.md`).
4. Before marking done, ALL of: `pnpm test` · `pnpm lint` · `npx tsc --noEmit` ·
   `pnpm build` · `pnpm e2e` · `node docs/reference/hash_spec_test.mjs` — all green.
   Log the work + deviations in `docs/PROGRESS.md` and commit.

### Global constraints (violating any of these is an automatic fail)

- **Never create note↔note edges to make the graph "look connected."** Edges come only from:
  parsed `[[wikilinks]]`, shared tags via tag HUB nodes, topic membership via topic HUB
  nodes, and the capped ai-similar pipeline. "Connect notes that share a tag directly" is
  O(n²) and is explicitly forbidden (D6 — CLAUDE.md known trap #5). The correct response to
  a sparse graph is *explaining* it and making link-creation easy, not fabricating edges.
- No new dependencies without a `docs/DECISIONS.md` entry (D1/D16/D19/D24).
- `src/domain/` stays pure (no React/Tauri/services imports — lint enforces it).
- Any new hotkey-able action goes through the ONE keymap registry
  (`src/app/keymap.ts`, S21); buttons dispatch via `appKeymap.invoke(id)` so click and
  shortcut can never drift apart (see `src/features/explorer/ExplorerPanel.tsx` for the
  pattern).
- Never persist derived graph data (D3/D5). Never store backlinks.
- All vault file writes route through the Repository write API (D23), never raw fs.

### Already fixed on 2026-07-13 — do NOT redo (see PROGRESS.md owner-findings section)

Note clicks always reveal the editor; right panel renamed Links in / Links out / AI with
plain-English headers/empty states; "✕ Close graph" button + click hint in the graph toolbar;
Settings gear on the vault rail; FileTree right-click menu (Open/Rename/Move/Delete);
"Worth revisiting" cards in Today view; explorer toolbar buttons (Today / Quick switcher /
Command palette); Reading-view↔Edit toggle buttons; "Organize vault…" button in graph
toolbar; "Deep organize…" button in Settings→Cloud; vault-rail "+" double-click removed.

---

## The core misunderstanding this document fixes

The owner opened "Local graph" and asked: *"why doesn't it show all the notes? what's the
point of drawing connections if not all my notes live on the same graph?"*

Both graph modes were behaving as designed; **the design was communicated nowhere**:

- **Full graph** (⌘G / toolbar icon) contains EVERY note in the vault (orphans included, as
  dots). It never lost anything.
- **"Local graph"** (button in the editor) deliberately filters to notes within 2 links of
  the open note — a focus mode. Nothing on screen says "you are looking at a filtered
  subset," so it reads as data loss.
- Lines appear only where a real relationship exists: a typed `[[link]]`, a shared tag
  (through a tag hub node), a topic (through a topic hub node, after Organize Vault /
  enrichment), or an AI-similar match. A vault with few typed links and no organize run yet
  is CORRECTLY sparse — but the UI must say so and offer the next step, instead of
  presenting an unexplained "mess."

Every P1 item below turns one of those silent facts into something the UI states plainly.

---

## P1 — Graph comprehension (the "mess" complaints)

### P1.1 Local view announces nothing — looks like the graph lost notes

- **Current (verified):** `src/features/graph/GraphPage.tsx:109-113` filters to
  `localNeighborhood(fullGraph, centerId, hops)` when `localView.enabled`. The ONLY
  indicators are the editor button that got you here (`Editor.tsx`, "Local graph") and a
  toolbar button labeled `Exit local view (2-hop)`
  (`src/features/graph/LayerControls.tsx:100-108`). No banner states you're in a filtered
  view, whose neighborhood it is, or how many notes are hidden.
- **Should be:** while local view is active, a clearly visible banner at the top of the
  graph canvas (same overlay pattern as the existing `emptyHint` at
  `GraphPage.tsx:177-188`, but NOT pointer-events-none — it holds a button):
  - Text: `Showing only notes linked within 2 steps of “<note title>” — N of M notes
    visible.` (Resolve the center node's title from the graph; N = visible note-node
    count, M = full-graph note-node count.)
  - A button inside the banner: `Show all notes` → `graphStore.exitLocalView()`.
- **Should also be:** rename the toolbar exit button label from `Exit local view (2-hop)`
  to `Show all notes`; rename the editor button from `Local graph` to `Graph: this note`
  with tooltip `See what this note is connected to (shows notes up to 2 links away)`.
- **Must NOT:** remove local view or change the hop logic — the filter itself is correct
  and useful; only its communication is broken.
- **Accept when:** entering local view from a note shows the banner with correct title and
  counts; `Show all notes` (either location) exits to the full graph; plain-click
  navigation out of the graph still exits cleanly.

### P1.2 Sparse/unorganized graphs present as an unexplained mess

- **Current (verified):** `GraphPage.tsx` shows a hint ONLY when the visible graph has
  0 edges (all-layers-off or filters). A vault with SOME links still renders many
  unconnected anonymous dots with no explanation and no suggested next action. Topic
  clustering (the default color view) shows nothing meaningful until enrichment/Organize
  Vault has produced topics.
- **Should be:** one additional dismissible overlay hint (same visual language as the
  existing hints, plus an `×`), shown when BOTH: the visible graph has ≥1 note, AND more
  than half of visible note nodes have zero visible edges. Text:
  `Dots without lines are notes nothing links to yet. Connect notes by typing [[ inside
  them — or click “Organize vault…” above to let the on-device AI group them into topics.`
  Dismissal is per-session only (plain `useState`, NOT persisted — it should return next
  launch until the vault genuinely has structure).
- **Must NOT:** auto-run Organize Vault; fabricate edges (global constraint); persist the
  dismissal to localStorage.
- **Accept when:** a fresh vault of ≥2 unlinked notes shows the hint in the full graph;
  dismissing hides it for the session; a well-linked vault (>50% of notes with edges) never
  shows it; the existing 0-edge hints still appear in their cases.

### P1.3 Labels vanish on medium-sized graphs → anonymous dots

- **Current (verified):** `ForceGraphRenderer.tsx` gates labels:
  `labelScaleGate = positioned.length < 100 ? 0.3 : 2.2` — at 100+ nodes, labels appear
  only at deep zoom (a hairball guard; the cliff at exactly 100 is the problem).
- **Should be:** (a) the hovered node and the selected node ALWAYS render their label at
  any zoom and any graph size; (b) soften the cliff: `< 100 → 0.3`, `100–299 → 1.2`,
  `≥ 300 → 2.2`.
- **Must NOT:** render all labels unconditionally on large graphs (the original guard
  exists for a reason — canvas text is the first thing to kill frame rate).
- **Accept when:** on a 150-node graph at default fit zoom, hovering any dot shows its
  title; clicking keeps it visible; zooming in past the gate shows the rest.

### P1.4 Layer/filter jargon (the toolbar reads as internals)

- **Current (verified):** `LayerControls.tsx` labels: `Wikilinks` / `Tags` / `Topics` /
  `AI-similar`, `AI confidence ≥ 0.40`, `Structural hulls`.
- **Should be (exact copy, checkbox order unchanged):**
  - `Wikilinks` → `Links you typed` — tooltip `[[links]] written inside notes`
  - `Tags` → `Shared tags` — tooltip `Notes that use the same #tag connect through it`
  - `Topics` → `AI topic groups` — tooltip `Topics found by Organize vault`
  - `AI-similar` → `AI-found similarity` — tooltip `Pairs the on-device AI judged related —
    each edge shows its reason in the side panel`
  - `AI confidence ≥ X` → `Hide AI guesses below X% sure` (render the value as a percent)
  - `Structural hulls` → `Outline folders` — tooltip `Draw a shaded outline around each
    folder's notes`
- **Must NOT:** rename the underlying `LayerToggles` keys / graphStore fields (persisted in
  localStorage; renaming silently resets users' saved settings) — labels only.
- **Accept when:** toolbar shows the new copy; existing persisted toggle state still loads;
  `tests/` referencing layer labels (if any) updated.

### P1.5 Nothing invites the first link

- **Current (verified):** the graph can only *display* structure; the app never teaches the
  ONE action that creates it (typing `[[`). The Links-out empty state (added 2026-07-13)
  mentions it, but only if the user opens that tab.
- **Should be:** in `NodeInspector.tsx`, when the selected note node has zero connections in
  the UNFILTERED graph, show under the (empty) connections list:
  `This note isn't connected to anything yet. Open it and type [[ to link it to another
  note.` plus an `Open note` button (the inspector already navigates on connection clicks —
  reuse that handler for the button).
- **Accept when:** selecting an orphan dot shows the text + working button; selecting a
  connected note shows the normal connections list.

---

## P2 — Features that exist but are effectively hidden or cryptic

### P2.1 Note version history is buried inside Settings

- **Current (verified):** the full per-note timeline (snapshots + git commits, diff preview,
  non-destructive restore) renders ONLY inside Settings → Data as "Active note history"
  (`src/features/settings/SettingsModal.tsx:1159-1166`, `VersionTimeline` at `:1177`).
  Nobody will find a note's history inside app Settings.
- **Should be:** add `History…` to the FileTree right-click context menu
  (`src/features/explorer/FileTree.tsx`, between `Rename…` and `Move to folder…`). It opens
  a plain modal (reuse the app's existing Radix Dialog pattern) titled with the note name,
  containing the SAME `VersionTimeline` component — extract `VersionTimeline` (and its
  `VersionEntry` type + helpers) out of `SettingsModal.tsx` into
  `src/features/history/VersionTimeline.tsx` and import it from both places. Settings keeps
  its section (it's the whole-vault history/enable-git home); the context menu becomes the
  per-note entry point.
- **Must NOT:** duplicate the timeline implementation; change restore semantics
  (`Repository.restoreNoteVersion` runs the normal pipeline exactly once — leave it).
- **Accept when:** right-click → History… on a note with edits shows its timeline; restore
  works and the note updates; Settings → Data section unchanged in behavior.

### P2.2 No way to create a folder

- **Current (verified):** zero folder-creation affordances (`grep createDir
  src/features/explorer/` → nothing). Combined with Move-to-folder listing only EXISTING
  folders, users can never organize into a new folder from the app.
- **Should be:** (a) a `New folder` icon button in the explorer toolbar
  (`ExplorerPanel.tsx`) that shows an inline name input (same visual pattern as note
  rename) and creates the folder inside the currently selected folder (`uiStore
  selectedFolder`, root when none); (b) in the context menu's `Move to folder…` list, a
  final entry `New folder…` that asks for a name, creates it, then moves the note there.
- **Implementation note:** `StorageBackend.createDir` exists; `Repository` has no folder
  wrapper — add `Repository.createFolder(relDir)` routing through the backend with a
  containment-safe relative path, and check S8: bare-directory watcher events must not
  trigger the note pipeline (directories aren't notes; verify the watcher path ignores
  dir-only events, and note the finding in PROGRESS.md either way). Empty dirs won't show
  in a tree built only from files — extend `buildTree`/`FileTree` to also list known empty
  folders (simplest: keep a session-level "just created" folder list in the FileTree
  component until a note lands in it; do NOT persist it — the fs stays the only truth).
- **Must NOT:** write any placeholder file (e.g. `.keep`) into the vault to make a folder
  visible — vaults contain only user content.
- **Accept when:** create folder → appears in tree immediately → New note (with it
  selected) lands inside it → move a note into it via the context menu; restart: folder
  persists iff it has content (document this limitation in the PROGRESS entry).

### P2.3 Status-bar "orphans · ghosts" chip is insider vocabulary

- **Current (verified):** `src/app/StatusBar.tsx:70` renders `{n} orphans · {m} ghosts`;
  the popover lists paths under headers `Unlinked notes` / (ghosts list).
- **Should be:** chip text → `{n} unlinked · {m} missing`; popover headers →
  `Notes nothing links to ({n})` and `Links to notes that don't exist yet ({m})`; add one
  muted line under each header: `Link to them from another note, or delete them.` /
  `Click one to create that note.` Popover rows should be clickable: unlinked → opens the
  note; missing → creates-and-opens it via the existing `createGhostAndOpen`.
- **Accept when:** chip + popover show new copy; clicking rows navigates/creates.

### P2.4 Remaining jargon sweep (small copy fixes, one pass)

Apply exactly; these are all label/tooltip-only:

| Where (verified) | Current | Change to |
|---|---|---|
| `Editor.tsx` button | `Local graph` | `Graph: this note` (tooltip per P1.1) |
| `LayerControls.tsx` button | `Exit local view (2-hop)` | `Show all notes` (P1.1) |
| `LayerControls.tsx` | `Reset view` tooltip `Restore all edge layers and a low confidence floor` | tooltip `Turn all connection types back on` |
| `SettingsModal.tsx` AI routing table | task ids like `label-similarity` shown raw | keep ids in code; display labels `Summarize` / `Suggest tags & links` / `Judge similarity` / `Deep organize` |
| `CaptureModal` (if it labels the model picker with raw model ids) | raw id | prefix with `On this Mac: ` / `Cloud: ` as applicable |

- **Must NOT:** change any persisted key, task id, store field, or test fixture string —
  display labels only.
- **Accept when:** grep for the old user-facing strings returns only code identifiers/tests,
  no rendered UI.

---

## P3 — Structural (do last; each is small but crosses more files)

### P3.1 First-run guidance (the app never introduces itself)

- **Current:** a brand-new vault shows the (improved) center empty state and nothing else.
  Every concept (links, graph, AI suggestions) waits to be stumbled on.
- **Should be:** when the active vault has 0 notes, render a small card in the center pane
  (replacing the one-line hint) with three numbered rows:
  1. `Create your first note` — button wired to `appKeymap.invoke('new-note')`
  2. `Type [[ inside a note to link to another one — links are what build your graph`
  3. `Press the graph icon (or ⌘G) once you have a few linked notes`
  It disappears forever once the vault has ≥1 note (derived from the index — no persistence
  needed, no localStorage flag).
- **Must NOT:** modal tours, coach marks, or anything that interrupts typing.
- **Accept when:** new empty vault shows the card; creating one note replaces it with the
  editor; reopening the vault with notes never shows it again.

### P3.2 Move-note discoverability parity (drag-and-drop)

- **Current:** move exists only in the right-click menu (added 2026-07-13). Dragging a note
  onto a folder — the gesture everyone tries first — does nothing.
- **Should be:** HTML5 drag-and-drop in `FileTree.tsx`: note rows draggable; folder rows
  (and the tree's root container) accept drops → `vaultStore.moveNote` (same wrapper the
  menu uses — D4a reconciliation comes free); folder row highlights on drag-over.
- **Must NOT:** implement multi-select drag, reordering, or drag-into-graph; a plain
  single-note move only.
- **Accept when:** dragging a note onto a folder moves it (links intact — S9 path), onto
  the root moves it to vault root, and an aborted drag (Esc / drop elsewhere) does nothing.

---

## Priorities recap

| Priority | Items | Theme |
|---|---|---|
| P1 | 1.1–1.5 | The graph must explain itself (owner's direct complaint) |
| P2 | 2.1–2.4 | Buried features + remaining jargon |
| P3 | 3.1–3.2 | First-run guidance, drag-and-drop parity |

## Manual owner checks after implementation (Tauri app, real vault)

1. Open a note → `Graph: this note` → banner says how many notes are hidden → `Show all
   notes` → full graph with every note present.
2. Fresh test vault with 3 unlinked notes → full graph shows the dismissible "dots without
   lines" hint → type `[[` in one note, link another → line appears, hint logic re-evaluates.
3. Right-click a note → History… → timeline shows → restore an older version → editor
   updates, no duplicate pipeline run (watch for double AI enrichment).
4. Create a folder from the toolbar → move a note into it by right-click AND by drag.
5. Status bar chip: plain-English counts; click an entry in each list.
