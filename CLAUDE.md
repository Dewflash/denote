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

## Owner inputs

Some steps need things only the owner can provide (see PROGRESS.md → Owner inputs). When you
hit one that's missing: mark it `awaiting-owner` there with exact instructions for the
owner, skip that step, and complete everything independent of it. Never ask the owner for
secrets in chat — keys are entered by the owner directly into the app (Keychain).

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

## Known traps — read before your pass; these are where implementations go wrong

Each of these looks fine in code review and fails in production. The spec section is the fix.

1. **Hashing via YAML round-trip (S1).** Parsing and re-serializing frontmatter to strip the
   `ai:` key produces unstable bytes → hash inequality → infinite enrichment loop. The strip
   is textual line removal. Run `node docs/reference/hash_spec_test.mjs` against your port.
2. **Background write vs. typing race (S23).** Takeover writes `ai:` frontmatter while the
   user is typing in that note → clobbered keystrokes. Dirty open buffers DEFER AI writes.
   If you implement any write path and haven't thought about the open-editor case, stop.
3. **Watcher echo (S8).** Your own writes come back as watcher events. Without signature
   tagging you'll re-run pipelines on every save; with naive tagging you'll misclassify a
   real external edit that happens to occur within the window — the signature matches on
   content hash, not just path+time, for exactly this reason.
4. **Unbounded path access (S22).** A generic `read_file(absolutePath)` Tauri command is a
   security hole (webview → whole disk). Containment checks are canonicalize-then-verify,
   in Rust, on every command.
5. **Note-note cliques (D6).** "Notes sharing a tag are connected" = O(n²) edges = hairball.
   Tags and topics are hub nodes. If your graph code ever iterates pairs of notes to make
   edges (other than the capped ai-similar pipeline), it's wrong.
6. **Topic sprawl (D14/S17).** Skipping the retrieve-existing-topics step in enrichment
   prompts creates "banking"/"banks"/"banking system" as three topics within a week. The
   canonicalization order (exact → alias → 0.80 centroid → create) is mandatory, including
   for cloud-tier output.
7. **Storing derived data (D3/D5).** The moment backlinks, or any index, get persisted as
   truth, external edits corrupt them. Everything derived must be rebuildable — pass 10
   literally deletes `.denote/cache` live to prove it.
8. **Cross-system undo (S23/D38).** Wiring structural ops into CodeMirror's typing history
   (or ignoring undo for them) both fail. Two tiers, op-log with inverses.
9. **Batch jobs and app restarts (S27).** A submitted Anthropic batch outlives the process.
   Persist batch ids before submission; resume polling on launch; reconcile spend. Money
   must never vanish silently.
10. **Mixed embedding models (S14).** Vectors from different models are not comparable.
    The store records its model id; mismatch = discard and re-embed, never mix.
11. **Editor perf cliff (pass 3).** Re-decorating the whole document per keystroke feels
    fine on test notes and dies on a 10k-line note. Use viewport-incremental decorations
    from the start.
12. **Scope discipline.** If you find yourself designing something the docs don't specify,
    that's not initiative, it's drift: check SPECS first, then DECISIONS; if genuinely
    unspecified AND load-bearing, write it up in PROGRESS "Blocked" and stop. Small
    mechanical choices (a variable name, a private helper) are yours; anything an S-number
    or D-number could plausibly govern is not.

## Commands

- `pnpm tauri dev` — run the app
- `pnpm test` — Vitest
- `pnpm lint` — ESLint (includes domain-purity boundary rule)
