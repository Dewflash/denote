# Exact Specifications

Normative algorithms, grammars, formats, and protocols. Pass briefs reference these sections
(S-numbers). Where pseudocode is given, it is the **reference implementation semantics** —
match its behavior exactly; the listed test vectors are mandatory test cases. Nothing in this
file is a suggestion.

---

## S1. Normalization & contentHash (D3a) — verified by architect, 2026-07-07

**Do NOT implement by parsing and re-serializing YAML.** YAML round-tripping is not
byte-stable (key order, quoting, indentation) and will silently break hash equality. The
strip is **textual, line-based**.

```
normalize(text):
  strip UTF-8 BOM if first char is U+FEFF
  replace /\r\n?/g with "\n"
  unicode-normalize to NFC

stripAiBlock(text):
  t = normalize(text)
  if t does not start with "---\n": return t
  close = index of first subsequent line that is exactly "---" or "..."
  if none: return t                       # unterminated frontmatter = plain body
  fm = lines strictly between delimiters
  start = first fm line matching /^ai:(\s|$)/      # top-level only; "  ai:" never matches
  if none: return t
  end = start
  i = start + 1
  while i < len(fm):
    if fm[i] starts with space or tab: end = i; i++            # indented → in block
    elif fm[i] == "":                                          # blank run lookahead
      j = i; while j < len(fm) and fm[j] == "": j++
      if j < len(fm) and fm[j] starts with space/tab: end = j; i = j+1
      else: break
    else: break
  remaining = fm without lines start..end
  body = lines after closing delimiter, joined with "\n"
  if remaining is all-empty: return body            # fm emptied → drop delimiters entirely
  return "---\n" + remaining joined + "\n---\n" + body

contentHash(text) = sha256_hex(utf8(stripAiBlock(text)))
```

**Mandatory test vectors** (equality means equal hashes):
- V1 bare note == same note with an `ai:`-only frontmatter prepended (this is what makes
  takeover on frontmatter-less notes hash-stable).
- V2 `ai:` block first/middle/last among user keys → all equal.
- V3 changing anything inside the `ai:` block → hash unchanged.
- V4 changing a user frontmatter key → hash changes.
- V5 changing the body → hash changes.
- V6 CRLF file == LF file. V7 NFC == NFD text.
- V8 inline form `ai: {tags: [x]}` stripped like the block form.
- V9 blank line inside the `ai:` block (followed by an indented line) stays in the block.
- V10 a key `aim:` is NOT stripped; a nested `  ai:` under another key is NOT stripped.
- V11 stripAiBlock is idempotent.
- V12 unterminated frontmatter (`---` never closed) is hashed as-is.

`ai` is a **reserved top-level frontmatter key** (D28). If a pre-existing user file already
uses it, the app treats it as AI-owned; imports (pass 11) must warn when incoming files carry
an `ai:` key.

## S2. Wikilink grammar

Token: `!?\[\[ target ( "#" heading )? ( "|" alias )? \]\]` scanned outside code regions (S5).
- Leading `!` ⇒ `embed: true`.
- `target` = text up to first `#` or `|` or `]]`, trimmed; empty target ⇒ not a link.
- `heading` = text between `#` and `|`/`]]`, stored in `WikiLink.heading?` (navigation only —
  resolution ignores it). Block refs `#^xyz` are treated as heading text; no special handling.
- `alias` = everything after the FIRST `|` up to `]]` (aliases may contain `|`).
- No nesting; an unclosed `[[foo` is plain text; `[[a]]b]]` parses `[[a]]` then text.
- Add `heading?: string` to the `WikiLink` type (supersedes MASTERPLAN §5 shape).

## S3. Tag grammar — verified

Regex (unicode mode): `(?<=^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)` with `gmu`.
Consequences (mandatory tests): `#123` is not a tag (needs ≥1 non-digit); `http://x.com/#a`
does not match (preceded by non-space); `# heading` is not a tag; trailing punctuation
excluded; `#nested/tag-2` valid. Tags are stored **lowercased** for identity, original casing
kept for display.

## S4. Link resolution & ghost identity

Resolution of `target` within one vault, in order (first hit wins):
1. exact relPath match, with or without `.md` (case-insensitive) — supports `[[Sub/Note]]`;
2. filename (basename without `.md`) match, case-insensitive;
3. title (first H1) match, case-insensitive.
Ties at any step: shortest relPath, then lexicographic relPath. No hit ⇒ ghost node with id
`ghost:{vaultId}/{lowercased NFC target}` — so `[[Foo]]` and `[[foo]]` share one ghost.
Clicking a ghost creates `{target}.md` in the current folder (verbatim casing of the link).

## S5. Code-region masking (parser)

Build a mask of excluded ranges from remark node positions: fenced code blocks, indented code
blocks, inline code, math (`$…$`, `$$…$$` if math plugin present), HTML blocks. The inline
scanner (S2/S3) skips matches whose start offset falls in a masked range. Never scan the raw
string without the mask.

## S6. Vault-relative paths

Forward slashes only, no leading slash, NFC-normalized, `.md` extension included in relPath.
Comparisons are case-insensitive (APFS default) but stored casing is preserved.

## S7. Atomic writes, concurrency, ordering

- Every vault file write: write to `path + ".denote-tmp"` in the same directory, fsync,
  atomic rename over the target.
- **Per-note mutex** in the repository: all mutations to one relPath are serialized; the
  enrichment applier, takeover writer, and user saves all queue on it (D29).
- One pipeline instance per vault; watcher events are processed in arrival order after
  per-path debounce (300ms).

## S8. App-write tagging protocol (D23)

Before any repository write: record signature `(relPath, contentHash(newContent), now)` in an
in-memory set. On watcher event for a path: compute the file's contentHash; if a signature
matches (same relPath + hash) and is younger than 5s → classify `app-write`, consume the
signature. Otherwise `external`. Signatures expire at 5s. Rapid successive app writes each
push their own signature. A restore/checkout (pass 11) goes through the same API and is
therefore tagged — but is classified `app-write-content-change`, which DOES run the pipeline
exactly once (it changed content the app didn't otherwise process).

## S9. Rename / move refactor rules (D4, D4a)

- Rename (in-app): for every note whose links **resolve to** the renamed note, rewrite the
  link's `target` text: path-form links get the new relPath (no `.md`), filename/title-form
  links get the new basename. `heading` and `alias` parts are preserved verbatim. All
  rewrites + the rename itself are one undo batch and one snapshot each.
- Retitle (H1 change without file rename): NO link rewriting; resolution step 3 simply
  re-resolves. (Links that only matched by old title become ghosts — surface a one-time
  toast offering to update them; the update is the same rewrite mechanism, user-confirmed.)
- Move detection: watcher delete+create within 2s with equal contentHash ⇒ move. Re-key:
  indexes, annotations, embeddings idx, snapshots directory, rejection entries. Links are NOT
  rewritten on a pure move unless resolution used path-form (step 1) — those get the rewrite
  treatment above.

## S10. `ai:` frontmatter schema & takeover state machine (D9)

```yaml
ai:
  v: 1
  tags: [finance, banking]          # provisional tags
  links: ["Banking Policy"]         # provisional wikilink targets (resolution per S4)
  topics: ["topic-id-uuid"]
  applied: "2026-07-07T12:00:00Z"
  model: "apple@fm1"
```
State machine per note:
- `bare` (no user links/tags anywhere in body or user frontmatter) —and— suggestions with
  confidence ≥ threshold (default 0.75) exist ⇒ apply: write `ai:` block (idempotent: skip
  write if the resulting block is byte-identical), annotations → `applied-provisional`.
- Any user structure appears (a wikilink or tag in body, or user `tags:` frontmatter) ⇒
  demote: remove the entire `ai:` block, all `applied-provisional` annotations →
  `suggested`. **Accepting a suggestion counts as user structure** — one accept therefore
  demotes remaining provisional entries back to the panel. This is intended (user is now
  curating); implement exactly this.
- Rejected entries (D10) are never auto-applied.
Editor rendering: provisional tags/links from `ai:` render in muted/dashed style with an
"AI" affordance; they are NOT part of the body text.

## S11. Rejection fingerprint (D10)

`sha256(kind + "\x1f" + normalizedTarget)` where normalizedTarget = lowercase NFC of: topic
name (topic), resolved target relPath or raw target (link), tag name (tag), first 64 chars of
summary (summary), alias name (alias). Stored with the contentHash it was rejected against; a suggestion is
suppressed iff (fingerprint, contentHash) matches — content edits give suggestions a new
chance, identical content never re-asks.

## S12. Enrichment job queue

Keyed by (vaultId, relPath): at most one pending job per note, newest contentHash replaces
older pending entries. States: `pending → running → done | parked(error, attempts)`. Retry
backoff 5s/30s/2m, then parked with badge. Persisted to `.denote/cache/queue.json` on change
and on quit; on startup, `running` entries revert to `pending`. Skip rules per D26 evaluated
at dequeue time (not enqueue), so stale jobs self-cancel.

## S13. Apple sidecar protocol (D11)

Transport: child process, **NDJSON** — one JSON object per line on stdin/stdout (no
Content-Length framing). Requests `{id, method, params}`; responses `{id, result}` or
`{id, error: {code, message}}`. stderr = logs only.
Methods: `capabilities() → {available: bool, reason?: string, maxInputTokens: number,
supportsGuidedJson: bool, modelVersion: string}` · `summarize({text, maxWords})` ·
`enrichNote({text, title, folderPath, existingTopics, candidateNotes})` ·
`labelSimilarity({a, b})` — param/result shapes mirror the AiClient contract.
Rules: 30s timeout per call (Rust side kills + returns typed timeout error); malformed JSON
line from sidecar ⇒ log + drop; sidecar crash ⇒ restart, max 3 restarts/min then backend
marked unavailable until app restart or manual retry; app quit kills the process group.
Guided/structured generation used for all JSON outputs; on schema-invalid output, ONE repair
retry (re-prompt with the validation error), then park the job.

## S14. Embedding store format (D24)

Model: `intfloat/multilingual-e5-small` via fastembed (`MultilingualE5Small`, 384 dims) —
multilingual chosen deliberately (owner's vaults may contain non-English content); if
fastembed lacks it at implementation time, fall back to `BGESmallENV15` and log the
deviation in PROGRESS. `embeddings.bin`: header `DENV` (4 bytes) + u32 version(1) + u32 dim
+ u32 rowCount, then rows of f32 little-endian, row-major. `embeddings.idx` (JSON):
`{version, model, dim, rows: [{row, relPath, contentHash} ...], free: [rowNumbers]}` —
`model` is the exact model id; on mismatch at load (model changed), the entire store is
invalid: discard and re-embed everything. Never mix vectors from different models. New vectors fill `free` slots first,
else append. Deleting marks the row free. Compact (rewrite both files) when
`free.length > 0.25 * rowCount`. All writes atomic per S7. Vectors are L2-normalized at write
time so similarity = dot product.

## S15. Similarity pipeline parameters (D6a)

Per changed note: query topK (k=3 default, settings 1–10) with cosine ≥ 0.62 (settings
0.4–0.9). Deduplicate unordered pairs — an edge (a,b) exists once; re-labeling only when
either endpoint's contentHash changed. `labelSimilarity` accept iff `related === true` AND
reason passes the vacuity gate: length ≥ 15 chars AND not matching the denylist
(case-insensitive substrings: "both are notes", "similar writing", "same language", "both
discuss topics", "related content"). Failed pairs recorded (pair + both hashes) so they are
not re-asked until content changes.

**Edge ownership:** an accepted similar-pair within one vault is stored as an annotation
owned by the lexicographically smaller relPath (payload carries the other endpoint);
graphBuilder treats pairs as unordered. Failed pairs go to `.denote/ai/rejections.json`
under a `similarityPairs` key (pair + both hashes). **Cross-vault pairs never touch either
vault's `.denote/`** — they live app-side (S24) so vaults stay self-contained and portable.

## S16. On-device token budgeting

Estimate tokens = ceil(chars / 3.5). For `enrichNote` against a model reporting
`maxInputTokens = M`: reserve 15% for instructions/schema; allocate remaining budget 50% note
body / 25% existingTopics stubs / 25% candidate summaries. Body truncation strategy: keep
frontmatter title + all headings + first 60% of the budget from the top + last 20% from the
bottom, with `\n[…truncated…]\n` marker. Topic stubs: name + ≤20-word description + top 3
member titles. Candidates: title + ≤50-word summary each; drop lowest-similarity candidates
first when over budget.

## S17. Ontology details (D14)

- Topic embedding (centroid) = embedding of the string `"{name} — {description}"`,
  recomputed when name/description change. Attach threshold 0.80; merge-sweep threshold 0.92
  + LLM confirmation.
- Membership weight = clamp01(enrichment confidence + 0.1 folder-co-location bonus + 0.05
  per reconfirmation, max 3). Dominant topic for coloring = max weight; tie → lexicographic
  topic name. Topic color = palette[fnv1a(topicId) % palette.length] from the theme's graph
  palette.
- On note content change: memberships for that note enter `stale: true` until the next
  enrichment confirms or drops them; stale memberships render at reduced opacity.

## S18. `_topics/` file template (byte-stable)

```markdown
---
source: ai
topic_id: {uuid}
generated_hash: {sha256 of rendered body}
---
# {Topic Name}

{description}

**Parent:** [[_topics/{Parent Name}]]        ← line omitted if no parent
**Related:** [[_topics/{A}]], [[_topics/{B}]] ← sorted by name; omitted if none

## Notes
- [[{note title}]] — {one-line reason}       ← sorted by weight desc, then relPath asc
```
No timestamps anywhere in the file. Regenerate only when the rendered body differs.
Freeze rule: before regenerating, compare the file's current contentHash to the stored
`generated_hash` lineage in topics.json; mismatch ⇒ user edited ⇒ set frontmatter
`source: user-modified` once and never regenerate again.

## S19. Pricing constants (pass 9)

All API prices live in ONE module (`services/aiClient/pricing.ts`) with a `verifiedAt` date.
The implementing agent MUST verify values against live Anthropic docs at implementation time
(prices drift) and set `verifiedAt`. Budget gate uses `estimate * 1.2` safety margin against
the cap; the ledger records actuals from response `usage` and reconciles.

## S20. Typed error taxonomy

`DenoteError` union used across services: `{kind: 'fs' | 'parse' | 'ai-unavailable' |
'ai-timeout' | 'ai-invalid-output' | 'budget-exceeded' | 'local-only-blocked' | 'conflict' |
'corrupt-store', path?, detail, retryable: bool}`. UI maps kinds to surfaces (badge, toast,
parked-jobs panel). Never throw raw strings across a service boundary.

## S21. Keymap registry (defaults; all rebindable in Settings → Hotkeys)

One module owns all bindings; passes register into it — no scattered literals.
`cmd-N` new note · `cmd-O` quick switcher · `cmd-P` command palette · `cmd-E` reading view ·
`cmd-T` Today view · `cmd-shift-F` search · `cmd-,` settings · `cmd-shift-N` GLOBAL capture
(system-wide) · `cmd-G` graph view · `cmd-Z` undo (see S23). Registering a duplicate binding
is a build-time error (unit test over the registry).

## S22. Filesystem containment (security — D33)

Every Rust command that touches a path MUST: canonicalize the input path (resolving
symlinks), canonicalize the registered vault roots, and verify the canonical path is inside
a registered root; otherwise return `fs`-kind error. This is the defense against path
traversal and symlink escape — the webview must be physically unable to read or write
outside vault roots (plus the app-support dir via separate, equally-guarded commands).
Never expose a generic `read_file(path)` command. Watcher shares the ignore set with
`list_vault_files` (`.denote/`, `.git/`, dotfiles) — events under ignored paths are dropped
in Rust before reaching the frontend.

## S23. Open-buffer writes & the undo model (D34, D38) — race-prone; read twice

Two undo systems exist and must not be blended naively:
- **Typing** = CodeMirror history (cmd-Z inside the editor).
- **Structural ops** (accept suggestion, takeover apply/demote, rename refactor, restore
  snapshot) = a repository op-log with inverse operations; repository-level undo pops the
  op-log (also bound to cmd-Z when editor is not focused, and to a toast "Undo" action).

Rules for background writes to a note that is OPEN in the editor:
1. If the buffer is clean (saved): apply the change as a CodeMirror transaction (so the view
   updates in place), tagged as remote (excluded from CM's typing history), and record the
   inverse in the op-log.
2. If the buffer is dirty (unsaved keystrokes): DEFER the write — takeover/AI writes wait
   until the buffer is saved and idle ≥2s, then re-check preconditions (hash may have
   changed; if so, drop the deferred write and let the pipeline re-run). Never clobber
   unsaved user input. This deferral is mandatory; it prevents the classic
   background-write-vs-typing race.
3. External (watcher) changes to a dirty open buffer: keep the user's buffer, surface a
   non-modal conflict bar (keep mine / take disk / view both as `Note (conflict …).md`).
   Never silently merge.

## S24. Cross-vault AI store (app support)

`~/Library/Application Support/DeNote/crossvault.json` — versioned; holds ai-similar pair
edges whose endpoints are in different vaults `{aVaultId, aRelPath, bVaultId, bRelPath,
reason, confidence, hashes}` and their rejection records. Presentation-layer topic merging
(S25) is computed at graph time and never stored. If a referenced vault is closed/missing,
its cross-vault edges are simply not rendered (kept in file until the vault is deleted from
the registry).

## S25. Combined-graph identity merging (multi-vault view)

- **Tags:** same lowercased tag name across vaults renders as ONE hub node
  (id `tag:{name}`); inspector lists per-vault member counts.
- **Topics:** ontologies are strictly per-vault (portability). In combined view, topics from
  different vaults merge VISUALLY into one node when exact case-insensitive name match OR
  centroid cosine ≥ 0.92 (id `topicmerge:{lowercased name}`); the merge is presentation-only
  — no data is written, and the inspector shows the constituent per-vault topics. Semantic
  clustering in combined view colors by merged topic.
- **Notes and ghosts:** never merge across vaults.

## S26. Store versioning & assets

- Every JSON file the app owns (`annotations.json`, `rejections.json`, `topics.json`,
  `queue.json`, `vaults.json`, `settings.json`, `spend.json`, `crossvault.json`) carries a
  top-level `version: 1`. Pass-10's migration scaffold dispatches per file+version.
  Global app settings live at `~/Library/Application Support/DeNote/settings.json`.
- **Assets** = non-`.md` files in a vault (images, PDFs): indexed by path for embed
  resolution (S4 steps 1–2 only), rendered read-only in the editor for image embeds
  (`![[img.png]]`), never hashed into the note pipeline, never sent to any AI backend,
  excluded from search body indexing (filename searchable).
- Search indexes both user and provisional (`ai:`) tags; results and tag pickers show a
  provenance badge on provisional ones.
- Rejections pruning: entries whose note was deleted ≥30 days ago, or older than 180 days,
  are dropped during Organize-vault runs.
- Note dates for timelines/insights: `created` = frontmatter `created`/`date` if parseable,
  else file birthtime; `edited` = mtime. Document this precedence in one util.

## S27. Cloud job durability & unified spend ledger

- EVERY Anthropic-backend call (deep-organize batches AND on-demand insights) records to
  `spend.json` and respects the monthly cap — there is no uncapped path to the paid backend.
- Batch jobs persist `{batchId, submittedAt, estimatedCost, custom_id manifest}` BEFORE
  submission. Batches take up to 24h; the app must resume polling on next launch for any
  non-terminal persisted batch and reconcile actual usage into the ledger. A batch whose
  results are fetched is marked terminal; unfetched-but-expired batches are logged as losses
  (visible in the spend UI) — money must never disappear silently.
- Local estimate (chars/3.5) is used for corpus trimming; `count_tokens` verifies the final
  assembled batch before submission (free endpoint; still respects the 1.2× margin, S19).
- Corpus assembly excludes localOnly vaults entirely (D18) — enforced in the assembler, not
  just the router (defense in depth).

## S28. First-run takeover consent (trust gate — D35)

The first time takeover (D9/S10) would apply provisional structure to more than 20 notes in
a vault (typical after import or first enrichment of an existing vault), it pauses and asks
once: "DeNote's AI can annotate N uncategorized notes with provisional tags/links (stored in
an `ai:` metadata block, reversible, clearly marked). Apply?" — options: apply all / apply
none (stay suggestions-only) / always ask. The answer is a per-vault setting. Below the
20-note threshold, takeover proceeds silently as specced. Bulk demotion never asks (removing
AI data is always safe).
