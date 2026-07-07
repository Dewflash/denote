# Decision Ledger — binding

Each decision was made by the architect after adversarial review ("challenged:" records the
strongest attack and why the decision survived or how it changed). Implementation agents do
not re-litigate these. To change one: append a superseding decision with rationale; never
edit or renumber history.

**D1. Platform: Tauri 2 + React + TypeScript, macOS-first.**
Challenged: we need a Swift sidecar anyway — why not full native SwiftUI? Because the editor
(CodeMirror 6), graph rendering, and token-based theming are dramatically stronger in web
tech, and portability is preserved. Survived.

**D2. A vault is a real folder of `.md` files; files are the sole source of truth.**
App data lives in `.denote/` inside the vault (like `.obsidian/`). Notes must open cleanly in
any editor. No app-internal note storage, ever.

**D3. Three data tiers:** (1) source = file bytes; (2) derived indexes = rebuildable caches,
never authoritative; (3) AI annotations = separate store keyed `relPath + contentHash` with a
lifecycle (`suggested → accepted | rejected | applied-provisional`).

**D3a. contentHash = SHA-256 of the note's normalized content EXCLUDING the `ai:` frontmatter
block.** Challenged (self-attack, 2026-07-07): if the hash covered the whole file, the
takeover policy's own `ai:` writes would change the hash, re-trigger enrichment, and loop
forever. Changed the original design: hashing is now defined over (user frontmatter + body)
with the `ai:` YAML key stripped before hashing. This rule is load-bearing; see R1.

**D4. Note identity = vaultId + vault-relative path. Rename is a refactor** that rewrites all
inbound wikilinks across the vault. No UUIDs injected into files.

**D4a. Move reconciliation by contentHash.** Challenged: path identity breaks when the user
moves files in Finder (no rename event pairs). Resolution: when the watcher sees a delete + a
create whose contentHash matches, treat it as a move — remap annotations, embeddings, and
snapshots to the new path instead of orphaning them. Added 2026-07-07.

**D5. Backlinks are never persisted.** Computed from the link index on demand.

**D6. Edge model:** tags and topics are hub nodes (note→tag, note→topic edges) — never
note-note cliques. Every edge carries `source ∈ {user, parser, ai, system}`. AI edges carry
`confidence` and `reason`.

**D6a. Similarity edges require a stated reason.** Embeddings only *propose* candidates
(top-k per note, default k=3, cosine threshold default 0.62 — tune in pass 7); an LLM must
then name the specific shared concept before the edge exists. Pure-embedding edges are never
shown. This is the "no bullshit connections" guarantee: generic overlap ("both in English")
cannot pass the naming gate.

**D7. Grouping = two non-contaminating overlays.** Semantic (topic clusters) is the DEFAULT
graph view; structural (vault→folder nested hulls) is a toggle, off by default. (Owner
preference, 2026-07-07.) AI never redraws structure; folders never bias semantic clustering.

**D8. AI never modifies note bodies.** Only three sanctioned write paths:
(a) user accepts a suggestion → real wikilink/tag/frontmatter written;
(b) takeover policy writes into the `ai:` frontmatter namespace only (D9);
(c) materialized `_topics/*.md` hub notes, frontmatter `source: ai` — optional feature,
default on, **excluded from enrichment and off-graph by default**; clicking any node shows
AI-link provenance in the inspector instead.

**D9. Takeover policy** (most notes will have no manual categorization — folders are the only
human signal, so this is the default path, not an edge case): a note with zero user wikilinks
and zero user tags gets AI suggestions above confidence ≥ 0.75 auto-applied as *provisional*
structure into the `ai:` frontmatter block, rendered in softer styling. The moment the user
adds any own structure, provisional entries demote to suggestion-only. Folder membership
counts as user signal for weighting (D14) but does NOT block takeover.

**D10. Rejection memory.** Rejected suggestions are recorded by `contentHash + suggestion
fingerprint` and never re-surfaced for identical content.

**D11. Free AI tier: Apple Foundation Models via Swift sidecar (JSON-RPC over stdio) is
primary.** llama.cpp/MLX bundled-model fallback (weights ~2–3GB downloaded on demand to app
support, Metal-accelerated) is documented but NOT built unless the Apple path proves
unreliable in practice. Embeddings never depend on Apple (D24).

**D12. Retrieval funnel.** No tier ever reads the vault wholesale: embeddings retrieve →
on-device model works on slices → paid tier works on summaries + topic index with selective
drill-down. Hash-gating skips unchanged notes at every tier.

**D13. Cloud spend: monthly deep-organize runs via the Anthropic Batch API** (50% rates) with
a hard budget cap (default $10/month) enforced by pre-counting tokens (`count_tokens`
endpoint) and trimming the job to fit. Prompt caching for repeated context. Model default
`claude-opus-4-8` for deep-organize; routing table lets the user pick per task. Keys in the
macOS Keychain, never in files.

**D14. Topic ontology:** persistent store (`.denote/ai/topics.json`); topic creation requires
canonicalization — exact name match → alias match → embedding similarity vs existing topics →
only then create new. Topics form a hierarchy (`parentId`) plus `related` edges; notes have
soft multi-membership with weights. Folder co-location adds membership weight, never
determines it.

**D15. Search: MiniSearch full-text, rebuilt on vault load** (adequate <5k notes; persistence
is a later optimization, not an architecture change). Semantic search rides on the pass-7
embeddings for free.

**D16. UI: Tailwind v4 with CSS-variable design tokens, Radix primitives (shadcn pattern),
Zustand state.** Boring, clean default theme. A theme = a JSON of token values. A CSS-snippets
folder is loaded at runtime for power-user restyling.

**D17. Multi-vault:** registry in app support; node ids are `vaultId/relPath`; wikilink
resolution is vault-scoped; ai-similar and topic edges may span vaults; graph view takes a
*set* of selected vaults.

**D18. Privacy: per-vault `localOnly` flag** enforced inside the AiClient router — content
from a localOnly vault can never reach a network backend, regardless of task routing.

**D19. Editor: CodeMirror 6** with live-preview decorations, wikilink autocomplete, tag
highlighting.

**D20. Parser: unified/remark for block structure + a custom inline scanner for
`[[wikilinks]]` and `#tags`.** Pure, deterministic, test-first. Wikilinks/tags inside code
fences and inline code DO NOT parse.

**D21. Local history: copy-on-write snapshots** into `.denote/snapshots/` on meaningful
change (debounced), pruned by age/size. Git-based sync arrives in pass 11 and builds on, not
replaces, snapshots.

**D22. Out of scope until post-1.0:** plugins, mobile, collaboration, canvas, publishing.

**D23. All app-originated vault writes go through the repository write API, which tags them
so the watcher can distinguish app writes from external edits.** External edits trigger the
full pipeline; app writes trigger only what their type requires (e.g. an `ai:` frontmatter
write triggers re-index but never re-enrichment — guaranteed by D3a anyway; belt and
suspenders).

**D24. Embeddings run in the Rust core via the `fastembed` crate (bge-small class model,
~100MB, downloaded on first run), exposed as a Tauri command.** Challenged (self-attack):
original plan was ONNX in the webview; rejected for WASM performance and memory pressure in
the UI process. Vectors stored in `.denote/ai/embeddings.bin` + `.idx`, keyed
`relPath + contentHash`.

**D25. Graph renderer sits behind a `GraphView` component contract.** Start with
react-force-graph (canvas 2D, custom paint for hulls); if perf demands, swap to Sigma/WebGL
without touching graph domain code.

**D26. The enrichment pipeline skips:** notes with frontmatter `source: ai` (topic hubs),
files in `_topics/` and `.denote/`, and any note whose contentHash already has annotations
from the same model version.

**D27. Quick capture:** global hotkey opens a floating capture window; grabs current
selection (clipboard/AX) + source URL/title when available; on-device title/tag suggestion;
files into a chosen vault via the repository API.
