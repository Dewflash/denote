# RECOVERY — make DeNote feel like Obsidian-plus, in the owner's hands

Written by the architect 2026-07-12 after owner verdict: "broken — graph horrible, file
creation not seamless, 0 linking functions." All 458 tests are green; the product still
failed the owner. Cause: the AI chain fails INVISIBLY in the real runtime, and desktop-UX
parity was never specified. This track supersedes v1 sign-off. Nothing ships until the
owner says each criterion FEELS right in the running app — test suites do not close these
items, only the owner does.

Execution: one criterion per short session, any capable model, kickoff prompt:
"Read CLAUDE.md, then execute the next open item in docs/RECOVERY.md. Verify with
`pnpm tauri dev` running; describe exactly what the owner should see."
Sessions MUST commit and MUST log deviations (a prior session failed both — see PROGRESS).

## R-1 · AI STATUS PANEL — first, because it unblocks diagnosing everything else

A `⚡` status item in the StatusBar + panel showing, live:
- Apple sidecar: spawned? `capabilities()` result (available/reason/model version).
- Embedding model: not-downloaded / downloading (REAL progress %, wired from Rust via an
  event — `with_show_download_progress` prints to a console the user cannot see) / ready
  (model id) / error (verbatim).
- Enrichment queue per open vault: pending / running / parked counts; parked jobs listed
  with their verbatim errors and a Retry button.
- Per-note answer: with a note open, "Why isn't this note linked?" → shows its enrichment
  state (never run / hash-gated / parked+error / done: N suggestions, M below threshold),
  embedding state, similarity candidates found and what gate rejected them (cosine floor /
  vacuity / LLM said unrelated).
Acceptance (owner): open the panel on your real vault and it tells you, truthfully, why any
given note has or lacks AI links — no guessing, no console.

## R-2 · THE AI ACTUALLY LINKS HIS VAULT — the core promise

With R-1 visible, run the chain end-to-end on the owner's real "Daily Wisdom"/"IdeaHub"
vaults and fix every break found until: open vault → model downloads with visible progress
(once) → notes embed → enrichment runs → ai-similar edges + topics appear in the graph
within minutes, with reasons on hover. Every failure mode surfaced in R-1's panel, never
swallowed. Known suspects to check first: first-run model download UX; sidecar spawn path
in `pnpm tauri dev` vs bundled; parked queue never retried on launch; similarity pipeline
only firing on note-change (imported notes never re-fire — needs an initial full-vault
sweep, hash-gated so it's one-time).
Acceptance (owner): your imported vaults, untouched, show AI topic clusters and ai-similar
edges with sensible reasons. This criterion is the product.

## R-3 · FILE/FOLDER UX AT OBSIDIAN PARITY

Explicit behaviors (this was never specified — spec debt, not executor error):
- Right-click context menus: file tree background → New note / New folder; on a note →
  Rename, Delete (to Trash), Move to…, Reveal in Finder; on a folder → New note here,
  New folder here, Rename, Delete.
- New note: appears in-place with name pre-selected for typing (like Finder), `.md`
  implied; Enter commits; Esc cancels; empty name → "Untitled n".
- Drag-and-drop notes between folders in the tree (uses `moveNote`, links re-resolve).
- cmd-N creates in the selected folder (falls back to Inbox/ only when nothing selected).
Acceptance (owner): create/rename/move/delete a note and a folder entirely with the mouse,
without touching Finder or memorizing a hotkey, and it feels unremarkable.

## R-4 · GRAPH READABILITY

- Note titles visible at default zoom for graphs ≤ ~300 nodes (not only on hover/zoom).
- Sane initial camera: fit-to-graph on open, not a fixed zoom.
- Edge layers: on a graph with zero visible edges, the R-1 panel link + the existing hint
  must make the reason obvious (layers off vs. genuinely no edges yet vs. AI dead).
- Unlinked-note treatment: isolated dots get lower opacity + a one-click "cluster by topic"
  affordance once R-2 works (topics give even link-less imports structure).
Acceptance (owner): open the combined graph and understand what you're looking at in ten
seconds, and it looks like something Obsidian cannot do (topic-colored clusters with
reasons), not something worse.

## Answer to "what are local [[links]] even for"

`[[wikilinks]]` are the same manual links Obsidian has — the user layer, kept because it's
the highest-trust signal. The layer you actually bought — AI linking notes FOR you — is
R-2. When R-2 works, you should rarely need to write a wikilink by hand; when you do, it
outranks everything the AI says. That was always the design; the failure is that the AI
layer never visibly reached your vault.
