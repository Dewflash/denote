# Pass 01 — Domain core: types, parser, hashing, graph builder

## Objective
The pure heart of the app, fully tested before any UI or fs exists. Everything in
`src/domain/`, tests in `tests/`, fixtures in `tests/fixtures/`.

## Normative specs for this pass — implement exactly, vectors are mandatory tests
SPECS **S1** (normalization + contentHash — do NOT parse/re-serialize YAML; textual strip),
**S2** (wikilink grammar incl. `#heading` and alias-with-pipe), **S3** (tag regex),
**S4** (link resolution order + ghost identity), **S5** (code-region masking),
**S6** (relPath rules).

## Deliverables
- `domain/types.ts` — implement MASTERPLAN §5 exactly (WikiLink includes `heading?`).
- `domain/parser.ts` — unified/remark for blocks (frontmatter via remark-frontmatter + yaml,
  headings) + custom inline scanner for wikilinks/tags (D20) over the S5 mask.
- `domain/hashing.ts` — S1 verbatim, all 12 vectors as tests.
- `domain/links.ts` — S4 verbatim.
- `domain/backlinks.ts` — compute backlinks map from a link index (D5).
- `domain/graphBuilder.ts` — build `{nodes, edges}` from parsed notes + (optional) topics +
  annotations, per D6/D6a/D7/D17. Accepts a vault set. Tags/topics are hub nodes. Pure.
- `domain/takeover.ts` — pure decision function for D9: given a ParsedNote + annotations,
  returns which provisional entries to apply/demote. (Applying is pass 6's job.)

## Parser spec (test each; fixture corpus under `tests/fixtures/parser/`)
- `[[Note]]`, `[[Note|alias]]`, `![[Note]]` embeds; multiple per line; unicode titles.
- `#tag`, `#nested/tag`, `#tag-with-dash`; `#` followed by space is a heading, not a tag.
- NO parsing inside fenced code blocks, inline code, or math blocks (D20 — write explicit
  fixtures for each).
- YAML frontmatter: user keys preserved; `ai:` key extracted into `aiFrontmatter` separately.
- Title fallback chain: first H1 → filename.
- Malformed input never throws: parser returns best-effort + `warnings[]`.

## Canonical corpus
`tests/fixtures/vision-vault/` + its `EXPECTED.md` exists already — the deterministic-layer
expectations there (ghosts, alias links, code-fence exclusion, tag hubs, title fallback) are
part of this pass's test suite in addition to the per-case parser fixtures you author.

## Executable ground truth
`docs/reference/hash_spec_test.mjs` is a runnable reference of the S1 algorithm and S3 tag
regex with all vectors (run `node docs/reference/hash_spec_test.mjs` → must print ALL
GREEN). Port its assertions into the Vitest suite verbatim; if your implementation disagrees
with it, your implementation is wrong.

## Pitfalls
- The inline scanner must operate on remark's node positions (or a mask of code regions), not
  on the raw string blindly — that's how code-fence exclusion stays correct.
- Hashing (D3a) is the single most load-bearing function in the app (R1). Property: hashing a
  file, then adding/changing/removing ONLY the `ai:` block, yields the same hash. Test it.
- graphBuilder must be deterministic: sort nodes/edges by id so snapshots are stable.

## Definition of Done
≥ 40 parser fixture cases passing; hashing property tests; graphBuilder snapshot tests
covering: two-note wikilink, ghost node, tag hub with 3 notes (exactly 3 edges — no clique),
topic hub, cross-vault id namespacing, ai-similar edge carrying reason+confidence.
