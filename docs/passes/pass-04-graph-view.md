# Pass 04 — Graph view

## Objective
The graph surface with layered presentation per D6/D7/D25: semantic-default, structural hulls
as a toggle, full provenance in an inspector.

## Deliverables
- `GraphView` component contract (D25): props are `{nodes, edges, groupings, style tokens,
  callbacks}` — renderer-agnostic. First implementation: react-force-graph (canvas 2D).
- Graph page fed by `domain/graphBuilder` output for the selected vault set.
- Visual language (all token-driven):
  - notes = circles sized by degree; ghosts = hollow dashed circles; tags = small squares;
    topics = larger tinted circles (topics arrive pass 8 — style them now with mock data in a
    storybook-style dev page, keep prod empty).
  - edge styling by `source`: user/parser = solid; ai = dashed + lower opacity; width by
    weight; hover shows `reason` for AI edges.
- Layer controls (persisted per user): toggle wikilinks / tags / topics / ai-similar;
  confidence slider for AI edges; **structural hulls toggle (default OFF)** rendering
  vault→folder nested translucent hulls via custom canvas paint (convex hull or bubble-set
  around member nodes, folder-tinted).
- Node inspector (click): note title, folder, tags, outbound/inbound counts, and a
  **connections list with per-edge provenance** — source badge, confidence, reason (D8c).
- Interactions: click→open note; cmd-click→open + keep graph; drag pin; local view mode
  (n-hop neighborhood of current note) reachable from the editor.

## Pitfalls
- Ghost node clicks create the note (consistent with pass 3).
- Determinism: seed force layout positions from a hash of node id so reloads look similar.
- Performance budget now: 2,000 nodes / 6,000 edges at 60fps interaction on M-series; if
  canvas 2D can't hold it, note it in PROGRESS — do NOT swap renderers mid-pass (R5).
- No AI edges exist yet; build the styling/filter machinery against fixture data so pass 7/8
  plug in without UI work.

## Definition of Done
Fixture vault (~200 notes, script-generated into a temp vault) renders; hull toggle correct
for nested folders; inspector shows provenance for fixture AI edges; layer toggles + slider
work and persist; graph updates live when a note is edited (index event → rebuild diff).
