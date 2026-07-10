// S16 token-budgeting unit tests (on-device context is small; every prompt must fit).
import { describe, expect, it } from 'vitest';
import {
  capWords,
  enrichBudget,
  estimateTokens,
  truncateToBudget,
  TRUNCATION_MARKER,
} from '../../src/domain/tokenBudget';

describe('estimateTokens (S16)', () => {
  it('is ceil(chars / 3.5)', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abc')).toBe(1); // 3/3.5 = 0.857 → 1
    expect(estimateTokens('a'.repeat(35))).toBe(10);
    expect(estimateTokens('a'.repeat(36))).toBe(11);
  });
});

describe('enrichBudget (S16 allocation)', () => {
  it('reserves 15% then splits 50/25/25', () => {
    const b = enrichBudget(1000);
    // usable = 850 → body 425, topics 212, candidates 212
    expect(b.bodyTokens).toBe(425);
    expect(b.topicsTokens).toBe(212);
    expect(b.candidatesTokens).toBe(212);
  });
});

describe('truncateToBudget (S16 head 60% + tail 20%)', () => {
  it('leaves text under budget untouched', () => {
    const t = 'short note';
    expect(truncateToBudget(t, 100)).toBe(t);
  });

  it('keeps the top and bottom with a marker when over budget', () => {
    const text = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
    const out = truncateToBudget(text, 50); // budget ~175 chars
    expect(out).toContain(TRUNCATION_MARKER);
    expect(out.length).toBeLessThan(text.length);
    expect(out.startsWith('word0')).toBe(true);
    expect(out.trimEnd().endsWith('word399')).toBe(true); // tail preserved
  });
});

describe('capWords (S16 stub caps)', () => {
  it('keeps up to maxWords, appends ellipsis when trimmed', () => {
    expect(capWords('a b c', 5)).toBe('a b c');
    expect(capWords('a b c d e f', 3)).toBe('a b c…');
  });
});
