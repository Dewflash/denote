# Pass 09 — Cloud tier: Anthropic backend, deep-organize, budget cap, deep insights

## Objective
The paid 15%: BYO-key Anthropic backend, a monthly (or on-demand) deep-organize batch job
that does the reasoning the on-device model can't, and LLM-synthesized insights — all under a
hard, code-enforced budget cap.

## Normative specs for this pass
SPECS **S19** (single pricing module, verifiedAt, 1.2× safety margin), **S20** (error kinds
`budget-exceeded`, `local-only-blocked`), **S27** (batch durability: persist batchId BEFORE
submission, resume polling across app restarts, reconcile actuals, expired-batch losses
visible; unified ledger covers on-demand insights too — no uncapped path exists; corpus
assembler itself excludes localOnly vaults, not just the router).

## Read first
The `claude-api` skill / current Anthropic docs — model IDs, Batch API, prompt caching, and
`count_tokens` shapes drift; verify against live docs, do not code from memory.

## Deliverables
- `aiClient/anthropic.ts` implementing AiClient via `@anthropic-ai/sdk`. Default model
  `claude-opus-4-8` for deep tasks; routing table exposes model choice per task (opus/
  sonnet/haiku tiers). Structured JSON via `output_config.format`. Streaming for long calls.
- **Keychain (D13):** API key stored via macOS Keychain (Rust `security-framework` command);
  never in files/settings JSON; settings shows presence + "test key" button only.
- **D18 recheck:** router already blocks localOnly vaults from network backends — add an
  integration test targeting the anthropic backend specifically.
- **Deep-organize job (D12/D13):** on-demand + optional monthly schedule. Stages:
  1. Assemble corpus: per-note summaries (on-device, cached), topic index, folder manifest,
     staleness list. NEVER raw whole-vault text.
  2. Pre-flight budget: `count_tokens` on assembled batches; estimate cost (input+output at
     Batch API rates); trim lowest-priority items to fit `min(remaining monthly budget, per-run cap)`;
     show the user the estimate + item count; require confirm on first run of each month.
  3. Submit via **Batch API** (50% rates). Poll; results keyed by custom_id = notePath/topicId.
  4. Outputs land as ordinary annotations (suggested) + ontology proposals (canonicalization
     still applies — cloud output gets NO bypass) + cross-note theme topics (the
     de-dollarization case: themes spanning folders/vaults with reasons citing member notes).
  5. Spend ledger: `~/Library/Application Support/DeNote/spend.json` — per-run actuals from
     response usage; monthly cap (default $10, settings) blocks submission when exceeded.
- **Deep insights (Analysis slot from pass 8):** for a topic node, on-demand synthesis over
  member summaries ordered by time: stance evolution, rising/fading themes, contradictions
  (cite note pairs), open questions. Rendered with links to cited notes + "AI analysis of
  YOUR notes" framing. NO market/predictive claims — analysis of the user's own thinking
  only; phrase outputs as "your notes suggest/if your notes are right".
- Prompt caching: stable system prompts + topic index as cached prefix where call shape
  repeats.

## Pitfalls
- Budget enforcement is a hard gate in code, not a UI hint: submission path must be
  physically unable to exceed the cap (assert + test).
- Batch results are unordered — match by custom_id only.
- Key absent / network down: cloud tasks queue with a clear badge; nothing else degrades.
- Deep-organize outputs are SUGGESTIONS — takeover policy (D9) applies to them identically;
  cloud provenance shown (model badge) in every surface.
- Respect rejection memory (D10) when assembling the corpus: don't pay to re-ask rejected
  questions.

## Carried-in work (checkpoint C directive)
Wire **S24 cross-vault ai-similar pairs** (deferred from pass 07, flagged in its deviations):
app-support `crossvault.json` store + cross-engine topK across open non-localOnly vaults.
`domain/similarity.ts` already computes `isCrossVault` and vault-scoped pair identity — the
gates need no rework. Cross-vault pairs render in combined graphs only. This pass also owns
cross-note THEMES (deep-organize), so the storage lands here where it's first consumed.

## Owner input
This pass needs the owner's Anthropic API key for final verification — entered BY THE OWNER
in Settings → AI (Keychain); never request it in chat, never place it in files or env vars
committed anywhere. Build and test everything against the mock first; when only key-gated
verification remains, mark `awaiting-owner` in PROGRESS (Owner inputs) with the exact steps
the owner should run, and finish the rest of the pass.

## Definition of Done
With a real key on a test vault: deep-organize estimates → confirms → runs under cap →
theme topic spanning two folders appears with cited reasons; spend ledger matches response
usage; cap exhaustion blocks with clear message; topic Analysis renders with citations;
localOnly vault never touches the network (test); airplane mode degrades gracefully.
