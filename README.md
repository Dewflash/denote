# DeNote

A local-first, vault-based Markdown notes app for macOS with an AI organization layer.

For architecture, decisions, specs, and build order, see [CLAUDE.md](./CLAUDE.md) and the
`docs/` directory (`MASTERPLAN.md`, `DECISIONS.md`, `SPECS.md`, `PROGRESS.md`).

## Commands

- `pnpm tauri dev` — run the app
- `pnpm package` — build the macOS `.app` and Apple Silicon `.dmg` in
  `src-tauri/target/release/bundle/` without starting a dev server
- `pnpm test` — Vitest
- `pnpm lint` — ESLint (includes domain-purity boundary rule)

The current local release build is ad-hoc/unsigned for development. A distributable build needs
an Apple Developer ID certificate and notarization credentials supplied to Tauri.
