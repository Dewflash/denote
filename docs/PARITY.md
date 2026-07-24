# PARITY — DeNote is Obsidian, plus one AI button

**Written 2026-07-20 after owner verdict: "everything fails UAT."** This document is the
binding product definition and change plan. It supersedes the *scope framing* of
RECOVERY.md (R-1's status machinery and R-2's pipeline-fixing survive as internals; R-3 is
absorbed into Phase 2 here; R-4's graph work is partially reversed by Phase 5). Nothing in
`src/domain/`, the Rust core, or the S-numbered algorithms is invalidated — this is a UX
and information-architecture correction, not an engine rewrite. The engines were built
correctly; they were **presented** wrongly.

## 0. The product, in one paragraph (owner's words, normative)

> A 1:1 replica of Obsidian, with one new button: "click to create graph, where AI will
> link the learnings together." New features are welcome ONLY as add-ons that do not
> conflate the core, and they must reflect properly in UX in a manner understandable to
> users.

Operational reading, as three laws every change below follows:

- **LAW 1 — Core-first.** Every Obsidian core behavior in the Part 1 audit must exist and
  behave the way Obsidian behaves, down to default hotkeys, default panel contents, and
  default graph appearance. When DeNote and Obsidian disagree about a core surface,
  DeNote is wrong by definition.
- **LAW 2 — AI is one door.** All AI capability is reached through a single, clearly
  labeled entry point (the ✨ AI button). With that door never opened: zero AI UI is
  visible, zero AI computation runs, zero AI writes occur. A user who never clicks ✨ must
  be unable to tell DeNote apart from Obsidian.
- **LAW 3 — Add-ons are labeled and removable.** Every non-Obsidian feature (capture, git
  sync, AI) lives behind its own labeled surface, is individually disableable in Settings
  (like Obsidian's core-plugin toggles), and never injects UI into a core surface while
  disabled.

Out of scope for parity v1 (explicitly, so "1:1" has a boundary): Obsidian **Canvas**,
**community plugins**, **mobile**, **Publish**, **Obsidian Sync** (git sync remains as the
existing labeled add-on). These stay listed in "Post-1.0 candidates". Everything else in
Part 1 is in scope.

---

## Part 1 — Obsidian core parity audit (feature by feature)

Status legend: ✅ parity today · 🟡 partial · ❌ missing · ⚠️ present but **conflated**
(exists, but shaped un-Obsidian or entangled with AI). Every 🟡/❌/⚠️ row maps to a
numbered change in Part 4.

### 1A. Workspace & shell

| # | Obsidian behavior | DeNote today | Status | Change |
|---|---|---|---|---|
| A1 | **Left ribbon**: vertical icon strip (open graph, new note, quick switcher, daily note, command palette, templates…), vault switcher + settings + help at bottom | `VaultRail` lists vaults only; actions live in an Explorer header toolbar | ⚠️ | P1-1 |
| A2 | **Tab bar**: multiple notes open as tabs; ⌘-click a link/file opens a new tab; ⌘W closes; tab titles show dirty state; drag to reorder | Single open buffer, no tabs at all | ❌ | P1-2 |
| A3 | **Navigation history** per pane: back/forward (⌘⌥←/→) | None | ❌ | P1-3 |
| A4 | **Split panes**: split right/down, drag tab to edge | None | ❌ | P1-4 (flagged optional-for-v1, see Part 6) |
| A5 | **Pin tab** | None | ❌ | P1-2 |
| A6 | **Left sidebar** = tabbed: Files / Search / Bookmarks | Explorer only; Search is a modal overlay | 🟡 | P1-5 |
| A7 | **Right sidebar** = tabbed: Backlinks / Outgoing links / Tags / Outline | Tabs are "Links in / Links out / **AI**" | ⚠️ | P1-6, P0-2 |
| A8 | **Status bar**: backlinks count · word count · character count | Graph-health counts + ⚡AI item | ⚠️ | P1-7, P0-3 |
| A9 | Sidebar collapse toggles both sides | Present (desktop + mobile variants) | ✅ | — |
| A10 | **Window title** shows note name — vault name | Not verified; likely static "DeNote" | 🟡 | P1-8 |

### 1B. File explorer

| # | Obsidian behavior | DeNote today | Status | Change |
|---|---|---|---|---|
| B1 | Right-click context menus: background → New note / New folder; note → New note here, Rename, Delete (to system Trash), Move to…, Make a copy, Reveal in Finder, Bookmark; folder → New note, New folder, Rename, Delete, Move to…, Reveal in Finder | None (R-3 was specified but never executed — no PROGRESS entry, no commit) | ❌ | P2-1 |
| B2 | New note appears **in place with name pre-selected** for typing; Enter commits, Esc cancels; empty → "Untitled" | `createUntitledNote` names it immediately; no inline-edit-on-create | 🟡 | P2-2 |
| B3 | Drag-and-drop notes/folders between folders; links re-resolve | Basic note drag exists (UX-AMENDMENTS P3.2); folders not draggable | 🟡 | P2-3 |
| B4 | Sort options (name A–Z/Z–A, modified, created) via header menu | Fixed folders-then-files alphabetical | ❌ | P2-4 |
| B5 | Collapse-all / expand-all button | None | ❌ | P2-4 |
| B6 | Delete goes to **system Trash**, not permanent unlink | `deleteNote` is a permanent delete (with confirm) | 🟡 | P2-5 |
| B7 | Attachments (images/PDFs) visible in tree, openable | Assets indexed for embeds; tree shows notes+folders only | 🟡 | P2-6 |
| B8 | Explorer shows **files only** — no "Recents"/"Today" blocks inside it | `RecentNotes` + `TodayView` (⌘T) woven into explorer | ⚠️ | P0-4 |
| B9 | ⌘N creates in currently-selected folder | Present (R-3 item done early) | ✅ | — |

### 1C. Editor

| # | Obsidian behavior | DeNote today | Status | Change |
|---|---|---|---|---|
| C1 | Three modes: **Live Preview / Source mode / Reading view**; ⌘E toggles edit↔read; mode is per-tab | Live preview + reading only; no source mode | 🟡 | P3-1 |
| C2 | Headings, bold, italic live-render with cursor-reveal | Present (viewport-incremental, cursor-overlap reveals) | ✅ | — |
| C3 | `[[wikilink]]` + `#tag` decoration, autocomplete on `[[` and `#`, ⌘-click follow, ghost create | Present | ✅ | — |
| C4 | **Task lists**: `- [ ]` renders as a real checkbox; clicking toggles and writes the file (both live preview and reading) | Not rendered, not clickable | ❌ | P3-2 |
| C5 | **Tables** render in live preview + reading | Not rendered (no remark-gfm) | ❌ | P3-3 |
| C6 | ~~strikethrough~~ and ==highlight== render | Not rendered | ❌ | P3-3 |
| C7 | **Callouts** `> [!note] Title` render as styled blocks with fold | Not rendered | ❌ | P3-4 |
| C8 | **Note transclusion**: `![[Note]]`, `![[Note#Heading]]` embed the target's rendered content (recursion-capped) | Only image `![[img.png]]` embeds | ❌ | P3-5 |
| C9 | Heading fold / list fold (chevrons in gutter) | None | ❌ | P3-6 |
| C10 | **Find in note** (⌘F) with highlight-all; find-and-replace (⌘⌥F) | ⌘F is aliased to *global search* — directly contradicts Obsidian | ⚠️ | P3-7, P0-5 |
| C11 | **Properties**: frontmatter renders as a structured key/value editor at the top of the note (Live Preview); raw YAML in source mode; typed fields (text, list, date, checkbox); tags-in-frontmatter recognized | Raw YAML text only | ❌ | P3-8 |
| C12 | Paste/drag an image into a note → saved to attachment folder, `![[…]]` inserted | Paste ≥800 chars triggers an **AI capture modal** — core paste is intercepted by an add-on | ⚠️❌ | P3-9, P0-6 |
| C13 | Footnotes render in reading view | Unknown/absent | 🟡 | P3-3 |
| C14 | External `[label](url)` links render, click opens browser | Present (needs verify in reading+live) | 🟡 | P3-10 |
| C15 | Word/char count of selection in status bar | Absent | ❌ | P1-7 |
| C16 | Undo/redo: typing = editor history; structural ops separate | Present (two-tier, D38) | ✅ | — |

### 1D. Search & navigation

| # | Obsidian behavior | DeNote today | Status | Change |
|---|---|---|---|---|
| D1 | Global search lives in the **left sidebar** (persistent results list), not a modal | Modal overlay (⌘⇧F) | ⚠️ | P1-5 |
| D2 | Operators: `file:`, `path:`, `tag:`, `line:`, `section:`, `/regex/`, `"exact"`, `-negation`, `OR` | `tag:` `folder:` `vault:` `has:ghosts` only | 🟡 | P4-1 |
| D3 | Result context lines with match highlight; expand/collapse; result count | Snippets present in modal | 🟡 | P1-5 |
| D4 | Search settings: match case toggle, explain, copy results | None | 🟡 | P4-1 |
| D5 | **Quick switcher** (⌘O): fuzzy titles, creates note if no match ("↵ to create") | Fuzzy jump present; no create-if-missing | 🟡 | P4-2 |
| D6 | **Command palette** (⌘P) with every command + its hotkey shown | Present | ✅ | — |
| D7 | Hotkey editor in Settings (every command rebindable, conflicts flagged) | Present (S21 registry + editable UI) | ✅ | — |

### 1E. Links & metadata panels

| # | Obsidian behavior | DeNote today | Status | Change |
|---|---|---|---|---|
| E1 | Backlinks panel: **Linked mentions** with context snippet per mention, grouped by note | Flat list, no context snippets | 🟡 | P4-3 |
| E2 | **Unlinked mentions**: plain-text occurrences of the note's name, each with a "Link" button that splices `[[…]]` | Absent | ❌ | P4-4 |
| E3 | Outgoing links panel incl. unresolved (ghost) section | Present (verify ghost grouping) | 🟡 | P4-3 |
| E4 | **Tags pane**: all vault tags with counts, nested tag tree, click → search | Absent | ❌ | P4-5 |
| E5 | **Outline pane**: heading tree of active note, click scrolls | Absent | ❌ | P4-6 |
| E6 | **Bookmarks**: star notes/searches/graphs, listed in left sidebar | Absent | ❌ | P4-7 |

### 1F. Graph

| # | Obsidian behavior | DeNote today | Status | Change |
|---|---|---|---|---|
| F1 | Default graph shows **notes + their real links**, neutral single-color dots, physics layout. Nothing semantic. | Default is **AI topic-colored semantic clustering** with hulls, layer checkboxes (Topics/AI-similar), confidence slider — an AI product face on a core surface | ⚠️ | P5-1, P0-1 |
| F2 | Collapsible control card: **Filters** (search query incl. `tag:`/`path:`, Tags on/off, Attachments, Existing-files-only, Orphans on/off) | Layer checkboxes only, different vocabulary | 🟡 | P5-2 |
| F3 | **Groups**: query → color assignments, user-defined | Absent (topic colors are not user groups) | ❌ | P5-3 |
| F4 | **Display** sliders: arrows, text fade threshold, node size, link thickness | Fixed | ❌ | P5-4 |
| F5 | **Forces** sliders: center force, repel, link force, link distance | Fixed | ❌ | P5-4 |
| F6 | **Local graph** (per-note, depth slider) | Present (hop-count local view) | 🟡 | P5-5 |
| F7 | Hover highlights a node's neighborhood, fades the rest | Absent (has dim-orphans instead) | ❌ | P5-6 |
| F8 | Graph settings persist per vault | localStorage global | 🟡 | P5-2 |

### 1G. Core-plugin features (on by default in Obsidian)

| # | Obsidian behavior | DeNote today | Status | Change |
|---|---|---|---|---|
| G1 | **Daily notes**: ribbon button + command "Open today's daily note"; configurable folder/format/template | `TodayView` is a *list of recently edited notes* — a different feature wearing a similar name | ⚠️ | P6-1, P0-4 |
| G2 | **Templates**: template folder; "Insert template" command; `{{date}}`/`{{title}}` vars | Absent | ❌ | P6-2 |
| G3 | **File recovery** snapshots | Present (`.denote/snapshots` + VersionTimeline) — parity ✅, better than Obsidian's | ✅ | — |
| G4 | **Note composer** (merge/split/refactor) | Absent | ❌ | P6-3 (optional-for-v1) |
| G5 | Settings organized like Obsidian: Editor / Files & Links / Appearance / Hotkeys / Core plugins / (add-ons) | Single modal, different taxonomy | 🟡 | P6-4 |
| G6 | Themes + CSS snippets | Present | ✅ | — |

### 1H. Already-better-than-Obsidian (keep, but relabel as add-ons per LAW 3)

Multi-vault simultaneous open + combined graph · git-backed history/sync · global capture
(⌘⇧N) · import dedupe · local AI stack (the product's reason to exist) · deterministic
graph layout. None of these are cut. All of them get LAW-3 treatment: their UI appears
only on their own surfaces, each has a Settings toggle, and capture/AI never intercept a
core interaction.

---

## Part 2 — De-conflation map (every AI/non-Obsidian surface → its one new home)

The single biggest UAT failure is not a missing feature — it's that AI is woven through
five core surfaces. This map is exhaustive; anything AI-visible not listed here is a bug.

| Today (conflated) | After (LAW 2) |
|---|---|
| Graph defaults to topic clustering, AI-similar edges, confidence slider, `Organize vault…` toolbar button, "Check AI status" buttons in hints | Graph defaults to **Obsidian appearance** (P5-1). ALL of it returns only inside **AI mode** (P7), entered via the ✨ button |
| RightPanel third tab "AI" (SuggestionsPanel) | Moves into the **AI panel** opened from the ✨ ribbon button (P7-4). Right sidebar = Backlinks/Outgoing/Tags/Outline only |
| `AiProvisionalBar` strip inside the editor | Only rendered when AI is enabled AND the note has provisional data; styled as a dismissible add-on banner (P7-6) |
| Ambient enrichment: every save auto-enqueues AI work | **Default OFF.** AI runs only from explicit ✨ actions. "Keep AI links updated automatically" becomes an opt-in toggle shown *after* the first successful run (P7-5) |
| ⚡ AI StatusBar item (R-1 panel) | Machinery kept verbatim; the status item renders **only once AI has been enabled** for any open vault (P7-7). Before that: invisible |
| `OrganizeVaultModal` / `DeepOrganizeModal` in command palette | Reached from inside the AI panel; palette entries prefixed "AI:" and hidden until AI enabled (P7-4) |
| Paste ≥800 chars → AI capture modal | Plain paste is **always** plain paste (P0-6). Capture-with-AI-summary happens only via ⌘⇧N / the capture surface |
| `TodayView` (⌘T) + `RecentNotes` in explorer | Deleted from explorer. Recents live in the quick switcher (Obsidian behavior); ⌘T freed (P0-4). Daily-notes parity feature replaces the "today" concept (P6-1) |
| ⌘F → global search | ⌘F = find in note; ⌘⌥F = replace; ⌘⇧F stays global (P0-5) |
| StatusBar graph-health counts ("unlinked · missing") | Unlinked count moves into graph AI mode; missing-links count becomes the ghost section of Outgoing links (P1-7) |
| `GraphNotesIndex` ("Notes in map" search) | Keep — harmless additive; relocate into the graph Filters card so it reads as one control surface (P5-2) |

---

## Part 3 — Target information architecture

### 3.1 The shell (exact layout)

```
┌──┬─────────────┬──────────────────────────────┬─────────────┐
│R │ LEFT SIDEBAR │  TAB BAR                     │ RIGHT SIDEBAR│
│I │ [Files]      │  ┌────┬────┬────┐            │ [Backlinks]  │
│B │ [Search]     │  │tab1│tab2│ +  │            │ [Outgoing]   │
│B │ [Bookmarks]  │  ├────┴────┴────┴──────────┐ │ [Tags]       │
│O │              │  │                          │ │ [Outline]    │
│N │  file tree   │  │   editor / reading view  │ │              │
│  │              │  │   (or graph, as a tab)   │ │  panel body  │
│  │              │  │                          │ │              │
├──┴─────────────┴──┴──────────────────────────┴─┴─────────────┤
│ STATUS BAR: backlinks · words · chars            [⚡AI if on] │
└──────────────────────────────────────────────────────────────┘
```

- **Ribbon** (top→bottom): Open graph (⌘G) · New note (⌘N) · Quick switcher (⌘O) ·
  Open today's daily note · Insert template · Capture (add-on, ⌘⇧N) · **✨ AI** (the
  button — see 3.3) · …spacer… · vault switcher (replaces VaultRail; current vault's
  accent dot, click = vault menu) · Settings (⌘,) .
- **Graph is a tab**, not a center-pane takeover: ⌘G opens (or focuses) a "Graph" tab.
  This kills the entire class of "clicked a note and nothing visibly happened" bugs
  permanently, matches Obsidian, and makes local-graph-in-right-pane possible later.
- The mobile/responsive variants keep their current toggle pattern, re-skinned to the
  same structure.

### 3.2 Keymap after re-mapping (load-bearing subset; all rebindable, S21 unchanged)

| Combo | Action (Obsidian default) |
|---|---|
| ⌘N | New note (in selected folder) |
| ⌘O | Quick switcher |
| ⌘P | Command palette |
| ⌘E | Toggle edit/reading |
| ⌘F / ⌘⌥F | Find in note / replace in note |
| ⌘⇧F | Global search (focus left-sidebar search tab) |
| ⌘G | Graph tab |
| ⌘, | Settings |
| ⌘T / ⌘W | New tab / close tab |
| ⌘⌥← → | Navigate back / forward |
| ⌘⇧N | Global capture (add-on; keep — no Obsidian conflict) |
| ⌘T (old Today view) | REMOVED — freed for new-tab |

### 3.3 The ✨ AI button (the one new thing, specified completely)

**Placement:** one ✨ icon on the ribbon, plus one identical ✨ button in the graph tab's
toolbar labeled **"Link my notes with AI."** Both open the same surface. Nowhere else.

**State machine (per vault, persisted in `.denote/ai/engagement.json`):**

1. `never-engaged` (fresh default) — no AI UI anywhere except the ✨ buttons themselves.
   No engine constructed, no queue, no sidecar spawn, no embedding download, no watcher
   AI hooks. (Today all of that boots eagerly per vault — P7-1 makes construction lazy.)
2. Click ✨ → **engage sheet** (plain English): what will happen ("DeNote will read your
   notes on this Mac using Apple Intelligence — nothing leaves your computer"), what it
   produces (suggested links/topics drawn on the graph, suggestions you can accept),
   one-time model download size if not cached, note count, and two buttons:
   **"Create my AI graph"** / Cancel. This replaces the S28 consent modal for the bulk
   path (same gate, better clothes; S28's >20-notes rule is satisfied by construction
   since this IS the explicit consent).
3. `running` — full-vault sweep (R-2's one-time hash-gated sweep): embed → enrich →
   similarity → topics, with a real progress bar (n/N notes, current stage), cancellable,
   resumable (queue already persists). Failures surface verbatim here (R-1 machinery).
4. `ready` — the graph's **AI layer** switches on (P7-3): ai-similar edges (dashed, hover
   = reason + confidence), topic hub nodes, optional topic coloring — rendered ONLY when
   the graph toolbar's "AI links" toggle (now visible) is on. The AI panel (P7-4) becomes
   available. StatusBar ⚡ appears. A "Last linked: <time> · Update" affordance re-runs
   incrementally (hash-gated = cheap no-op when nothing changed).
5. `stale` — notes changed since last run and auto-update is off → the ✨ button and the
   "AI links" toggle show a small dot; clicking offers "Update AI links (N notes)".

**What never changes regardless of state:** AI never writes note bodies; accepting a
suggestion writes exactly one wikilink/tag/frontmatter entry (existing pipeline);
`ai:`-frontmatter takeover stays governed by S10/S23 and now additionally requires
engagement ≥ `ready` AND the auto-update toggle ON.

---

## Part 4 — The change list (numbered, phased, meticulous)

Conventions: each item lists **Do** (behavior spec), **Where** (files/modules), **Spec
impact** (D/S ledger entries to append — numbers assigned at execution time, ledger is
append-only), **Accept** (owner-verifiable). Engines/domain are reused everywhere;
"new" code is UI/wiring unless stated.

### Phase 0 — De-conflation (small diffs, biggest perceived fix; do first)

- **P0-1 · Obsidian-default graph.** Default render: note dots (single neutral color,
  `--graph-node` token), wikilink/embed edges, tag hubs ON (Obsidian shows tags when
  enabled — default on there; keep on), NO topic coloring, NO hulls, NO ai-similar, NO
  confidence slider, NO Organize button. Existing AI rendering code is kept but gated on
  `aiLayerVisible` (false until Phase 7). *Where:* `GraphPage.tsx`, `LayerControls.tsx`,
  `graphStore.ts` defaults, `ForceGraphRenderer.tsx` (color path). *Spec:* new D-entry
  "graph default = parser layers only; AI layers render only under engagement" (amends
  D26's presentation, not its data flow). *Accept:* fresh vault with links → ⌘G looks
  like Obsidian's graph; no AI vocabulary visible anywhere on it.
- **P0-2 · Remove the AI tab from RightPanel.** Panel tabs become Backlinks / Outgoing
  (Tags/Outline arrive in P4-5/P4-6). `SuggestionsPanel` is not deleted — it re-homes in
  P7-4. *Where:* `RightPanel.tsx`. *Accept:* right sidebar contains no AI surface.
- **P0-3 · Silence the ⚡ StatusBar item and graph-health counts** behind the engagement
  flag (temporarily: behind a constant `false` until P7-7 lands the flag). *Where:*
  `StatusBar.tsx`, `graphHealth.ts` call sites. *Accept:* status bar shows nothing
  AI-related on a fresh vault.
- **P0-4 · Delete TodayView + RecentNotes from the explorer; free ⌘T.** Remove the
  `today-view` binding and `todayViewOpen` state; explorer renders the tree only.
  (Recents are already in the quick switcher's empty state — verify, else add in P4-2.)
  *Where:* `ExplorerPanel.tsx`, `TodayView.tsx`/`RecentNotes.tsx` (delete),
  `keymap.ts`, `uiStore.ts`. *Spec:* D-entry (removes a shipped surface). *Accept:*
  explorer = files only, like Obsidian.
- **P0-5 · ⌘F = find-in-note.** Wire CodeMirror's `search` extension (openSearchPanel,
  highlightSelectionMatches, ⌘⌥F replace) styled to tokens; ⌘⇧F remains global search;
  delete the `search-alias` binding. Reading view: ⌘F does browser-style find within the
  rendered note (simple mark-based). *Where:* `Editor.tsx` extensions, `keymap.ts`.
  *Accept:* ⌘F in a note behaves like Obsidian's find bar.
- **P0-6 · Plain paste is plain paste.** Remove the ≥800-char capture interception from
  the editor path entirely; `pasteCapture` logic remains reachable only from the capture
  surface (⌘⇧N / ribbon). *Where:* `features/capture/pasteCapture.ts` wiring in editor.
  *Accept:* pasting a 5-page article into a note just pastes it.
- **P0-7 · Kill ambient AI on open.** Vault open must not construct engines, spawn the
  sidecar, hit hf-hub cache probes, or enqueue enrichment. Extract engine construction
  into `ensureAiEngaged(vaultId)` called only by the ✨ flow (P7-1). Watcher AI hooks
  register only then. *Where:* `vaultStore.ts` (open path), `vaultAiEngine.ts`,
  `vaultEmbeddings.ts`, `vaultOntologyEngine.ts` wiring. *Spec:* D-entry "AI is lazy and
  engagement-gated" (interacts with S12/S28 — queue semantics unchanged once engaged).
  *Accept:* Activity Monitor shows no sidecar process and no model download after opening
  a vault and editing for 10 minutes without touching ✨.

### Phase 1 — Workspace parity (the structural one; tabs are the keystone)

- **P1-1 · Ribbon.** New `app/Ribbon.tsx` per 3.1; absorbs VaultRail's vault list into a
  bottom vault-switcher menu; Explorer header toolbar shrinks to explorer-local actions
  (new note/folder, sort, collapse-all — P2-4). *Accept:* side-by-side with Obsidian, the
  left edge reads the same.
- **P1-2 · Tabs (multi-buffer).** The load-bearing structural change. `vaultStore`'s
  single `buffer` becomes: `buffers: Map<relPath, NoteBuffer>` (content, dirty, savedHash,
  conflict state) + `tabs: TabState[]` (`{id, relPath, viewMode, pinned}`) + `activeTabId`
  + per-tab CM `EditorState` retention (so switching tabs preserves cursor/scroll/undo).
  Rules: one buffer per relPath regardless of how many tabs show it; autosave (800 ms)
  and force-flush-on-switch move from "on note change" to per-buffer; S23 conflict bar
  renders in the tab owning the conflicted buffer; dirty-buffer AI deferral (S23) checks
  the buffers map (it currently checks the single buffer — same semantics, wider map);
  rename/move rekeys buffer+tab keys via the existing rekey hook; ⌘-click on any note
  affordance (tree, links panels, search, switcher, graph node) opens a background tab,
  plain click reuses the active tab (Obsidian's default). Graph and Daily-note open as
  tabs too (`tab.kind: 'note' | 'graph'`). *Where:* `vaultStore.ts` (major),
  `App.tsx` CenterPane → `TabBar.tsx` + `PaneView.tsx`, `Editor.tsx` (instance per tab).
  *Spec:* new D-entry (multi-buffer model) + S23 amendment (conflict/deferral phrased
  over the buffer map). Integration tests: dirty-tab switch preserves content; conflict
  in background tab doesn't hijack foreground; two tabs same note share one buffer.
  *Accept:* open 5 notes in tabs, edit 3, switch freely, quit-relaunch → tabs restored
  (persist tab list in uiStore), nothing lost.
- **P1-3 · Per-tab history.** Push relPath on navigate; ⌘⌥←/→ traverse; ribbon has no
  back button (Obsidian puts them in the tab header — add small ‹ › in the tab bar).
  *Where:* tab state. *Accept:* follow 3 links, ⌘⌥← thrice returns.
- **P1-4 · Split panes (OPTIONAL for v1 — owner call, see Part 6).** If in: a single
  vertical split (two tab groups) covers 90% of real usage; full recursive splits are
  post-1.0. *Where:* layout of P1-2's tab groups.
- **P1-5 · Left sidebar tabs: Files / Search / Bookmarks.** Search moves from modal into
  a persistent sidebar pane (same `NoteSearchIndex`, same query parser; results keep
  highlight snippets, add expand/collapse + count). ⌘⇧F focuses it. Bookmarks pane from
  P4-7. *Where:* new `app/LeftSidebar.tsx`, `SearchPanel.tsx` re-homed. *Accept:* search
  results stay visible while clicking through them (the modal's biggest parity failure).
- **P1-6 · Right sidebar tabs: Backlinks / Outgoing / Tags / Outline** (bodies in P4).
- **P1-7 · Status bar parity:** `N backlinks · W words · C characters` for the active
  note (selection-aware word count when a selection exists). Graph-health counts removed
  (see de-conflation map). *Where:* `StatusBar.tsx` + a small pure `wordCount.ts`
  (domain, tested: CJK-aware counting like Obsidian's). *Accept:* matches Obsidian's
  status bar on the same note.
- **P1-8 · Window title** = `{noteTitle} — {vaultName}`; dirty marker on macOS close
  button via Tauri `set_title`/documentEdited. *Where:* small Tauri command + effect.

### Phase 2 — File-explorer parity (absorbs RECOVERY R-3 verbatim, plus)

- **P2-1 · Context menus** exactly per audit B1. "Move to…" opens a folder-picker
  popover (fuzzy over vault folders) → `moveNote`. "Reveal in Finder" via Tauri opener
  (path must pass containment first). "Make a copy" → `Note 1.md` sibling through the
  repository. *Where:* `FileTree.tsx` + a `ContextMenu` primitive (Radix). *Spec:*
  D-entry for the `trash` behavior (P2-5) only; the rest is R-3's already-specified UX.
- **P2-2 · Inline create:** new note/folder appears in-tree with an editable name field
  pre-focused, Enter/blur commits (rename-refactor machinery NOT needed — the note is
  created only on commit, so no links exist yet), Esc cancels, empty → "Untitled n".
- **P2-3 · Folder drag** + note drag polish (drop targets highlight; drop = `moveNote`
  per file; folder drop = recursive move through repository rename, one op-log unit).
- **P2-4 · Sort menu + collapse-all** in explorer header. Sort is a per-vault uiStore
  pref; tree function takes a comparator (pure, tested).
- **P2-5 · Delete → system Trash.** Rust: replace/augment `delete_path` with
  `trash_path` (macOS `NSFileManager.trashItem` via the `trash` crate), same containment
  door. Watcher sees it as an external delete → normal pipeline. Op-log entry's inverse
  = restore from Trash is NOT feasible reliably → deletion is excluded from undo (toast
  "Moved to Trash" with no undo, like Obsidian). *Spec:* D-entry + S22 note (new
  command through the same `contained_path`).
- **P2-6 · Attachments in tree** (images/PDFs listed, click opens read-only viewer tab
  for images / OS-open for PDFs), plus Settings → Files & Links: "Default location for
  new attachments" (folder pref used by P3-9).

### Phase 3 — Editor parity

- **P3-1 · Source mode.** Third per-tab mode: raw CM with syntax highlight, zero
  decorations (one flag disabling the two live-preview plugins). Mode picker = tab
  header menu (Obsidian's ⋯) + ⌘E cycle edit↔read preserving which edit-flavor was last
  used. *Where:* `Editor.tsx`, tab state.
- **P3-2 · Task lists.** Live preview: render `- [ ]`/`- [x]` markers as checkboxes
  (widget decoration; cursor-overlap reveals source per C2 rule); click toggles by
  **document offset** through the normal buffer edit path (it's just a text edit — CM
  transaction, autosave handles the rest). Reading view: same, but the click maps
  AST-position → offset and routes through the repository save. Tests: toggle under
  masked code region impossible; multi-line list items.
- **P3-3 · GFM inline/block: tables, strikethrough, footnotes** — add `remark-gfm` to
  the reading-view/parser *presentation* pipeline (D20 satellite-dep provision;
  PROGRESS already anticipated it) + CM decorations for `~~x~~` and `==x==` (highlight
  is not GFM — small custom inline rule, same masked-scan util). **The authoritative
  parser (S2/S3) is untouched** — links/tags grammar doesn't change; this is rendering.
  Live-preview tables render as widget below/inline per Obsidian (source reveals on
  cursor). *Spec:* D-entry for remark-gfm.
- **P3-4 · Callouts.** Reading + live preview: blockquote whose first line matches
  `> [!type]( title)?` renders styled block (12 Obsidian types = colored icon+header;
  unknown type = note style), `-`/`+` fold suffix honored. Pure classifier in domain
  (tested); rendering in both views shares it.
- **P3-5 · Note transclusion.** `![[Note]]` / `![[Note#Heading]]` in reading view and
  live preview (widget): resolve via S4, render target's reading-view content (heading
  slice = from that heading to next same-or-higher depth), **depth cap 3 + cycle
  detection by relPath set** (cycle → "◦ circular embed" placeholder). Embeds are
  read-only with an "open" corner affordance. *Spec:* new S-entry (embed resolution +
  recursion rules — this is exactly the kind of algorithm SPECS exists for).
- **P3-6 · Folding.** CM `foldGutter` on headings + indented lists; persisted per note
  in uiStore (best-effort, like Obsidian).
- **P3-7 · (landed in P0-5; listed for traceability).**
- **P3-8 · Properties editor.** Live preview renders frontmatter as Obsidian's property
  rows (key, typed value editor; type inferred: list/checkbox/date/number/text; tag
  values render as tag chips feeding the same tag index — S3 identity rules). **Writes
  are textual line surgery through the existing `frontmatterText.ts` module — never
  YAML round-trip** (S1 trap #1 applies to user keys too: byte-minimal edits only).
  `ai:` block is NEVER shown here (it renders only inside AI surfaces). Source mode
  shows raw YAML. *Spec:* S-entry (property type inference + write rules). Tests: edit
  a property → body bytes untouched; hash changes exactly per V4.
- **P3-9 · Image paste/drop.** Clipboard/dragged image → write file to the attachment
  folder (P2-6 pref; default `attachments/`) via repository asset write (new
  `write_asset` Rust command through containment; watcher-ignored via signature),
  insert `![[name.png]]` at cursor. Name = `Pasted image YYYYMMDDHHmmss.png` (Obsidian's
  scheme).
- **P3-10 · Verify external links + autolink** in both views; fix gaps found.

### Phase 4 — Search & panels parity

- **P4-1 · Search operators:** add `file:`, `path:` (alias of folder: semantics but
  substring, Obsidian-style), `line:`, `"exact"`, `-neg`, `OR`, `/regex/`, match-case
  toggle. Parser stays pure + tested (extend `parseSearchQuery`); `line:`/regex run as
  post-filter over candidate docs' text (MiniSearch prefilters the rest). Keep
  `vault:`/`has:ghosts` as documented DeNote extensions (they don't conflict).
- **P4-2 · Quick switcher: "↵ to create"** when no match (creates in selected folder,
  Obsidian behavior), and recents-when-empty verified.
- **P4-3 · Backlinks with context.** Each mention shows its surrounding line (the link
  index already carries offsets; slice the source note's text around
  `offsetStart`), grouped by source note with per-note collapse. Outgoing panel groups
  resolved vs unresolved (ghosts) with counts.
- **P4-4 · Unlinked mentions.** On-demand (panel open) scan: for the active note's
  title + aliases (frontmatter `aliases:` — parse them; S3-adjacent, add to parser
  output as plain user frontmatter read), find whole-word case-folded occurrences in
  all other notes' `bodyText` **outside masked regions and outside existing link
  tokens**; each row: context + **Link** button that splices `[[Title]]` (or
  `[[Title|matched text]]` when casing differs) at the found offset **through the
  repository** (op-log undoable). Computed live, never stored (D5 discipline). Pure
  matcher in domain, tested (punctuation boundaries, CJK, overlap with wikilink).
- **P4-5 · Tags pane** (right sidebar): nested tag tree (split on `/`), counts,
  click → left-sidebar search `tag:x`, chevron collapse. Derived from index tag sets.
- **P4-6 · Outline pane:** heading tree of active tab's note; needs heading offsets —
  extend `ParsedNote.headings` with `{offsetStart}` (domain change, test-first,
  additive). Click scrolls editor (CM `dispatch` scrollIntoView) / reading view
  (element id anchor).
- **P4-7 · Bookmarks.** Star notes (context menu + ribbon-sidebar pane), stored in
  `.denote/bookmarks.json` (user data, not derived — same durability class as
  Obsidian's `.obsidian/bookmarks.json`; documented as the one `.denote` file besides
  `meta.json`+`topics.json` worth syncing — add to the vault `.gitignore` whitelist).
  V1 scope: bookmark notes + searches; groups post-1.0.

### Phase 5 — Graph parity (core face)

- **P5-1 · Obsidian default appearance** (from P0-1) refined: neutral dots sized by
  degree (Obsidian sizes by link count), tag nodes visually distinct, ghost nodes
  hollow (Obsidian's "orphan/nonexistent" gray), no labels-over-everything — text-fade
  slider governs (P5-4).
- **P5-2 · Filters card** (collapsible, top-right, Obsidian vocabulary): search box
  (reuses P4-1 query syntax to filter nodes), toggles: Tags / Attachments /
  Existing files only (hides ghosts) / Orphans. "Notes in map" index merges in here.
  Settings persist per vault in `.denote/cache/graph.json` (cache-class, rebuild-safe).
- **P5-3 · Groups:** user-defined list of query→color rows; first matching group colors
  the node (this is where power users recreate "topic coloring" manually — core
  mechanism, zero AI).
- **P5-4 · Display + Forces sliders:** text fade threshold, node size, link thickness,
  arrows on/off; center/repel/link-force/link-distance mapped to the d3-force sim
  params the renderer already owns. Deterministic seeding stays (our improvement; does
  not violate parity).
- **P5-5 · Local graph parity:** depth slider (1–5), same filters card, opens in right
  sidebar or as a tab (Obsidian allows both; v1 = tab is fine).
- **P5-6 · Hover neighborhood highlight:** hovered node + its edges/neighbors full
  opacity, rest faded (replaces R-4's always-dimmed orphans as the *core* treatment;
  orphan-dimming becomes part of AI mode's "not yet linked" story only).

### Phase 6 — Core-plugin parity

- **P6-1 · Daily notes:** Settings (folder `daily/`, format `YYYY-MM-DD`, template
  ref); ribbon + command + hotkey opens-or-creates today's note as a tab. Pure date
  formatting util (no dep; or `dayjs` with D-entry).
- **P6-2 · Templates:** template folder setting; "Insert template" command (fuzzy pick,
  splice at cursor with `{{title}}`/`{{date}}`/`{{time}}` substitution).
- **P6-3 · Note composer (OPTIONAL v1):** merge note into another (append + redirect
  links via rename machinery), extract selection to new note with link left behind.
- **P6-4 · Settings IA:** reorganize into Obsidian's taxonomy: Editor · Files & Links ·
  Appearance · Hotkeys · Core features (daily notes, templates, bookmarks toggles) ·
  **Add-ons** (Capture · Git sync · **AI**) · About. Every add-on toggle satisfies
  LAW 3. AI's toggle default = enabled-but-never-engaged (the ✨ button shows; nothing
  runs) — turning it OFF hides even the ✨ buttons.

### Phase 7 — The ✨ AI button (last, on top of a working Obsidian)

- **P7-1 · Lazy engagement plumbing:** `ensureAiEngaged(vaultId)` constructs engines,
  spawns sidecar, checks/downloads the model (with the R-1 progress events feeding the
  engage sheet), registers watcher hooks, restores queue. Engagement state persisted in
  `.denote/ai/engagement.json` (`{engaged: bool, autoUpdate: bool, lastRunAt, lastRunHashCount}`).
  *Spec:* D-entry (supersedes eager-boot wiring; S12/S13/S14 internals untouched).
- **P7-2 · Engage sheet + full-vault run** per 3.3 states 2–3. Reuses: R-2 sweep,
  enrichment queue, R-1 status data for progress/errors. Cancel = queue pause (persisted).
- **P7-3 · Graph AI layer:** when `ready` and "AI links" toggle on → ai-similar edges
  (dashed, hover reason/confidence — existing renderer code re-gated), topic hubs, and
  an optional "Color by topic" switch (the old default, now opt-in), confidence slider
  visible only here. Orphan dimming + "not yet connected" copy live here.
- **P7-4 · AI panel** (opened by ✨ when `ready`): per-note suggestions (re-homed
  SuggestionsPanel with accept/reject/accept-all — pipelines unchanged), Organize
  vault, Deep organize (cloud, if key), topic list, and the R-1 status/diagnostics
  section (sidecar/model/queue/per-note truth) as its "Status" tab. Command-palette AI
  entries appear only in `ready`, prefixed "AI:".
- **P7-5 · Auto-update toggle** ("Keep AI links up to date automatically", default OFF,
  shown after first successful run): ON = today's ambient behavior (save → queue,
  S10/S23 takeover honored); OFF = manual "Update" only. Takeover writes additionally
  require this toggle ON.
- **P7-6 · Provisional bar** renders only when engaged AND note has provisional `ai:`
  data; restyled as a labeled add-on banner ("✨ AI suggestions pending — review").
- **P7-7 · ⚡ StatusBar item** returns, gated on engagement (replaces P0-3's constant).
- **P7-8 · Copy pass:** every AI string in plain English, every AI artifact visually
  tagged with ✨, every suggestion shows its reason. No jargon ("enrichment",
  "takeover", "ontology" never appear in UI).

---

## Part 5 — Cross-cutting engineering rules for this track

1. **No engine rewrites.** `src/domain/`, Rust core, S1–S28 algorithms are stable. UI
   re-plumbing only, plus the additive items called out (heading offsets, aliases in
   parser output, trash command, write_asset, remark-gfm rendering, embed-resolution
   spec). Each additive item follows the existing bar: test-first in domain, D/S ledger
   entries appended, never renumbered.
2. **Every write still goes through the repository** (D23) — checkbox toggles, unlinked-
   mention linking, property edits, image paste, template insertion, daily-note creation.
   Any new UI that touches a file must name its write path in its PR description.
3. **S1/S23/S8 traps re-read before**: P3-8 (properties = frontmatter surgery), P1-2
   (multi-buffer vs deferral/conflict), P3-9 + P2-5 (new Rust write/delete commands and
   watcher classification).
4. **Tests:** every phase keeps `pnpm test`/`lint`/`e2e` green; parity behaviors get e2e
   coverage where the dev-server harness allows (tabs, find-in-note, checkbox toggle,
   context menus, search operators); Tauri-only items (Trash, Reveal in Finder, image
   paste, window title) go on the owner UAT script.
5. **Each phase lands as its own commit series with a PROGRESS.md entry**; two failed
   owner UATs on one phase = stop and summon the architect (existing rule).

## Part 6 — Scope rulings needed from the owner (defaults chosen; say "no" to override)

| Question | Recommendation (default if unanswered) |
|---|---|
| Split panes (P1-4) in v1? | **Yes, single split only** — tabs alone feel un-Obsidian to anyone who splits |
| Canvas | **Out** (post-1.0, matches D22) |
| Note composer (P6-3) | **Out of v1** — low usage, real machinery cost |
| Delete old TodayView outright vs hide | **Delete** (dead code = drift) |
| Graph tag nodes default | **On** (matches DeNote today; Obsidian ships tags-off — flip to off if strict-1:1 wins over usefulness) |
| Bookmark groups | **Out of v1** (flat list) |

## Part 7 — Execution order, sizing, and the new UAT

**Order is the phase order** — P0 (days, huge perceived delta) → P1 (the big one; P1-2
tabs is the riskiest single item in the plan, budget it alone) → P2 → P3 → P4 → P5 → P6 →
P7. Phases 2–4 are internally parallelizable across sessions; P5 depends on P0-1; P7
depends on everything and is deliberately LAST so the ✨ button lands on an app that is
already, verifiably, Obsidian.

**The new owner UAT (replaces ACCEPTANCE for this track):** run DeNote and Obsidian
side-by-side on a copy of the same real vault. Walk Part 1's tables top to bottom; every
✅-target row must be indistinguishable in behavior (not pixels). Then, DeNote-only: click
✨ → watch progress → graph gains labeled AI links with reasons → toggle them off → you
are back in Obsidian. Any row that fails is reported by its table number (e.g. "C4
fails") — no vibes, no essays. A phase closes only when its rows pass in the running app,
owner-confirmed, in PROGRESS.md.
