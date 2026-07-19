import { describe, expect, it } from 'vitest';
import {
  LABEL_ALWAYS_MAX_NODES,
  LABEL_LARGE_GRAPH_SCALE_GATE,
  connectedNoteIds,
  emptyHintKind,
  labelScaleGate,
} from '../../../src/features/graph/readability';
import type { GraphEdge } from '../../../src/domain';

describe('labelScaleGate (R-4: titles at default zoom for ≤ ~300 nodes)', () => {
  it('is 0 (labels are candidates at any zoom) for small and mid-sized graphs', () => {
    expect(labelScaleGate(1)).toBe(0);
    expect(labelScaleGate(99)).toBe(0);
    expect(labelScaleGate(150)).toBe(0);
    expect(labelScaleGate(LABEL_ALWAYS_MAX_NODES)).toBe(0);
  });

  it('keeps the deep-zoom hairball guard for larger graphs', () => {
    expect(labelScaleGate(LABEL_ALWAYS_MAX_NODES + 1)).toBe(LABEL_LARGE_GRAPH_SCALE_GATE);
    expect(labelScaleGate(1000)).toBe(LABEL_LARGE_GRAPH_SCALE_GATE);
  });

  it('a fit-zoomed mid-sized graph (typical globalScale well below 1) passes the gate', () => {
    // Fit-to-graph on 100–300-node maps settles around scale 0.3–1.0 — the old 1.2 gate hid
    // every title there. Any positive scale must now clear the gate for ≤300 nodes.
    const typicalFitScale = 0.35;
    expect(typicalFitScale > labelScaleGate(250)).toBe(true);
    expect(typicalFitScale > labelScaleGate(301)).toBe(false);
  });
});

function edge(id: string, from: string, to: string): GraphEdge {
  return { id, from, to, type: 'wikilink', source: 'parser', weight: 1 };
}

describe('connectedNoteIds (drives orphan dimming — presentation only, D6)', () => {
  const noteIds = new Set(['v/A.md', 'v/B.md', 'v/C.md']);

  it('marks both note endpoints of a note-note edge as connected', () => {
    const out = connectedNoteIds([edge('e1', 'v/A.md', 'v/B.md')], noteIds);
    expect(out).toEqual(new Set(['v/A.md', 'v/B.md']));
  });

  it('counts a hub edge for the note endpoint only — hub ids never enter the set', () => {
    const out = connectedNoteIds([edge('e1', 'v/C.md', 'tag:japan')], noteIds);
    expect(out).toEqual(new Set(['v/C.md']));
  });

  it('with no edges, every note is an orphan (empty connected set)', () => {
    expect(connectedNoteIds([], noteIds).size).toBe(0);
  });

  it('ignores edges whose endpoints are not in the visible note set', () => {
    const out = connectedNoteIds([edge('e1', 'tag:a', 'topic:b')], noteIds);
    expect(out.size).toBe(0);
  });
});

describe('emptyHintKind (layers off vs. filtered vs. genuinely no connections yet)', () => {
  it('is none when there is nothing to show at all (no vault / empty vault)', () => {
    expect(emptyHintKind({ nodeCount: 0, rawEdgeCount: 0, visibleEdgeCount: 0, allLayersOff: false })).toBe('none');
  });

  it('is none while any edge is visible', () => {
    expect(emptyHintKind({ nodeCount: 5, rawEdgeCount: 4, visibleEdgeCount: 2, allLayersOff: false })).toBe('none');
  });

  it('is no-connections when the UNFILTERED graph has zero edges — no toggle could help', () => {
    expect(emptyHintKind({ nodeCount: 5, rawEdgeCount: 0, visibleEdgeCount: 0, allLayersOff: false })).toBe('no-connections');
    // Even with layers off: turning them on would still reveal nothing, so the truthful
    // explanation stays "no connections yet", not "layers off".
    expect(emptyHintKind({ nodeCount: 5, rawEdgeCount: 0, visibleEdgeCount: 0, allLayersOff: true })).toBe('no-connections');
  });

  it('is layers-off when real edges exist but every edge layer is toggled off', () => {
    expect(emptyHintKind({ nodeCount: 5, rawEdgeCount: 4, visibleEdgeCount: 0, allLayersOff: true })).toBe('layers-off');
  });

  it('is filtered when real edges exist, layers are on, but filters hide them all', () => {
    expect(emptyHintKind({ nodeCount: 5, rawEdgeCount: 4, visibleEdgeCount: 0, allLayersOff: false })).toBe('filtered');
  });
});
