# Pass 08 — Topic ontology, semantic clustering, insights v1

## Objective
The flagship: a persistent, canonicalized topic layer that connects notes to concepts the
user never wrote (Japan-note-about-banking → Finance → Banking → Interest Rates), semantic
clusters as the graph's default view, and the first insights panel.

## Deliverables
- `domain/ontology.ts` (pure) + `services/topicStore.ts` (`.denote/ai/topics.json`, D14).
- **Canonicalization procedure (D14, R3) — the load-bearing step.** When enrichment proposes
  a topic: (1) exact name match (case/diacritic-insensitive) → attach; (2) alias match →
  attach; (3) embed topic name + description, cosine vs existing topic centroids ≥ 0.80 →
  attach + record proposed name as alias; (4) else create, with parent suggestion. The
  enrichNote prompt ALWAYS receives the retrieved existing-topic stubs (name, description,
  top members) so the model attaches rather than invents. Topic creation also proposes
  `parentId` and `relatedIds` — hierarchy edges are annotations (suggested) until they
  recur ≥2 times or the user accepts, then applied.
- Membership: soft weights (D14). Inputs: enrichment assignments (confidence), folder
  co-location bonus (+0.1, never decisive), recurrence. Decay: memberships not reconfirmed
  after a note's content changes are re-evaluated.
- **Semantic clustering = topic layer as default graph view (D7):** color/group notes by
  dominant topic; topic hub nodes on; multi-membership rendered by strongest-topic color with
  mixed-membership visual (ring segments) for ≥2 strong memberships. Structural hulls remain
  the pass-04 toggle. Cluster view must handle the "daily learnings" case: one folder's notes
  scattering across many topic clusters is CORRECT behavior — add a fixture proving it.
- **`_topics/` materialization (D8c):** optional (settings, default on): each topic ≥3
  members gets `_topics/<Name>.md` — frontmatter `source: ai`, description, wikilinks to
  members grouped by subtopic, links to parent/related topic notes. Regenerated (not
  appended) on ontology change, through repository (D23), excluded from enrichment (D26) and
  off-graph by default. If the user edits one, set `source: user-modified` and STOP
  regenerating it (preserve user work; note this rule in the file header comment the
  generator writes).
- Vault-level "Organize vault" command: batch job — re-enrich stale notes, run
  canonicalization sweep (merge topics whose centroids ≥0.92 + LLM confirms), prune empty
  topics. On-device tier; progress UI; cancellable.
- **Insights panel v1** (topic/tag/folder node click): member timeline (created/edited
  histogram), top co-occurring topics, recent notes, unresolved ghosts under this topic,
  topic description. No LLM synthesis yet (pass 9) — layout leaves an "Analysis" slot.
- Topic management UI: rename (becomes alias), merge, re-parent, delete (memberships →
  suggestions), mark topic as user-owned.

## Pitfalls
- R3 is the pass-killer: without step (3) retrieval-into-prompt, you WILL get near-duplicate
  topics. Test: enrich fixtures mentioning "banking", "banks", "the banking system" → exactly
  one Banking topic.
- Ontology writes are frequent — debounce topicStore persistence; corruption-safe write
  (temp + atomic rename).
- `_topics` regeneration must be byte-stable for unchanged ontology (no churn commits/
  snapshots).
- On-device context limits: canonicalization sweeps operate on stubs, never full bodies.

## Definition of Done
Scripted fixture vault (finance/faith/tech mix incl. the Japan-banking scenario): Japan note
lands in Banking topic under Finance parent; interest-rate mentions link; near-duplicate
names collapse to one topic; default graph view shows semantic clusters with a mixed-content
folder scattering correctly; `_topics/Finance.md` materializes and survives user-edit
freeze rule; Organize-vault completes with progress and is cancellable.
