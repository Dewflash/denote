# Pass 03 — App shell UI: layout, tree, editor, backlinks

## Objective
A genuinely usable Obsidian-lite. The owner should be able to take real notes in it daily
after this pass. Zero AI.

## Deliverables
- Shell layout: far-left **vault rail** (icon per vault, one-click switch — single vault for
  now, rail built for many); left sidebar with **Recent notes** on top + collapsible file
  tree; center **editor**; right panel with **Backlinks** and **Outgoing links** tabs; status
  bar (word count, vault name).
- Editor: CodeMirror 6 (D19) — markdown syntax highlighting, live-preview decorations
  (rendered headings/bold/italics; wikilinks render as links, cmd-click to follow; tags as
  chips), `[[` triggers autocomplete over note titles, `#` over known tags. Autosave
  (debounced 800ms) through the repository only.
- Reading view toggle (rendered markdown, cmd-E).
- **Today view** (cmd-T): all notes created/edited today across the open vault; one-keystroke
  new note (cmd-N → untitled note in an inbox folder `Inbox/` unless a folder is selected).
- Backlinks panel shows source note + surrounding line context; click navigates.
- Command palette (cmd-P): open note, new note, toggle reading view, open settings.
- Settings window skeleton with sections (Vaults, Editor, Appearance, AI & Models, Graph,
  Hotkeys, Data) — Appearance functional now: light/dark/system + accent color, driven
  entirely by the D16 tokens.
- Paste-to-capture v1: pasting into the file tree / Today view with nothing focused creates a
  new note from clipboard (title = first line, truncated).

## Also normative here
**S21** (keymap registry — register bindings, never scatter literals), **S23** rule 3
(external change to a dirty open buffer → conflict bar, never silent merge), **S26** assets
(image embeds `![[img.png]]` render read-only; non-md files never enter the parse/AI
pipeline), **S26** settings location.

## Pitfalls
- Ghost links (`[[Nonexistent]]`) must be visually distinct and clicking one CREATES the note
  (Obsidian behavior) — via repository, in the current folder.
- All state through Zustand stores fed by repository snapshots; components never touch
  storage or Tauri APIs directly.
- Keep every color/font/spacing on tokens — no hardcoded values (theming depends on it).
- Editor performance: 10k-line note must type without lag (avoid full re-decoration per
  keystroke; use CodeMirror's incremental viewport decorations).

## Definition of Done
Manual script (record in PROGRESS notes): create vault → create 10 interlinked notes with
tags → backlinks correct → rename a note from the tree → links rewritten → ghost click
creates note → Today view lists today's notes → dark/light + accent switch live. Domain +
integration tests still green.
