# Owner Acceptance — what Kevin personally verifies

Agents prove Definitions of Done; this checklist is different — it's what the OWNER checks
with his own eyes before trusting a milestone. Five minutes each. If an item fails, tell the
agent which line failed; do not debug yourself.

## How to start any build session

Paste exactly this into a fresh agent session:

> Read CLAUDE.md and execute the next pass per docs/PROGRESS.md. Stop when its Definition of
> Done is met, update PROGRESS.md, and commit.

If the agent asks you an architectural question, the answer is almost always "check
DECISIONS.md / SPECS.md" — the docs outrank both of you.

## After pass 03 — "would I take notes in this?"

- [ ] Create a real note about something you learned today; type fast for 30s — no lag.
- [ ] `[[` autocompletes; a link to a nonexistent note looks distinct; clicking creates it.
- [ ] Rename a note from the tree; the notes linking to it still point at it.
- [ ] Quit the app; open the vault folder in Finder — your notes are plain readable `.md`.
- [ ] Edit a note in TextEdit while DeNote is open — DeNote reflects the change.
- [ ] **The real test: use it for your actual notes for 3+ days before greenlighting pass 4.**

## After pass 05

- [ ] Add your second vault; switch between them instantly from the rail.
- [ ] Search finds a word you know is in one note; `tag:` filter works.
- [ ] Combined graph shows both vaults; per-vault colors sensible.

## After pass 07 (first real AI — check on airplane mode)

- [ ] Wi-Fi OFF: write a new note overlapping an old one → within a minute an AI edge with a
      SPECIFIC reason appears. Reason vague? Fail it.
- [ ] Paste a long article into capture → summary + title suggested, offline.
- [ ] A bare note gets softly-styled provisional tags; add your own tag → they retreat.
- [ ] Reject a suggestion; edit the note trivially elsewhere; the reject stays rejected.

## After pass 08 (the flagship)

- [ ] Open the fixture vaults (`tests/fixtures/vision-vault/`) and check EXPECTED.md's
      ontology section by eye: one Banking topic, Japan-note in it, miso soup NOT in it.
- [ ] On YOUR vault: run Organize Vault → the topics it creates should feel like YOUR mental
      categories. Sprawl (near-duplicate topics) = fail, cite D14.
- [ ] Default graph view = semantic clusters; folder hulls only when toggled.

## After pass 09 (money)

- [ ] Enter your API key in Settings (never give it to an agent in chat).
- [ ] Run deep-organize on a small vault: it shows the cost ESTIMATE before running; the
      spend page matches afterward; set cap to $0.01 and confirm it refuses to run.
- [ ] Mark your church vault localOnly FIRST, then verify nothing from it appears in any
      cloud job manifest.

## After pass 10

- [ ] From Safari: select text → hotkey → filed note carries the URL.
- [ ] Delete `.denote/cache/` inside a vault while the app runs → everything rebuilds,
      nothing lost.

## After pass 11

- [ ] Push a vault to a PRIVATE repo; clone it elsewhere; the notes read fine raw.
- [ ] Import a folder containing a duplicate of an existing note → it's skipped and reported.

## Standing rules for you

- Your notes are always just files. Any moment of doubt: open the folder in Finder.
- Time Machine or any backup of the vault folders is a complete backup of everything.
- If an agent ever asks for your API key or GitHub token in chat, refuse — keys go into the
  app's own settings only.
