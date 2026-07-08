# Progress Ledger

Update this file at the end of every pass: set status, date, record deviations from the brief
and anything the next agent must know. One pass in flight at a time; respect dependencies.

| Pass | Title | Depends on | Status | Completed | Notes |
|------|-------|-----------|--------|-----------|-------|
| 00 | Toolchain & scaffold | — | **done** | 2026-07-08 | Tauri 2 + React 19 + TS scaffold at repo root (identifier `com.dewflash.denote`, product name `DeNote`). Source tree per MASTERPLAN §3 (empty `index.ts` files w/ header comments). Tailwind v4 + `src/app/tokens.css` (light/dark via `prefers-color-scheme`, `data-theme` override). Vitest + ESLint flat config w/ domain-purity boundary rule (`no-restricted-imports` on `src/domain/**`) — probed with a `react` import, confirmed it fails lint, then removed. `pnpm tauri dev` builds and opens the 3-pane placeholder shell; `pnpm test`/`pnpm lint` pass. Only `opener` Tauri plugin enabled (fs/dialog/global-shortcut deferred). No Swift sidecar or AI deps added (`sidecar/apple-ai/` has a README stub only). |
| 01 | Domain core: parser, types, graph builder | 00 | **done** | 2026-07-08 | Pure `src/domain/`: `types.ts` (MASTERPLAN §5 + `WikiLink.heading` S2 + `ParsedNote.warnings` per brief), `sha256.ts` (pure FIPS-180-4, see deviation), `hashing.ts` (S1 verbatim port of the reference; all 12 vectors + R1 property test green), `parser.ts` (unified/remark blocks + masked inline scanner, S2/S3/S5), `links.ts` (S4 + ghost identity + link-index builder), `backlinks.ts` (D5, computed only), `graphBuilder.ts` (D6/D6a/D7/D17 hub model, deterministic sorted output), `takeover.ts` (D9/S10 pure decision fn). 119 tests pass (48-case parser corpus + S3 vectors, hashing vectors+property, links, backlinks, takeover, graphBuilder snapshots, vision-corpus deterministic layer, sha256 vs node:crypto). `pnpm test`/`pnpm lint`/`tsc`/`pnpm build` all clean. Reference script still ALL GREEN. Next: pass 02 → **architect checkpoint A** follows. |
| 02 | Vault engine: fs, watcher, repository, indexes | 01 | **next** | | |
| 03 | App shell UI: layout, tree, editor, backlinks | 02 | pending | | |
| 04 | Graph view | 02, 03 | pending | | |
| 05 | Search & multi-vault | 02, 03 | pending | | |
| 06 | AI framework: AiClient, mock, annotations, takeover | 02 | pending | | |
| 07 | Local intelligence: embeddings, Apple sidecar, enrichment | 06 | pending | | |
| 08 | Ontology & semantic clustering, insights v1 | 07 | pending | | |
| 09 | Cloud tier: Anthropic, deep-organize, budget cap | 07, 08 | pending | | |
| 10 | Capture, appearance polish, e2e smoke | 03, 06 | pending | | |
| 11 | Sync & import: git/GitHub, dedupe | 02 | pending | | |

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
| A | 02 | Foundation: domain purity, S1 port vs reference script, parser fixtures quality, watcher echo/tagging (S8), fs containment (S22), move reconciliation (S9) | pending |
| B | 06 | AI plumbing: R1 loop test legitimacy, takeover state machine (S10), dirty-buffer deferral + op-log undo (S23), annotation/rejection stores, router localOnly enforcement | pending |
| C | 08 | Flagship quality: canonicalization behavior vs EXPECTED.md, topic sprawl check on a real vault, folder profiles/misfit, `_topics` byte-stability + freeze | pending |
| D | 09 | Money & privacy: budget gate is physically-uncrossable, batch durability (S27), spend reconciliation, localOnly in assembler AND router, Keychain handling | pending |
| E | 11 | Release audit: full-repo sweep, derived-data deletion drill, conflict handling, private-repo default, EXPECTED.md + ACCEPTANCE.md end-to-end | pending |

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

## Owner inputs required

Things only the owner (Kevin) can provide. When a pass reaches a step needing a missing
input, the agent STOPS that step, marks it here as `awaiting-owner`, tells the owner exactly
what is needed and why, and continues with the rest of the pass if independent.

| Input | Needed by | Status | Notes |
|-------|-----------|--------|-------|
| LICENSE choice for the repo | any time (repo is public with no license = all rights reserved) | awaiting-owner | agent adds the file once told |
| App icon / final branding | pass 10 (build polish) | awaiting-owner | default Tauri icon until then |
| Anthropic API key | pass 09 (entered by owner in Settings → AI, stored in Keychain — never give it to an agent in chat) | awaiting-owner | pass 09 dev/tests use mock until owner enters key and runs verification |
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

## Blocked

(empty)
