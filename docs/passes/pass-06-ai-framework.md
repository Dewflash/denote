# Pass 06 — AI framework: AiClient, mock, annotations, lifecycle, takeover

## Objective
The complete AI plumbing and UX with a MOCK backend only. When this pass ends, the entire
suggestion → accept/reject → promotion/demotion loop works end-to-end with fake AI; passes
7–9 only swap in real intelligence.

## Normative specs for this pass
SPECS **S10** (`ai:` frontmatter schema + takeover/demotion state machine — includes the
non-obvious rule that accepting one suggestion demotes the rest, D30), **S11** (rejection
fingerprint formula), **S12** (queue semantics + persistence), **S20** (error taxonomy).

## Deliverables
- `services/aiClient/` — the `AiClient` interface exactly as MASTERPLAN §6, plus:
  - `router.ts`: per-task routing table (from settings) + **D18 enforcement**: if the note's
    vault is localOnly, network backends are refused at the router (throw typed error), no
    exceptions.
  - `mock.ts`: deterministic fake backend (seeded by contentHash) producing plausible topics,
    links, tags, summaries with varied confidences and reasons — good enough to exercise
    every UI state.
- `services/annotationStore.ts`: read/write `.denote/ai/annotations.json` + `rejections.json`
  (D3, D10). Registers the pass-02 re-keying hook (D4a) so moves remap annotations. Writes go
  through the repository (D23).
- Enrichment job queue: debounced (2s after last edit), hash-gated (D3a, D26 skip rules),
  serialized per note, survives app restart (queue snapshot in `.denote/cache/`). Never
  blocks editing; failures retry with backoff then park with a visible badge.
- Per-kind payload schemas (document in code):
  `topic {name, existingTopicId|null}` · `link {targetPath, span?}` · `tag {name}` ·
  `summary {text}` · `alias {name}` — all with `reason`, `confidence` (D6/D6a).
- Suggestions panel (right sidebar, third tab): grouped by kind; each row shows reason +
  confidence + model badge; actions Accept / Reject / Accept-all-above-threshold.
  - Accept: writes the real wikilink (appended to a `## Related` section at note end unless a
    span is given), tag (frontmatter `tags:`), etc. — via repository; annotation → `accepted`.
  - Reject: → rejection memory (D10).
- **Takeover policy live (D9):** `domain/takeover.ts` decisions applied by the repository —
  provisional entries written to the `ai:` frontmatter block; editor renders provisional
  tags/links in softer styling with a "AI-provisional" affordance; user adding own structure
  demotes (removes `ai:` entries back to suggestions). Idempotent writes: never rewrite an
  identical `ai:` block.
- Settings → AI & Models page v1: routing table UI (backends: Mock, Apple [disabled,
  "pass 7"], Anthropic [disabled, "pass 9"]), takeover threshold slider, per-vault localOnly
  toggles surfaced here too.

## Pitfalls
- **R1 lives here.** Prove with an integration test: enrichment → takeover writes `ai:` block
  → watcher event → classified app-write → contentHash unchanged (D3a) → NO re-enrichment.
- Rejection fingerprint = kind + normalized payload target (so a reworded reason doesn't
  resurrect a rejected suggestion).
- Accept must be undoable (single undo step restores body AND annotation status).
- Model version in annotations: mock is `mock@1`; hash-gating keys include model id so
  upgrading a backend re-enriches naturally (D26).

## Definition of Done
End-to-end with mock: edit note → suggestions appear ≤3s → accept writes markdown → reject
never returns for same content → empty note gets provisional `ai:` structure → adding a real
tag demotes it → R1 loop test green → localOnly vault produces zero router calls to
network-class backends (mock counts as local).
