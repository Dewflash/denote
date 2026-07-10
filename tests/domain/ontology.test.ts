// Pure ontology math (D14/S17) — canonicalization anti-sprawl, membership weights, dominant-topic
// coloring, folder misfit, resurfacing. Part of the pass-08 domain suite (test-first, CLAUDE.md).

import { describe, expect, it } from 'vitest';
import {
  ATTACH_THRESHOLD,
  canonicalizeTopic,
  centroidOf,
  computeResurfacing,
  cosine,
  dominantTopic,
  foldTopicName,
  isMisfit,
  membershipWeight,
  strongMemberships,
  topicColorIndex,
  topicCentroidText,
  type TopicMatchInput,
} from '../../src/domain/ontology';

describe('vector math', () => {
  it('cosine of identical vectors is 1, orthogonal is 0', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it('cosine is 0 for empty or mismatched length', () => {
    expect(cosine([], [])).toBe(0);
    expect(cosine([1, 2], [1])).toBe(0);
  });
  it('centroidOf averages then L2-normalizes; null for empty', () => {
    expect(centroidOf([])).toBeNull();
    const c = centroidOf([[1, 0], [0, 1]])!;
    expect(cosine(c, [1, 1])).toBeCloseTo(1);
  });
});

describe('foldTopicName', () => {
  it('is case- and diacritic-insensitive and collapses whitespace', () => {
    expect(foldTopicName('Café')).toBe('cafe');
    expect(foldTopicName('  Banking   System ')).toBe('banking system');
    expect(foldTopicName('BANKS')).toBe('banks');
  });
});

describe('canonicalizeTopic (D14/R3 order)', () => {
  const banking: TopicMatchInput = { id: 't-bank', name: 'Banking', aliases: ['banks'], centroid: [1, 0, 0] };
  const finance: TopicMatchInput = { id: 't-fin', name: 'Finance', aliases: [], centroid: [0.9, 0.1, 0] };
  const existing = [banking, finance];

  it('(1) honors a valid existingTopicId from the model', () => {
    expect(canonicalizeTopic({ name: 'whatever', existingTopicId: 't-fin' }, existing, null)).toEqual({
      kind: 'exact',
      topicId: 't-fin',
    });
  });
  it('ignores an existingTopicId that names no real topic, falling through', () => {
    const m = canonicalizeTopic({ name: 'Brand New', existingTopicId: 'ghost' }, existing, null);
    expect(m.kind).toBe('create');
  });
  it('(2) exact folded-name match', () => {
    expect(canonicalizeTopic({ name: 'banking' }, existing, null)).toEqual({ kind: 'exact', topicId: 't-bank' });
  });
  it('(3) alias match', () => {
    expect(canonicalizeTopic({ name: 'Banks' }, existing, null)).toEqual({ kind: 'alias', topicId: 't-bank' });
  });
  it('(4) centroid match ≥ 0.80 records the proposed name as an alias', () => {
    // "banking system" is a new name string but embeds close to Banking's centroid.
    const m = canonicalizeTopic({ name: 'banking system' }, existing, [0.99, 0.02, 0]);
    expect(m.kind).toBe('centroid');
    if (m.kind === 'centroid') {
      expect(m.topicId).toBe('t-bank');
      expect(m.cos).toBeGreaterThanOrEqual(ATTACH_THRESHOLD);
      expect(m.addAlias).toBe('banking system');
    }
  });
  it('(5) creates when nothing matches and the vector is far', () => {
    expect(canonicalizeTopic({ name: 'Cooking' }, existing, [0, 0, 1]).kind).toBe('create');
  });
  it('near-duplicate names collapse to ONE topic across the R3 order', () => {
    // Simulate three enrichments proposing banking variants; all resolve to t-bank.
    const variants: Array<{ name: string; vec: number[] }> = [
      { name: 'banking', vec: [1, 0, 0] },
      { name: 'banks', vec: [0.98, 0.05, 0] },
      { name: 'the banking system', vec: [0.97, 0.02, 0.01] },
    ];
    const targets = variants.map((v) => {
      const m = canonicalizeTopic({ name: v.name }, existing, v.vec);
      return m.kind === 'create' ? 'CREATE' : m.topicId;
    });
    expect(new Set(targets)).toEqual(new Set(['t-bank']));
  });
  it('topicCentroidText joins name and description', () => {
    expect(topicCentroidText('Banking', 'central-bank policy')).toBe('Banking — central-bank policy');
    expect(topicCentroidText('Banking', '')).toBe('Banking');
  });
});

describe('membershipWeight (S17)', () => {
  it('adds the folder bonus and reconfirmation increments, capped', () => {
    expect(membershipWeight(0.7)).toBeCloseTo(0.7);
    expect(membershipWeight(0.7, { folderCoLocated: true })).toBeCloseTo(0.8);
    expect(membershipWeight(0.7, { reconfirmations: 2 })).toBeCloseTo(0.8);
    expect(membershipWeight(0.7, { reconfirmations: 99 })).toBeCloseTo(0.85); // capped at 3 → +0.15
    expect(membershipWeight(0.95, { folderCoLocated: true, reconfirmations: 3 })).toBe(1); // clamp01
  });
});

describe('dominantTopic + coloring (S17)', () => {
  it('picks max weight, ties broken lexicographically by name', () => {
    const d = dominantTopic([
      { topicId: 'a', name: 'Zeta', weight: 0.6 },
      { topicId: 'b', name: 'Alpha', weight: 0.6 },
      { topicId: 'c', name: 'Beta', weight: 0.4 },
    ]);
    expect(d?.name).toBe('Alpha');
  });
  it('returns null for no memberships', () => {
    expect(dominantTopic([])).toBeNull();
  });
  it('strongMemberships returns ≥minWeight sorted by weight desc', () => {
    const s = strongMemberships([
      { topicId: 'a', name: 'A', weight: 0.9 },
      { topicId: 'b', name: 'B', weight: 0.3 },
      { topicId: 'c', name: 'C', weight: 0.6 },
    ]);
    expect(s.map((m) => m.name)).toEqual(['A', 'C']);
  });
  it('topicColorIndex is deterministic and in range', () => {
    const i = topicColorIndex('t-bank');
    expect(i).toBe(topicColorIndex('t-bank'));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(8);
  });
});

describe('isMisfit (folder profile, pass-8)', () => {
  it('flags a note with zero topic overlap AND far embedding', () => {
    expect(
      isMisfit({
        noteTopics: ['t-cook'],
        folderTopics: ['t-bank', 't-japan'],
        noteVector: [0, 0, 1],
        folderCentroid: [1, 0, 0],
      }),
    ).toBe(true);
  });
  it('does NOT flag when there is any topic overlap', () => {
    expect(
      isMisfit({
        noteTopics: ['t-bank'],
        folderTopics: ['t-bank'],
        noteVector: [0, 0, 1],
        folderCentroid: [1, 0, 0],
      }),
    ).toBe(false);
  });
  it('does NOT flag when the embedding is close to the folder centroid', () => {
    expect(
      isMisfit({
        noteTopics: ['t-cook'],
        folderTopics: ['t-bank'],
        noteVector: [0.95, 0.1, 0],
        folderCentroid: [1, 0, 0],
      }),
    ).toBe(false);
  });
  it('does NOT flag when vectors are missing (cannot judge)', () => {
    expect(isMisfit({ noteTopics: ['x'], folderTopics: ['y'], noteVector: null, folderCentroid: [1] })).toBe(false);
  });
});

describe('computeResurfacing (pass-8)', () => {
  it('keeps only ≥90-day notes, excludes dismissed, ranks by similarity×age, max 5', () => {
    const cards = computeResurfacing(
      [
        { relPath: 'old-strong.md', similarity: 0.9, ageDays: 200, reason: 'topic: Finance' },
        { relPath: 'recent.md', similarity: 0.9, ageDays: 10, reason: 'topic: Finance' }, // too new
        { relPath: 'dismissed.md', similarity: 0.9, ageDays: 300, reason: 'topic: Finance' },
        { relPath: 'old-weak.md', similarity: 0.5, ageDays: 100, reason: 'similar to X' },
        { relPath: 'zero.md', similarity: 0, ageDays: 400, reason: 'x' }, // no similarity
      ],
      { dismissed: new Set(['dismissed.md']) },
    );
    expect(cards.map((c) => c.relPath)).toEqual(['old-strong.md', 'old-weak.md']);
    expect(cards[0].score).toBeCloseTo(0.9 * 200);
  });
});
