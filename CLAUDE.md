# DeNote — Agent Operating Manual

You are an implementation agent on DeNote: a local-first, vault-based Markdown knowledge app
(Obsidian-class) for macOS, with an AI organization layer. The architecture and all executive
decisions were made up front by the architect. Your job is to execute a pass, not to redesign.

## Session start procedure (every session, in order)

1. Read `docs/MASTERPLAN.md` — architecture, data model, on-disk formats.
2. Read `docs/DECISIONS.md` — the binding decision ledger (D-numbers). These are law.
3. Read `docs/SPECS.md` — normative algorithms, grammars, formats, protocols (S-numbers).
   Where anything else disagrees with SPECS, SPECS wins (D31). Its test vectors are
   mandatory test cases. Do not "improve" a specified algorithm — several were chosen to
   avoid non-obvious failure modes (e.g. S1 is textual on purpose: YAML round-tripping is
   not byte-stable and would break loop prevention).
4. Read `docs/PROGRESS.md` — find the pass marked `next`.
5. Read that pass's brief in `docs/passes/`. Work only within its scope.
6. When the pass's Definition of Done is fully met, update `docs/PROGRESS.md` (status, date,
   deviations, notes for the next agent) and commit.

## Hard rules — never violate, regardless of pass

- **Files are the only source of truth.** `.md` files on disk. Everything else (indexes,
  backlinks, search, graph, AI output) is derived and must be rebuildable from the files alone.
- **Never store backlinks.** They are computed from the link index, always.
- **AI never modifies a note body.** The only writes AI output can cause: (a) user accepts a
  suggestion → a wikilink/tag/frontmatter entry is written; (b) the takeover policy writes into
  the `ai:` frontmatter namespace only (D9); (c) materialized `_topics/*.md` files (D8c).
- **contentHash excludes the `ai:` frontmatter block** (D3a). Violating this creates an
  infinite AI re-trigger loop. If you touch hashing or frontmatter code, re-read D3a.
- **Every graph edge carries `source`** (`user | parser | ai | system`) and AI edges carry
  `confidence` and a human-readable `reason`. No anonymous edges, ever.
- **Domain layer purity** (`src/domain/`): pure TypeScript, no imports from `services/`,
  `state/`, React, or Tauri APIs. Testable with Vitest alone. There is a lint rule for this;
  do not disable it.
- **App-originated file writes must be tagged** so the watcher does not treat them as external
  edits and re-trigger pipelines (D23). If you add any code path that writes into a vault,
  route it through the repository's write API — never raw fs.
- Do not add dependencies outside the approved stack (D1, D16, D19, D24) without recording a
  new decision in `docs/DECISIONS.md` with rationale.
- Do not renumber or delete existing decisions. Append.

## If a pass brief conflicts with reality

Small deviation (API renamed, library minor-version drift): proceed sensibly, record the
deviation in `PROGRESS.md`. Structural conflict (a decision is impossible as written): stop,
write up the conflict in `PROGRESS.md` under "Blocked", and surface it to the user. Do not
silently substitute your own architecture.

## Testing bar

- `src/domain/`: test-first. The parser and graph builder have fixture corpora under
  `tests/fixtures/`; every bug found later must add a fixture.
- Services: integration tests where feasible (temp-dir vaults).
- UI: manual verification per pass DoD; e2e smoke tests arrive in pass 10.
- `pnpm test` and `pnpm lint` must pass before a pass is marked done.

## Commands

- `pnpm tauri dev` — run the app
- `pnpm test` — Vitest
- `pnpm lint` — ESLint (includes domain-purity boundary rule)
