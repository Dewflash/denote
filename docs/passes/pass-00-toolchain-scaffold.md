# Pass 00 — Toolchain & scaffold

## Objective
A running empty Tauri app with the full project skeleton, lint/test infra, and the
domain-purity boundary enforced. No features.

## Steps
1. Verify toolchain; install what's missing (report versions in PROGRESS notes):
   Xcode CLT + Swift ≥ 5.10, Rust stable (rustup), Node ≥ 20, pnpm.
2. Scaffold Tauri 2 + React + TypeScript (vite). App identifier `com.dewflash.denote`,
   product name `DeNote`.
3. Create the source tree exactly as MASTERPLAN §3 (empty index.ts files with header comments
   stating each directory's contract are fine).
4. Tailwind v4 with a `tokens.css` defining the core design tokens
   (`--bg --bg-panel --fg --fg-muted --accent --border --radius --font-ui --font-editor`,
   light + dark via `prefers-color-scheme`, overridable by a `data-theme` attribute).
   Default look: quiet, neutral, high-legibility (D16).
5. Vitest + ESLint. Add the boundary rule: `src/domain/**` may not import from
   `src/services|state|app|features`, react, or `@tauri-apps/*`
   (eslint `no-restricted-imports` per-directory override is sufficient).
6. `pnpm tauri dev` must open a window rendering a placeholder shell (three empty panes).
7. `.gitignore` (node_modules, target, dist, .DS_Store), README stub pointing at CLAUDE.md.

## Pitfalls
- Tauri 2 config lives in `src-tauri/tauri.conf.json`; enable only the plugins needed later
  (fs, dialog, global-shortcut can wait until their passes — smallest permission surface now).
- Do NOT add the Swift sidecar, fastembed, or any AI dependency in this pass.

## Definition of Done
`pnpm tauri dev` opens the window; `pnpm test` runs (≥1 trivial domain test);
`pnpm lint` passes and FAILS if a test import of react is added to `src/domain/` (verify,
then remove the probe). PROGRESS.md updated.
