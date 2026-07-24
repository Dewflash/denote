# Obsidian-Parity Core — Design & Implementation Reference

This document describes the complete design of a local-first, vault-based Markdown
knowledge system (Obsidian-class): vaults as plain folders, `[[wikilinks]]`, `#tags`,
backlinks, live-preview editing, file watching, rename refactoring, local history,
full-text search, and a graph view — plus the desktop-shell security model (Tauri).
It is self-contained: everything needed to re-implement the system in another codebase
is inlined, including exact grammars, algorithms, test vectors, and — most importantly —
the *failure modes each non-obvious choice avoids*. The AI layer that sits on top of this
core is out of scope here; it is mentioned only where its existence shaped a core
mechanism (one reserved frontmatter key and one hashing rule).

Reference stack (swappable): Tauri 2 + React + TypeScript frontend; Rust core for
filesystem, watching, and security; CodeMirror 6 editor; unified/remark for Markdown
block parsing; MiniSearch for full-text search; Zustand for state. The *architecture*
below does not depend on these choices except where noted.

---

## 1. Core philosophy

Three rules govern everything:

1. **Files are the only source of truth.** A vault is a real folder of `.md` files.
   Notes must open cleanly in any editor. There is no app-internal note database, ever.
2. **Everything else is derived and rebuildable.** Link index, backlinks, search index,
   graph, file tree — all tier-2 caches computed from the file bytes. None of them is
   ever authoritative. The acceptance test is literal: delete the app's cache directory
   while the app is running and nothing is lost — every index rebuilds from the files.
3. **Never store derived data as truth.** The moment backlinks (or any index) get
   persisted authoritatively, an external edit (Finder, another app, git checkout)
   silently corrupts them. Backlinks in particular are *always* computed from the
   forward-link index, never written anywhere.

Why this is load-bearing: users edit vaults with other tools. Any persisted derived
state is a second source of truth that will drift. The design accepts the cost
(recompute on load) to get the guarantee (external edits can never corrupt state).

---

## 2. On-disk model

### Vault layout

```
MyVault/
  <user folders and .md notes>       ← the only source of truth
  .denote/                           ← app-owned; rename to taste (.myapp/)
    meta.json                        { schemaVersion: 1, vaultId: "<uuid>", createdAt: ISO }
    snapshots/<relPath>/<epochMs>.md copy-on-write local history (section 10.2)
    cache/                           disposable queues/caches — deletable at any time
```

Rules:

- `meta.json` is created on first open: generate a UUID `vaultId`, write it. If the file
  is corrupt on a later open, quarantine it (`meta.json.corrupt-<ts>`) and mint a new id —
  the Markdown files remain the source of truth; the id is only an identity handle.
- **Deleting everything under `.denote/` except `meta.json` must be lossless** (and even
  losing `meta.json` costs only the stable vault identity, not any note content).
- A multi-vault registry lives in OS app support (e.g.
  `~/Library/Application Support/<App>/vaults.json`), never inside any vault, so a vault
  folder is fully self-contained and portable on its own.

### Note identity

```ts
type VaultId = string;                 // uuid from meta.json
type NoteId  = `${VaultId}/${string}`; // vaultId + vault-relative path
```

Note identity is **vaultId + relative path**. No UUIDs are injected into files (that
would violate "readable in any editor" and make external tooling hostile). The costs of
path-identity — rename and external move — are handled by explicit machinery
(sections 5 and 7.3).

### Path rules (subtle, load-bearing)

- Vault-relative paths: forward slashes, no leading slash, `.md` extension included.
- **Store path bytes exactly as the filesystem reports them. Never rewrite their unicode
  normalization for filesystem access.** A blanket NFC-rewrite looks harmless but breaks
  file access on normalization-sensitive volumes (a file created with NFD bytes is not
  found by its NFC name on some filesystems).
- All *comparisons* (link resolution, identity checks) fold both sides: NFC-normalize +
  lowercase. This also covers APFS case-insensitivity. Stored casing is preserved for
  display.

### Note format

Plain Markdown with optional YAML frontmatter:

```markdown
---
title: anything the user wants
tags: [a, b]
created: 2026-01-01
---
# First H1 becomes the display title

Body with [[Wikilinks]] and #tags.
```

One frontmatter key is **reserved for the machine**: a single top-level namespace key
(here `ai:`) that the app may write and that is *excluded from content hashing*
(section 6). Even if you have no AI layer, reserve such a namespace up front if any
component will ever write machine-generated metadata into notes — retrofitting the
hashing exclusion later is painful. Imports should warn when incoming files already
carry the reserved key.

### Assets

Non-`.md` files (images, PDFs) are indexed **by path only** for embed resolution,
rendered read-only in the editor (`![[img.png]]`), never content-hashed, and excluded
from body search indexing (filename remains searchable).

---

## 3. Parsing

Architecture: **unified/remark for block structure** (headings, code regions,
frontmatter extents) **plus a custom inline scanner** for wikilinks and tags. The parser
is pure, deterministic, and *never throws* — malformed input produces a best-effort
result plus `warnings: string[]`.

### 3.1 Output shape

```ts
interface ParsedNote {
  relPath: string;
  title: string;                        // first H1 → filename (basename minus .md) fallback
  frontmatter: Record<string, unknown>; // user frontmatter (reserved key split out)
  headings: { depth: number; text: string }[];
  links: WikiLink[];                    // outbound only
  tags: string[];                       // display casing, deduped case-insensitively
  warnings: string[];
  bodyText: string;                     // plain-text body (frontmatter excluded), for search
}

interface WikiLink {
  targetTitle: string;
  heading?: string;                     // navigation only; ignored by resolution
  alias?: string;
  embed: boolean;                       // leading '!'
  offsetStart: number;                  // char offsets of the whole token in normalized text
  offsetEnd: number;                    // (load-bearing: rename rewriting splices by offset)
}
```

Frontmatter parsing: first top-level YAML block only. If YAML parse fails → warning,
empty frontmatter. If the document is not a mapping → warning, ignored. The reserved
key is deleted from the user map and parsed separately.

### 3.2 Code-region masking (do this first)

Build a mask of excluded ranges from the remark tree's node positions: fenced code
blocks, indented code blocks, inline code, HTML blocks, and the YAML frontmatter region
itself (never scan frontmatter for links/tags). If a math plugin is present, mask
`$…$` / `$$…$$` too. The inline scanners skip any match whose **start offset** falls in
a masked range. Never scan the raw string without the mask — `[[x]]` inside a code fence
must not become a link.

### 3.3 Wikilink grammar

Token: `!?[[ target ( "#" heading )? ( "|" alias )? ]]`, scanned outside masked regions.

- Leading `!` ⇒ `embed: true`. The token's start offset includes the `!`.
- `target` = text up to the first `#` or `|` or `]]`, trimmed. **Empty target ⇒ not a
  link** (`[[]]`, `[[#h]]`, `[[|a]]` are plain text).
- `heading` = text between `#` and `|`/`]]`. Stored for navigation only — **resolution
  ignores it**. Block refs (`#^xyz`) are treated as heading text; no special handling.
- `alias` = everything after the FIRST `|` up to `]]` — aliases may themselves contain
  `|` and `#`.
- No nesting. An unclosed `[[foo` is plain text. `[[a]]b]]` parses `[[a]]` then plain
  text — which is why the scanner is a **manual index-based loop, not one big regex**:

```
scanWikiLinks(text, mask):
  i = 0
  loop:
    open = text.indexOf("[[", i);        if none: stop
    embed = (text[open-1] == '!')
    tokenStart = embed ? open-1 : open
    if masked(tokenStart): i = open+2; continue
    close = text.indexOf("]]", open+2);  if none: stop   # unclosed → plain text
    parse inner = text[open+2 .. close]  # target/#heading/|alias split as above
    if target nonempty: emit link {offsets: tokenStart .. close+2}
    i = close + 2
```

### 3.4 Tag grammar

Exact regex (JavaScript, flags `gmu`; capture group 1 = tag name without `#`):

```
(?<=^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)
```

Mandatory consequences (make these unit tests):

- `#123` is **not** a tag (needs at least one non-digit character);
- `http://x.com/#a` does not match (the `#` is preceded by a non-space);
- `# heading` is not a tag (space after `#`);
- trailing punctuation is excluded (`#tag.` captures `tag`);
- `#nested/tag-2` is valid (nested tags with `/`, hyphens, underscores).

Tags are **lowercased for identity** (dedup, hub-node ids, search filters), with
original casing kept for display. Export this one regex and reuse it in the editor's
live-preview decorations — never duplicate the grammar.

### 3.5 Title

`title` = text of the first depth-1 heading, else the filename without `.md`. This
matters because titles participate in link resolution (step 3 below).

---

## 4. Link resolution, link index, backlinks

### 4.1 Resolution

Resolution is **vault-scoped** (a link never resolves into another vault). All
comparisons fold NFC + lowercase. For a link `target`, in order — first step with any
hit wins:

1. **Exact relPath match**, with or without `.md` (supports `[[Sub/Note]]`).
2. **Filename match**: basename without `.md`.
3. **Title match**: first H1.

Ties *within* a step: shortest relPath wins, then lexicographic relPath. (Deterministic
ambiguity handling; do not prompt.)

No hit ⇒ **ghost**: a first-class node identity
`ghost:{vaultId}/{lowercased NFC target}` — the folding means `[[Foo]]` and `[[foo]]`
share one ghost. Clicking a ghost creates `{target}.md` (verbatim casing of the link
text) in the folder of the currently open note, seeded with `# {target}\n`, and opens
it. Ghost creation must tolerate a lost race (file appeared meanwhile → just open it).

```ts
type LinkResolution =
  | { kind: 'note'; relPath: string; matchType: 'path' | 'filename' | 'title' }
  | { kind: 'ghost'; id: `ghost:${string}` };
```

`matchType` is recorded because rename/move rewriting needs it (section 5).

### 4.2 Link index and backlinks

The link index is simply *every outbound link of every note, resolved*:

```ts
interface ResolvedLink { fromPath: string; link: WikiLink; resolution: LinkResolution }
```

**Backlinks are a pure reversal of this index and are never stored anywhere:**

```ts
// target relPath → inbound links; ghosts produce no backlinks.
function computeBacklinks(index: ResolvedLink[]): Map<string, {fromPath, link}[]>
```

Sort each backlink list (fromPath, then link offset) for deterministic UI. Rebuilding
the whole index is O(total links) and is done after *every* note-set mutation; at
personal-vault scale (thousands of notes) this is milliseconds and not worth
incrementalizing. The in-memory vault index holds: `notes: Map<relPath, ParsedNote>`,
`hashes`, `mtimes`, `btimes` (first-seen creation time, preserved across edits and
carried across renames), `assets`, `folders: Set<string>` (so empty folders survive
reload), plus the derived `linkIndex` and `backlinks`.

---

## 5. Rename / move machinery

Because identity is the path, rename is a **refactor**, not a metadata update.

### 5.1 In-app rename (basename changes)

For every note whose links currently **resolve to** the renamed note, rewrite the link's
target text in the source file:

- links that matched by **path** (step 1) get the new relPath (without `.md`);
- links that matched by **filename or title** get the new basename.
- `!`, `#heading`, and `|alias` parts are preserved **verbatim** — reconstruct the token
  as `{!}[[{newTarget}{#heading}{|alias}]]` and splice it over `offsetStart..offsetEnd`.
- Apply edits within one file **highest-offset-first** so earlier offsets stay valid.
- Skip self-links (the renamed file itself was re-read/re-indexed already).
- Capture the inbound-resolved list **before** performing the rename (afterwards the
  old target no longer resolves).

The rename plus all rewrites form **one undo unit** on the structural-ops undo stack
(section 8.5), and each rewritten file gets a history snapshot.

### 5.2 In-app move (folder changes, basename stays)

Same mechanism, but rewrite **only path-form** inbound links. Filename/title links
still resolve unchanged — touching them would churn files for no reason.

### 5.3 Retitle (H1 change, no file rename)

**No rewriting.** Resolution step 3 simply re-resolves on the next index rebuild. Links
that only matched by the old title become ghosts; surface a one-time toast offering to
update them (same rewrite mechanism, user-confirmed). Silent rewriting on retitle is
wrong: typing in an H1 would trigger cascading writes mid-keystroke.

### 5.4 External move detection (Finder drag)

The watcher reports an external move as separate delete + create events, in either
order. Reconcile by **content hash**:

- On delete: stash `(hash, relPath, inboundLinks)` in a pending-deletes map.
- On create: hash the new file; a pending delete with equal hash within a **2 s window**
  (and a different path) ⇒ it's a move. Re-key everything path-keyed (snapshot
  directory, any store keyed by relPath — expose a `rekey(oldRel, newRel)` hook other
  subsystems register into), and rewrite **path-form inbound links only**, exactly as 5.2.
- Handle the create-before-delete ordering symmetrically with a pending-creates map.
- Sweep both maps past the window. Without this, a Finder move orphans every piece of
  per-note state and breaks all path-form links.

---

## 6. Content hashing

`contentHash` is the change-detection primitive: it keys caches, gates pipelines,
identifies moves (5.4), and signs app writes (7.2).

### 6.1 Normalization

```
normalize(text):
  strip UTF-8 BOM if first char is U+FEFF
  replace /\r\n?/g with "\n"        # CRLF and lone CR → LF
  unicode-normalize to NFC
```

So CRLF vs LF files hash equal, and NFC vs NFD text hashes equal.

### 6.2 The reserved-namespace strip — and why it is TEXTUAL

`contentHash(text) = sha256_hex(utf8(stripAiBlock(normalize(text))))` — the hash covers
user frontmatter + body, **excluding** the machine-reserved frontmatter key.

Why exclude it at all: any component that writes machine metadata into a note and then
watches the filesystem will see its own write. If the hash covered the whole file, that
write changes the hash → "content changed" → the pipeline re-runs → writes again →
**infinite loop**. Excluding the machine namespace from the hash makes machine writes
hash-neutral by construction. (No machine-written frontmatter? Then
`contentHash = sha256(normalize(text))` — but keep the seam.)

Why the strip must be **textual, line-based — never parse-and-reserialize YAML**: YAML
round-tripping is not byte-stable (key order, quoting style, indentation all drift
between emitters and versions). A round-trip-based strip produces different bytes for
semantically identical input → hash inequality → the same infinite loop the exclusion
was meant to prevent, now intermittent and maddening. The textual algorithm:

```
stripAiBlock(text):
  t = normalize(text)
  if t does not start with "---\n": return t
  close = index of first subsequent line that is exactly "---" or "..."
  if none: return t                        # unterminated frontmatter = plain body
  fm = lines strictly between the delimiters
  start = first fm line matching /^ai:(\s|$)/    # top-level only; "  ai:" and "aim:" never match
  if none: return t
  # block = the key line plus following indented lines; a blank-line run stays in the
  # block only if a later line in that run's lookahead is indented (still in block)
  end = start; i = start+1
  while i < len(fm):
    if fm[i] starts with space or tab: end = i; i++
    elif fm[i] == "":
      j = i; while j < len(fm) and fm[j] == "": j++
      if j < len(fm) and fm[j] starts with space/tab: end = j; i = j+1
      else: break
    else: break
  remaining = fm minus lines start..end
  body = lines after the closing delimiter, joined with "\n"
  if remaining is all-empty: return body   # frontmatter emptied → drop delimiters entirely
  return "---\n" + remaining joined + "\n---\n" + body
```

**Mandatory test vectors** (equality = equal hashes):

- V1: bare note == same note with a reserved-key-only frontmatter prepended.
- V2: reserved block first / middle / last among user keys → all equal.
- V3: changing anything *inside* the reserved block → hash unchanged.
- V4: changing a user frontmatter key → hash changes.  V5: body change → hash changes.
- V6: CRLF == LF.  V7: NFC == NFD.
- V8: inline form `ai: {tags: [x]}` strips like the block form.
- V9: blank line inside the block (followed by an indented line) stays in the block.
- V10: `aim:` is NOT stripped; a nested `  ai:` under another key is NOT stripped.
- V11: stripAiBlock is idempotent.
- V12: unterminated frontmatter (`---` never closed) hashes as-is.

Corollary: **all frontmatter *writing* is also textual line surgery** — one module that
splits frontmatter lines from body (same delimiter scan), edits/inserts/removes lines,
and rejoins. Test the invariant `strip(writeReserved(text, data)) == strip(text)`.

Use a pure, synchronous SHA-256 (WebCrypto's is async; node:crypto is unavailable in a
webview). Hashing is too load-bearing to be async — it runs inline in watcher
classification and index updates. Cross-check the implementation against a known-good
library in tests.

---

## 7. File watching

### 7.1 Pipeline

```
Rust notify watcher (recursive, per vault root)
  → drop ignored paths IN RUST (never reach the frontend)
  → emit {root, relPath, kind: create|modify|delete} events to the webview
  → frontend: per-path debounce 300 ms, coalescing bursts to the latest kind
  → repository: classify (app-write vs external), reconcile moves, re-index, fire pipeline
```

The **ignore set** is shared verbatim between the watcher and directory listing: any
path segment starting with `.` (covers `.denote/`, `.git/`, dotfiles) plus the atomic-
write suffix `*.denote-tmp`. Events under ignored paths are dropped on the Rust side —
the app's own store writes under `.denote/` therefore never generate events at all.

macOS delivers events coalesced and out of order; per-path debouncing (restart a 300 ms
timer on each event, keep only the latest kind — create-then-modify collapses to modify)
turns a save burst into one dispatch. Repository event handling is serialized on a
single per-vault promise chain (one pipeline instance per vault, arrival order).

### 7.2 App-write echo suppression — signature on CONTENT HASH, not path+time

The watcher **will** deliver events for the app's own writes. Unclassified, every save
re-triggers the full external-edit pipeline (and any downstream processing) — the loop
again. Naive fix — "ignore events for paths I wrote to recently" — has a real
misclassification bug: an *actual external edit* that happens to land within the window
on a path the app just wrote gets silently swallowed. The fix is to sign the *content*:

- Before every repository write: record signature `(relPath, contentHash(newContent),
  now)` in an in-memory list per path.
- On a watcher event: read the file, compute its contentHash. A signature with **the
  same relPath AND the same hash**, younger than **5 s**, ⇒ classify `app-write` and
  **consume that one signature**. Otherwise ⇒ `external`.
- An external edit inside the window has different bytes → different hash → correctly
  classified external. Rapid successive app writes each push their own signature; each
  echo consumes exactly one. Signatures expire at 5 s (sweep periodically).
- Deletes and rename-sources have no content to hash: record a **path-op** signature
  (path + time) for those, matched by path within the same window. This is the one
  place path+time matching is acceptable, because there are no bytes to disambiguate.
- One write kind is special: a *restore/checkout* is app-originated but content-changing
  in a way the app hasn't otherwise processed. Tag it distinctly
  (`app-write-content-change`) so its echo runs the normal changed-content pipeline
  **exactly once** — neither swallowed like an echo nor treated as external.

Classification result routing: `app-write` → nothing (index already updated at write
time). `external` / `app-write-content-change` → re-parse, re-index, notify downstream
(search upsert, UI refresh), run move reconciliation (5.4) first.

### 7.3 Atomic writes

Every vault file write: write bytes to `path + ".denote-tmp"` (suffix **appended** to
the full name — do not *replace* the extension, or `a.md` and `a.txt` collide on one tmp
name), fsync, atomic rename over the target. The tmp suffix is in the shared ignore set,
so half-written files never produce events or listings. Note bytes are never interpreted
by the storage layer — they round-trip verbatim so hashing stays byte-stable.

### 7.4 Concurrency

- **Per-note mutex** in the repository: all mutations to one relPath serialize on a
  keyed promise chain (user saves, rename rewrites, background writers).
- No component writes vault files except through the repository — this is what makes
  the signature protocol airtight. Internal `.denote/` store writes go through a guarded
  door that *only* accepts ignored paths (so a store can never accidentally write a note).

---

## 8. Editor (CodeMirror 6)

### 8.1 Live preview — viewport-incremental, presentation-only

Decorations (rendered headings, bold/italic, wikilinks as clickable spans, tags as
chips, image embeds) are built **only over `view.visibleRanges`**, expanded to line
boundaries. This is the difference between "feels fine on test notes" and "dies on a
10k-line note": full-document re-decoration per keystroke is the perf cliff; visible-
range building makes cost independent of document length. Rebuild on `docChanged ||
viewportChanged || selectionSet`.

Two more rules:

- **Cursor-overlap reveals source.** A wikilink/tag collapses to a widget only when the
  selection does not overlap it; with the cursor on it, the raw `[[...]]` / `#tag` text
  shows and is editable (Obsidian's live-preview behavior).
- **The editor's scan is a presentation-only approximation.** It regex-scans visible
  text with code-region masking from the CM syntax tree (mask node types: FencedCode,
  CodeBlock, InlineCode, HTMLBlock, HTMLTag). It is *not* the source of truth — the
  authoritative parse (section 3) runs on save via the repository, and nothing in the
  editor feeds backlinks or the graph. Reuse the exported tag regex; keep a tiny shared
  wikilink token finder for editor/reading views.

Wikilink widgets: display alias if present, else target; ghost styling when resolution
fails; cmd-click navigates (or creates the ghost note, section 4.1). Emphasis/heading
styling can be simple mark decorations (dim delimiters, style content) — full mark-
hiding is polish, not architecture.

### 8.2 Autocomplete

- `[[` + partial text → note-title completion over the vault index (case-insensitive
  substring on title, cap ~30), applying `Title]]`.
- `#` + partial → known-tag completion from the index's tag set.

Both read the same editor-injected vault context (note refs, known tags, asset list,
navigation callbacks) that the decorations use — one context, one facet/field.

### 8.3 Autosave and index updates

Buffer edits mark the buffer dirty and debounce a save (~800 ms). Save goes through the
repository: signature-tagged write → re-parse → index update → search upsert → snapshot
gate. There is no separate "sync editor to index" path; save *is* the path.

### 8.4 External changes to the open note

When the watched file under the open buffer changes externally:

- **Buffer clean** → replace buffer content with disk content in place.
- **Buffer dirty** → keep the user's buffer untouched and show a **non-modal conflict
  bar** with three actions: *keep mine* (dismiss), *take disk* (replace buffer),
  *view both* (write disk content to `Note (conflict <timestamp>).md` alongside).
  **Never silently merge.** Any background/machine writer must additionally *defer* its
  writes while the target buffer is dirty (wait for save + idle, re-check its
  preconditions, drop if content moved on) — never clobber unsaved keystrokes.

### 8.5 Two-tier undo

Two undo systems exist and must not be blended:

- **Typing** = CodeMirror's own history (cmd-Z with editor focus). Programmatic buffer
  replacements are tagged as remote so they don't pollute typing history.
- **Structural ops** (rename refactor, restore snapshot, and any machine-applied
  structure) = a repository-level **op-log**: `{label, undo(), redo()}` entries with
  real inverse operations, bound to cmd-Z when the editor is *not* focused and to toast
  "Undo" actions. Push clears the redo stack. A rename op's inverse is the reverse
  rename (which re-runs the same rewrite machinery).

Wiring structural ops into CM history, or ignoring undo for them, both fail — one
corrupts typing undo, the other loses user work.

---

## 9. File tree / explorer

The tree is derived from the index, nothing else: notes + assets (flat relPath list)
plus the folder set (so **empty folders appear** — the index records directories from
the vault listing and from in-app folder creation). Pure function from
`{relPath, kind}[]` + folder paths → nested nodes; folders sort before files, both
alphabetical.

- **Inline rename**: double-click a label (or context-menu → Rename) swaps it for an
  input; Enter/blur commits, Escape cancels. Commit calls the *store-level* rename,
  which routes through the repository refactor (5.1) and pushes the op-log entry —
  the explorer never renames a file directly.
- Delete is two-step (confirm in the context menu). Move-to-folder uses the move
  refactor (5.2).
- Folder creation goes through the repository (`createDir` + index folder add), with
  path normalization that rejects `.`/`..`/dot-segments.

---

## 10. Search, snapshots, and derived stores

### 10.1 Full-text search

MiniSearch (or equivalent), **one instance per open vault** (never one global index —
ids are relPaths and collide across vaults), rebuilt on vault open (adequate below ~5k
notes; persistence is an optimization, not an architecture change).

- Document: `{id: relPath, title, headings (joined), tags (space-joined), body, folder,
  hasGhost}`; indexed fields title/headings/tags/body with boosts 8/4/3/1; prefix +
  fuzzy(0.2) matching.
- `hasGhost` = "any outbound link fails to resolve", computed from the link index.
- Incremental upsert/remove driven by the same index-change hook the repository fires
  for every note mutation (including external deletes); full rebuild is async/chunked
  so vault open never blocks the UI.
- Query syntax parsed before search: `tag:x`, `folder:x` (prefix match on subfolders),
  `vault:x`, `has:ghosts`; the remainder is free text (empty free text + filter ⇒
  wildcard search so `tag:x` alone lists all matches).

### 10.2 Local history (snapshots)

Copy-on-write snapshots at `.denote/snapshots/<relPath>/<epochMillis>.md`, written on
save through a gate: first snapshot always; then only if ≥5 min elapsed OR size changed
≥30%. Retention per note: keep all <24 h; 24 h–30 d keep newest per day; >30 d keep
newest per week. Vault-wide cap (50 MB): drop oldest across the vault until under.
Snapshot directories are re-keyed on rename/move. Restore writes through the repository
with the `app-write-content-change` tag (7.2) so downstream processing runs exactly once.

### 10.3 Note dates

One util owns the precedence: `created` = frontmatter `created`/`date` if parseable,
else file birthtime (fall back to mtime where the platform lacks birthtime); `edited` =
mtime. First-seen birthtime is cached per note and preserved across edits and renames.

### 10.4 Rebuild-everything

Expose a "rebuild derived caches" operation: clear the in-memory index, re-list the
vault, re-read + re-parse every note, rebuild link index/backlinks, re-fire the
index-change hook for every note (search re-adds). This is also the recovery path when
any store looks corrupt — and the proof of rule 2 in section 1.

---

## 11. Graph construction

Pure, deterministic builder: `(vaults[], …) → {nodes, edges}`, output sorted by id so
snapshots are stable. Takes a **set** of vaults (multi-vault view is first-class).

### 11.1 Nodes

```ts
type GraphNodeId = NoteId | `tag:${string}` | `ghost:${string}` /* + topic ids if you add them */;
interface GraphNode { id: GraphNodeId; type: 'note'|'tag'|'ghost'; vaultId?: VaultId; label?: string }
```

- Note nodes: one per note, id `vaultId/relPath`, label = title.
- **Tag nodes are global**: id `tag:{lowercased name}` — the same tag in two vaults is
  ONE hub node (merge across vaults by name). Label keeps display casing.
- Ghost nodes: id from resolution (4.1); carry `vaultId` explicitly (redundant with the
  id encoding, but lets UI read it uniformly, e.g. "create this ghost in which vault").
- Notes and ghosts never merge across vaults.

### 11.2 Edges — hubs, never cliques

```ts
interface GraphEdge {
  id: string; from: string; to: string;
  type: 'wikilink' | 'embed' | 'note-tag' | 'manual' /* + machine types if you add them */;
  source: 'user' | 'parser' | 'ai' | 'system';   // REQUIRED on every edge
  weight: number; confidence?: number; reason?: string;
}
```

- **Wikilink/embed edges**: from the resolved link index, `source: 'parser'`. Parallel
  edges (two links A→B) collapse by edge id with summed weight. Deterministic edge ids:
  `wikilink:{from}->{to}` etc.
- **Tag edges**: note → tag hub, one edge per (note, tag).
- **The O(n²) trap (load-bearing)**: "notes sharing a tag are connected" is a clique —
  a 200-note tag is 19,900 edges and the graph is an unreadable hairball that also
  kills layout perf. Tags (and any category-like concept) are **hub nodes with
  note→hub edges** — n edges, not n². If graph code ever iterates *pairs of notes* to
  make edges, it is wrong (the only legitimate note-note edges are explicit links and
  individually-vetted, capped special cases).
- **Every edge carries `source`** (who asserted it: the user, the parser, a machine, the
  system), and machine edges must carry `confidence` and a human-readable `reason`. No
  anonymous edges — the node inspector shows per-connection provenance. This is cheap
  now and impossible to retrofit honestly.

Determinism rules: sort vaults and notes before iterating; unordered (bidirectional)
edges use the lexicographically smaller endpoint first in the id (`a<->b`). Renderer
sits behind a component contract (props: graph + callbacks) so canvas/WebGL renderers
swap without touching builder code.

---

## 12. Desktop shell security (Tauri) — path containment

The webview is untrusted-adjacent (it renders user Markdown; XSS in a note must not
become disk access). The Rust command surface is the security boundary.

### 12.1 The rule

**Never expose a generic `read_file(absolutePath)` / `write_file` command.** Every
filesystem command takes `(root, relPath)` and resolves through one containment
function; the webview is *physically unable* to touch paths outside registered vault
roots (plus a separately-guarded app-support directory).

### 12.2 Canonicalize-then-verify

```rust
fn contained_path(registered: &[PathBuf], root: &str, rel: &str) -> Result<PathBuf, Err> {
  let canon_root = fs::canonicalize(root)?;                 // resolves symlinks
  if !registered.contains(&canon_root) { return Err("root not registered") }
  // rel may contain only Normal / CurDir components — no "..", no absolute, no prefix
  for comp in Path::new(rel).components() {
    match comp { Normal(_) | CurDir => {}, _ => return Err("path escapes vault") }
  }
  let target = canon_root.join(rel);
  // symlink-escape check: canonicalize the DEEPEST EXISTING ancestor of the target and
  // verify it is still under the canonical root — defeats a symlink planted INSIDE the
  // vault that points outside. (canonicalize(target) alone fails for not-yet-existing
  // files, which writes legitimately create; hence the ancestor walk.)
  let anchor = deepest_existing(&target);
  if !fs::canonicalize(anchor)?.starts_with(&canon_root) { return Err("symlink escape") }
  Ok(target)
}
```

String prefix checks without canonicalization are bypassable (symlinks, `..`, case
tricks); canonicalization without the component check misses traversal to *other
registered* roots; both together, on **every** command, is the design. Mandatory tests:
accepts inside paths; rejects `../escape.md`; rejects absolute rel; rejects
unregistered root; rejects a symlink inside the vault pointing out.

### 12.3 Command surface (complete)

`register_vault_root(root)` · `list_vault_files(root)` (recursive, ignore-filtered,
returns `{relPath, isDir, isMarkdown, mtime, btime, size}` including directories so
empty folders index) · `list_dir(root, rel)` (non-recursive, NOT ignore-filtered — used
deliberately for `.denote/` stores) · `read_note` · `read_asset` (bytes, for image
embeds — still contained, still not generic) · `write_note` (atomic per 7.3) ·
`create_dir` · `delete_path` · `rename_path` · `stat_path` · `path_exists` ·
`watch_vault` / `unwatch_vault` (canonicalizes the root before watching) ·
`app_support_dir()` (returns the OS app-data *path* only, never contents; reads/writes
against it re-enter the same containment door as a registered root).

The frontend talks to this through a `StorageBackend` interface so the repository can
be integration-tested against plain `node:fs` in a temp dir — the TS layer carries no
security guarantees of its own; containment lives in Rust only.

---

## Appendix A — Load-bearing vs incidental

| Choice | Status |
|---|---|
| Files as sole truth; derived-everything rebuildable | load-bearing |
| Backlinks never persisted | load-bearing |
| Textual (non-YAML-round-trip) frontmatter strip & write | load-bearing |
| Echo suppression signed by content hash, not path+time | load-bearing |
| Canonicalize-then-verify with deepest-existing-ancestor check | load-bearing |
| Tag/category hubs, never note-pair cliques | load-bearing |
| `source` (+ `confidence`/`reason`) on every edge | load-bearing |
| Viewport-incremental editor decorations | load-bearing (perf) |
| Path bytes stored as-reported; fold only for comparison | load-bearing |
| Rename = refactor with matchType-aware rewriting; retitle ≠ rewrite | load-bearing |
| Move detection by contentHash, both event orderings | load-bearing |
| Two-tier undo (CM history + structural op-log) | load-bearing |
| Dirty-buffer conflict bar; never silent merge; defer background writes | load-bearing |
| Manual wikilink scanner (not one regex) for `[[a]]b]]` semantics | load-bearing (semantics) |
| Exact windows: 300 ms debounce, 5 s signature TTL, 2 s move window, 800 ms autosave | tunable defaults |
| Snapshot gate numbers (5 min / 30% / 50 MB / retention buckets) | tunable defaults |
| MiniSearch, remark, CodeMirror, Zustand, Tauri | swappable implementations |
| Tie-break "shortest then lexicographic relPath" | incidental, but pick ONE and test it |
| `.denote` / `denote-tmp` naming | incidental |

## Appendix B — The traps, one line each

1. Hash via YAML round-trip → unstable bytes → infinite reprocess loop. Strip textually.
2. Background write to a dirty open buffer → clobbered keystrokes. Defer + recheck.
3. Watcher echo untagged → pipeline on every save; tagged by path+time → real external
   edits swallowed. Sign with content hash.
4. Generic `read_file(path)` command → webview reads the whole disk. Contain every path.
5. Notes-sharing-a-tag edges → O(n²) hairball. Hub nodes.
6. Persisted backlinks/indexes → corrupted by external edits. Derive, always.
7. Whole-document editor decoration per keystroke → dies at 10k lines. Visible ranges only.
8. Structural ops in typing undo (or nowhere) → broken undo. Two tiers with inverses.
9. Blanket NFC-normalizing stored paths → files unreachable on some volumes. Fold for
   comparison only.
10. Rename without rewriting (or retitle WITH rewriting) → broken links or mid-typing
    file churn. Rewrite on rename by matchType; re-resolve on retitle.
