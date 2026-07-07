# Vision corpus — expected behavior

This two-vault corpus encodes the owner's core scenarios. It is the canonical semantic test
data: passes 1–9 use it (or extend it — never mutate existing notes' meaning). Each
expectation below states which pass must demonstrate it.

## Deterministic layer (passes 1–5)

- `[[Bank of Japan]]` in `Japan.md` resolves to nothing → **ghost node**; clicking creates
  `Japan/Bank of Japan.md`. (pass 1/3/4)
- `[[Interest Rates|rates]]` in `Yen Intervention.md` resolves by title with alias intact;
  backlink appears on `Interest Rates.md` with context line. (pass 1/3)
- `Local First Software.md`: the fenced-block `[[Not A Link]]` / `#not-a-tag` and the inline
  code `[[also not a link]]` produce NO links and NO tags. Its only real link is
  `[[Embeddings]]`; only real tag `#tech`. (pass 1)
- `Untitled Capture.md` has no H1 → title falls back to filename. (pass 1)
- `#japan` tag hub connects exactly `Japan.md` and `Yen Intervention.md` — two note→tag
  edges, zero note→note edges. (pass 1/4)
- Structural-hull toggle shows Japan/Economics/Tech/Inbox folders nested in the
  daily-learnings vault hull. (pass 4)
- Combined view of both vaults: `#faith` stays church-only; no wikilink crosses vaults. (5)

## AI layer (passes 6–9) — with real backends; mock approximates shapes only

- **Takeover (D9/S10):** `Untitled Capture.md` (no links, no tags) receives provisional
  `ai:` structure — plausibly tags like banking/japan and a link toward `Yen Intervention`
  or `Japan`. `Miso Soup Recipe.md` (also bare) receives cooking-ish provisional structure —
  NOT finance, despite living in `Japan/`. Adding any user tag to either demotes its
  provisional block. (pass 6 mock shape; pass 7 real)
- **Similarity (D6a):** `Untitled Capture.md` ↔ `Yen Intervention.md` is a natural
  ai-similar edge with a reason naming BOJ/zero-rate policy specifically. `Miso Soup
  Recipe.md` ↔ `De-dollarization.md` must NOT produce an edge (nothing nameable shared).
  (pass 7)
- **Ontology (D14):** a Finance-like parent topic emerges with a Banking-like child;
  `Japan.md`, `Yen Intervention.md`, `Interest Rates.md`, `Untitled Capture.md` are members;
  "banking", "banks", "banking system" phrasing across notes yields ONE topic, not three.
  `De-dollarization.md` + `Gold.md` cohere into a theme topic (reserve currencies / USD
  shift) connected to Finance. (pass 8)
- **Semantic default view:** `Japan/` folder members scatter — `Miso Soup Recipe.md` clusters
  with food/nothing, not with the banking notes. This scattering is CORRECT. (pass 8)
- **Folder profile + misfit:** `Japan/` profile reads as mostly monetary-policy notes;
  `Miso Soup Recipe.md` is flagged as a misfit SUGGESTION (never moved). (pass 8)
- **Cross-vault theme (D17):** with both vaults open and neither localOnly, a money-related
  connection may surface between `Stewardship.md` and the Finance topic — as an AI edge with
  a stated reason. Marking church localOnly removes church content from ALL AI processing by
  network backends and from cross-vault hints. (pass 8/9)
- **Deep-organize (pass 9):** the cross-note "world shifting away from USD" theme links
  De-dollarization, Gold, Yen Intervention with reasons citing each note; runs under the
  budget cap on this tiny corpus for well under $0.50.

## Anti-goals (must NOT happen on this corpus)

- No note→note edge exists merely because two notes share a tag or folder.
- No AI edge with a vacuous reason ("both are notes", "similar style").
- No topic named both "Banking" and "Banks".
- No automatic file move of `Miso Soup Recipe.md`.
- No modification of any note body by AI beyond the `ai:` frontmatter block.
