# Pass 01 — Domain core: types, parser, hashing, graph builder

## Objective
The pure heart of the app, fully tested before any UI or fs exists. Everything in
`src/domain/`, tests in `tests/`, fixtures in `tests/fixtures/`.

## Deliverables
- `domain/types.ts` — implement MASTERPLAN §5 exactly.
- `domain/parser.ts` — unified/remark for blocks (frontmatter via remark-frontmatter + yaml,
  headings) + custom inline scanner for wikilinks/tags (D20).
- `domain/hashing.ts` — contentHash per **D3a**: normalize line endings to `\n`, strip the
  `ai:` top-level YAML key from frontmatter (if present) before hashing, SHA-256 hex.
- `domain/links.ts` — link resolution: title → note. Rules: match against title (first H1)
  then filename (without extension); case-insensitive; ties broken by shortest path;
  unresolved → ghost. Alias syntax `[[Target|Alias]]`; embed syntax `![[Target]]`.
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
