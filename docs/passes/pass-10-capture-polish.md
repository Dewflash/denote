# Pass 10 — Global capture, appearance depth, polish, e2e

## Objective
The capture workflow that makes DeNote the default destination for anything worth keeping,
plus the full theming system and a hardening sweep.

## Deliverables
- **Global quick-capture (D27):** system-wide hotkey (default cmd-shift-N, rebindable) via
  Tauri global-shortcut → floating always-on-top capture window: grabs current selection
  (attempt AX selection read; fallback: simulate cmd-C with clipboard preserve/restore) +
  source app name + URL/title when the source is a browser. Fields: text, title (AI-suggested),
  vault picker (remembers last), folder, tags (AI-suggested). Enter files it via repository;
  esc discards. Works while the main window is closed (tray/menu-bar mode).
  - macOS permissions: Accessibility prompt with a friendly explainer; capture must still
    work (clipboard-only mode) if denied.
- Provenance frontmatter on captured notes: `source_url`, `source_app`, `captured_at`.
- **Appearance completion (D16):** theme = JSON of token values; bundled themes (Default
  Light/Dark + one opinionated pair); import/export theme files; live theme editor (token
  color pickers); **CSS snippets folder** (`~/Library/Application Support/DeNote/snippets/`,
  each .css toggleable in settings, hot-reloaded); editor font/size/line-width; UI density
  (comfortable/compact); graph palette per theme.
- Orphans & ghosts indicator: status-bar count → popover listing unlinked notes and
  unresolved links (click to open/create).
- Hardening sweep: error boundaries per surface; corrupted `.denote/*` files → quarantine +
  rebuild indexes (files are truth — prove it by deleting `.denote/cache` live);
  `schemaVersion` migration scaffold with a no-op v1→v1 migration registered.
- e2e smoke via tauri-driver/WebdriverIO (or Playwright against dev server for UI-only
  paths): open vault → new note → link → backlink → graph renders → search finds → capture
  simulation (in-app path).

## Pitfalls
- Clipboard preserve/restore in the fallback path must be bulletproof (users notice clipboard
  clobbering immediately).
- Global shortcut conflicts: detect registration failure and surface remap UI, don't fail
  silently.
- Snippets are arbitrary CSS — scope injection after token layer so tokens stay overridable;
  a broken snippet must be disable-able from settings even if it breaks layout (settings
  window unaffected by snippets).

## Definition of Done
From Safari: select text → hotkey → capture window pre-filled with text + URL → filed note
carries provenance + AI title/tags. Theme export→import round-trips. A deliberately hostile
CSS snippet can't brick settings. e2e suite green in CI-style run (`pnpm e2e`).
