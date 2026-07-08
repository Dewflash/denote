# DeNote Master Plan

Owner: Kevin (kevinyongcj). Finalized 2026-07-07. This document is the
single architectural reference. Binding decisions live in `DECISIONS.md`; build order and
status live in `PROGRESS.md`; per-pass instructions live in `passes/`.

## 1. Vision

A local-first, vault-based Markdown notes app for macOS that mirrors Obsidian's core
(vaults = folders of `.md` files, `[[wikilinks]]`, `#tags`, backlinks, graph view) and adds an
AI organization layer that is **free by default** (Apple on-device model + local embeddings)
with an **optional paid tier** (user's own Anthropic API key, hard budget cap).

The defining constraint: **user-created structure and AI-suggested structure are always
distinguishable**, and because most notes will carry no manual categorization beyond their
folder, AI enrichment is the *default* organization path — clearly labeled, reversible, and
never authoritative over user intent.

The flagship capability: a vault-level **topic ontology** the AI builds and maintains. A note
filed under "Japan" that discusses BOJ intervention gets connected to Finance → Banking →
Interest Rates topics that the user never wrote, with canonicalization so topics never
duplicate ("banking" vs "banks"), and cross-note themes (e.g. de-dollarization) emerge as
topics linking notes across folders and vaults.

## 2. Architecture layers

```
┌─ UI (React + Tailwind v4 tokens + Radix) ──────────────────────────┐
│ shell / editor / graph / search / suggestions / insights / settings│
├─ State (Zustand stores; snapshots exposed by repository) ──────────┤
├─ Repository (TS orchestration: all vault mutations, pipelines) ────┤
├─ Domain (pure TS: parser, graph builder, ontology ops, hashing) ───┤
├─ Services (TS: AiClient backends, annotation store, search) ───────┤
├─ Rust core (Tauri commands: fs, watcher, embeddings, keychain) ────┤
└─ Sidecar (Swift: Apple Foundation Models, JSON-RPC over stdio) ────┘
```

Data flow on note save / external change:
```
write or watcher event → hash (D3a) → parse (pure) → update link/tag/search indexes
→ recompute backlinks → debounced, hash-gated AI enrichment job (queue)
→ annotations land in .denote/ai/ → suggestions UI / takeover policy (D9)
→ graph builder consumes indexes + annotations for the selected vault set
```

## 3. Repository layout (source tree)

```
denote/
  src/                      React + TS app
    app/                    shell: layout, routing, command palette, vault rail
    features/
      editor/               CodeMirror 6 setup, live preview, autocomplete
      explorer/             file tree, recent notes, Today view
      graph/                GraphView contract + force-graph renderer, hulls, inspector
      search/               MiniSearch integration, quick switcher
      ai/                   suggestions panel, provenance UI, insights panel
      capture/              paste-capture, global-hotkey capture window
      settings/             all settings pages incl. appearance + AI routing
    domain/                 PURE: types, parser, hashing, graphBuilder, ontology, takeover
    services/               storage, watcher bridge, annotationStore, aiClient/{mock,apple,anthropic},
                            embeddings bridge, searchIndex, keychain bridge
    state/                  Zustand stores
  src-tauri/                Rust: fs commands, notify watcher, fastembed, keychain, sidecar mgmt
  sidecar/apple-ai/         Swift package: Foundation Models JSON-RPC sidecar
  tests/fixtures/           parser + vault fixture corpora
  docs/                     this plan
```

## 4. Vault on-disk format

```
MyVault/
  <user folders and .md notes>          ← the only source of truth
  _topics/Finance.md                    ← optional AI-materialized topic hubs (D8c)
  .denote/
    meta.json                           { schemaVersion, vaultId, createdAt }
    ai/annotations.json                 suggestions: keyed by relPath + contentHash, lifecycle status
    ai/rejections.json                  contentHash-keyed rejection memory (D10)
    ai/topics.json                      the ontology: topics, hierarchy, membership (D14)
    ai/embeddings.bin + embeddings.idx  vectors keyed relPath + contentHash
    cache/index.json                    parsed-index cache — disposable, rebuildable
    snapshots/                          copy-on-write note snapshots (local history)
```

A multi-vault registry lives in app support (not in any vault):
`~/Library/Application Support/DeNote/vaults.json` plus global settings, themes, CSS snippets.

## 5. Core types (canonical shapes; implement in `src/domain/types.ts`)

```ts
type VaultId = string;                      // uuid, stored in .denote/meta.json
type NoteId = `${VaultId}/${string}`;       // vaultId + vault-relative path (D4)

interface NoteFile { vaultId: VaultId; relPath: string; contentHash: string; mtime: number }

interface ParsedNote {
  relPath: string; title: string;           // first H1 → filename fallback
  frontmatter: Record<string, unknown>;     // user frontmatter (ai: block parsed separately)
  aiFrontmatter: AiFrontmatter | null;      // the ai: namespace, if present (D9)
  headings: { depth: number; text: string }[];
  links: WikiLink[];                        // outbound only
  tags: string[];
  warnings: string[];                       // best-effort parser never throws (pass-01 brief)
}
interface WikiLink { targetTitle: string; heading?: string; alias?: string; embed: boolean; offsetStart: number; offsetEnd: number }  // grammar: SPECS S2

// Backlinks: NEVER stored. Map<relPath, {fromPath, link}[]> computed from the link index.

interface AiAnnotation {
  id: string; notePath: string; contentHash: string;
  kind: 'topic' | 'link' | 'tag' | 'summary' | 'alias';
  payload: unknown;                          // per-kind schema in pass 6 brief
  confidence: number;                        // 0..1
  reason: string;                            // human-readable justification — required (D6)
  status: 'suggested' | 'accepted' | 'rejected' | 'applied-provisional';
  model: string; createdAt: string;
}

interface Topic {
  id: string; name: string; aliases: string[];
  parentId: string | null;                   // hierarchy (Finance → Banking)
  relatedIds: string[];
  source: 'user' | 'ai';
  members: { notePath: string; weight: number }[];   // soft multi-membership (D14)
}

interface GraphNode { id: NoteId | `topic:${string}` | `topicmerge:${string}` | `tag:${string}` | `ghost:${string}`;
  type: 'note' | 'topic' | 'topicmerge' | 'tag' | 'ghost'; vaultId?: VaultId }
// tag ids are global (merge across vaults); topicmerge is presentation-only — see SPECS S25
interface GraphEdge {
  id: string; from: string; to: string;
  type: 'wikilink' | 'embed' | 'note-tag' | 'note-topic' | 'topic-topic' | 'ai-similar' | 'manual';
  source: 'user' | 'parser' | 'ai' | 'system';
  weight: number; confidence?: number; reason?: string;
}
```

## 6. AiClient contract (implemented pass 6; backends passes 6/7/9)

```ts
interface AiClient {
  id: 'mock' | 'apple' | 'anthropic';
  capabilities(): Promise<AiCapabilities>;   // maxInputTokens, supportsJson, availability
  summarize(req: { text: string; maxWords: number }): Promise<{ summary: string }>;
  enrichNote(req: {
    text: string; title: string; folderPath: string;
    existingTopics: TopicStub[];             // retrieved by embedding sim + name match
    candidateNotes: NoteStub[];              // top-k retrieved neighbors (summaries, not bodies)
  }): Promise<EnrichResult>;                 // topics (attach-or-create), links, tags, summary — all with reason + confidence
  labelSimilarity(req: { a: NoteStub; b: NoteStub }): Promise<{ related: boolean; reason: string; confidence: number }>;
}
```
Per-task routing table lives in settings (e.g. summarize→apple, deep-organize→anthropic).
Every backend must degrade gracefully: if unavailable, jobs queue; nothing blocks note editing.

## 7. Retrieval funnel (D12) — the cost model

Expensive models never read the vault wholesale. Order: local embeddings retrieve candidates →
on-device model handles per-note work using only that slice → the paid tier (monthly
deep-organize, Batch API, hard budget cap D13) reads summaries + the topic index, drilling
into full text only for flagged notes. Hash-gating (D3) means unchanged notes are never
reprocessed by any tier.

## 8. Grouping and graph presentation (D7)

Two non-contaminating overlays: **semantic** (topic clusters — DEFAULT view) and
**structural** (vault/folder nested hulls — toggle, off by default). AI can never alter
structural grouping; folders can never bias semantic clustering. `_topics` notes are off-graph
by default; node inspector always shows per-connection provenance (user vs parser vs AI, with
reason).

## 9. Risk register (watch these; briefs reference them)

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | AI-write → watcher → re-enrich infinite loop | D3a hash rule + D23 write tagging + idempotent writes |
| R2 | Apple Foundation Models API instability / small context | sidecar `capabilities()` + graceful degrade; llama.cpp fallback documented but NOT pre-built (D11) |
| R3 | Topic sprawl (duplicate near-topics) | canonicalization is mandatory before topic creation (D14) |
| R4 | Garbage similarity edges | two gates: embedding threshold+top-k, then LLM must name shared concept (D6a) |
| R5 | Graph perf at 10k+ nodes | renderer behind GraphView contract; Sigma/WebGL swap possible without touching graph domain code |
| R6 | External edits (Finder, other apps) | watcher reconciliation incl. move detection by contentHash (D4a) |
| R7 | Cloud cost overrun | pre-count tokens, trim batch to budget, Batch API 50% rates (D13) |
| R8 | Privacy leakage of sensitive vaults | per-vault local-only flag enforced at AiClient router level (D18) |

## 10. Out of scope until post-1.0 (D22)

Plugins, mobile, real-time collaboration, canvas/whiteboard, publishing. Do not scaffold for
them beyond keeping the domain layer pure.
