import { describe, expect, it } from 'vitest';
import { decideTakeover, isBare } from '../../src/domain/takeover';
import { parseNote } from '../../src/domain/parser';
import type { AiAnnotation } from '../../src/domain/types';

function ann(over: Partial<AiAnnotation>): AiAnnotation {
  return {
    id: over.id ?? 'a1',
    notePath: 'n.md',
    contentHash: 'h',
    kind: over.kind ?? 'tag',
    payload: over.payload ?? {},
    confidence: over.confidence ?? 0.9,
    reason: over.reason ?? 'because',
    status: over.status ?? 'suggested',
    model: 'mock',
    createdAt: '2026-07-08T00:00:00Z',
    ...over,
  };
}

describe('isBare (S10)', () => {
  it('true when no body links, no body tags, no user tags: frontmatter', () => {
    expect(isBare(parseNote('n.md', 'Just prose about regional banks.'))).toBe(true);
  });
  it('false when a body tag exists', () => {
    expect(isBare(parseNote('n.md', 'text #japan'))).toBe(false);
  });
  it('false when a body wikilink exists', () => {
    expect(isBare(parseNote('n.md', 'text [[Japan]]'))).toBe(false);
  });
  it('false when user tags: frontmatter is present', () => {
    expect(isBare(parseNote('n.md', '---\ntags: [finance]\n---\nBody.'))).toBe(false);
  });
  it('bare is unaffected by an ai: frontmatter block (that is AI-owned, not user structure)', () => {
    expect(isBare(parseNote('n.md', '---\nai:\n  tags: [japan]\n---\nBody.'))).toBe(true);
  });
});

describe('decideTakeover (D9/S10 state machine)', () => {
  const bare = parseNote('n.md', 'Regional banks merging due to zero rates.');
  const structured = parseNote('n.md', 'text #japan');

  it('bare + suggestions ≥ threshold → apply those (tag/link/topic only)', () => {
    const anns = [
      ann({ id: 't1', kind: 'tag', confidence: 0.8 }),
      ann({ id: 'l1', kind: 'link', confidence: 0.9 }),
      ann({ id: 's1', kind: 'summary', confidence: 0.99 }), // not provisionable
      ann({ id: 't2', kind: 'tag', confidence: 0.5 }), // below threshold
    ];
    const d = decideTakeover(bare, anns);
    expect(d.action).toBe('apply');
    if (d.action === 'apply') expect(d.apply.map((a) => a.id).sort()).toEqual(['l1', 't1']);
  });

  it('bare but nothing meets threshold → none', () => {
    expect(decideTakeover(bare, [ann({ confidence: 0.4 })]).action).toBe('none');
  });

  it('rejected entries are never applied', () => {
    expect(decideTakeover(bare, [ann({ status: 'rejected', confidence: 0.99 })]).action).toBe('none');
  });

  it('user structure present → demote applied-provisional back to suggestions', () => {
    const anns = [ann({ id: 'p1', status: 'applied-provisional' }), ann({ id: 'p2', status: 'applied-provisional' })];
    const d = decideTakeover(structured, anns);
    expect(d.action).toBe('demote');
    if (d.action === 'demote') expect(d.demote.map((a) => a.id).sort()).toEqual(['p1', 'p2']);
  });

  it('user structure present but nothing applied → none', () => {
    expect(decideTakeover(structured, [ann({ status: 'suggested' })]).action).toBe('none');
  });

  it('custom threshold is honored', () => {
    const anns = [ann({ confidence: 0.7 })];
    expect(decideTakeover(bare, anns, { threshold: 0.6 }).action).toBe('apply');
    expect(decideTakeover(bare, anns, { threshold: 0.8 }).action).toBe('none');
  });
});
