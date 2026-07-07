# Pass 07 — Local intelligence: embeddings, Apple sidecar, real enrichment

## Objective
The free tier becomes real: Rust embeddings + Apple Foundation Models sidecar power
enrichment, similarity edges, and paste-summarize — fully offline, $0.

## Deliverables
- **Embeddings (D24):** `fastembed` in `src-tauri` (bge-small class). Model files downloaded
  on first use to app support with progress UI + retry; never bundled in the binary.
  Commands: `embed_texts(texts) -> vectors`, batched. Store per vault:
  `.denote/ai/embeddings.bin` (f32 rows) + `embeddings.idx` (json: relPath, contentHash, row).
  Incremental: only changed hashes re-embed. Register D4a re-key hook.
- Similarity retrieval: brute-force cosine over in-memory matrix (fine ≤10k notes; exact-NN
  library only if profiling demands). API: `topK(notePath, k, minCos)`.
- **Apple sidecar (D11):** Swift executable in `sidecar/apple-ai/`, spawned/supervised by the
  Rust core (restart on crash, max 3/min then degrade). Protocol: JSON-RPC 2.0 over stdio;
  methods `capabilities`, `summarize`, `enrichNote`, `labelSimilarity` mirroring AiClient.
  `capabilities` reports availability (Apple Intelligence enabled? model ready?) and
  maxInputTokens — router treats unavailable as "queue + surface a one-line notice", never an
  error dialog.
  - Foundation Models context is SMALL: every prompt must budget tokens — truncate note body
    intelligently (headings + first/last chunks), summaries not bodies for candidates.
  - Use the framework's structured/guided generation for JSON output; validate + one repair
    retry on malformed output, then park the job.
- `aiClient/apple.ts` backend wired into the router; default routing flips: summarize/enrich/
  labelSimilarity → apple (mock remains for tests).
- **ai-similar edges (D6a):** pipeline = embeddings topK (k=3, cos ≥ 0.62 default; settings
  sliders) → `labelSimilarity` on-device → only `related: true` with non-vacuous reason
  becomes an annotation (kind `link`, subtype similar) → graph shows it as ai edge with
  reason on hover. Cross-vault allowed among open non-localOnly vaults (D17/D18).
- **Paste-summarize (D27 partial):** on paste-to-capture ≥ ~800 chars, generate summary +
  title + tag suggestions on-device; capture UI shows them inline (model picker dropdown
  showing routing default).

## Pitfalls
- Sidecar lifecycle: kill on app quit (no orphans); handle macOS denying Apple Intelligence
  (capabilities → unavailable) — the app must remain fully usable, jobs queued.
- Embedding + enrichment are queue consumers — respect pass-06 gating; embedding a 3k-note
  vault on first open must run chunked in background with progress, UI responsive.
- Do NOT build the llama.cpp fallback (D11). If Apple path is unusable, mark pass `blocked`
  with findings.
- Similarity reasons: reject generic labels — add a denylist test ("both are notes", "similar
  writing style", length < 15 chars → drop edge).

## Definition of Done
Offline demo on a real vault (~100 notes): first-open embeds with progress; new note about a
topic overlapping an old note → ai-similar edge with a specific stated reason appears in
graph; suggestions panel populated by Apple backend; paste-capture summarizes on-device;
airplane-mode: everything above still works. R1 loop test still green with real backend.
