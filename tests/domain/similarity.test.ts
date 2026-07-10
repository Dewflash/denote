// S15 similarity-gate unit tests — the "no bullshit connections" guarantee (D6a).
import { describe, expect, it } from 'vitest';
import {
  acceptSimilarity,
  isCrossVault,
  ownerOf,
  pairKey,
  reasonPassesVacuityGate,
  VACUITY_DENYLIST,
} from '../../src/domain/similarity';

describe('reasonPassesVacuityGate (S15)', () => {
  it('rejects reasons under 15 chars', () => {
    expect(reasonPassesVacuityGate('too short')).toBe(false);
    expect(reasonPassesVacuityGate('Both cover BOJ yen intervention mechanics.')).toBe(true);
  });

  it('rejects every denylisted generic phrase (case-insensitive)', () => {
    for (const phrase of VACUITY_DENYLIST) {
      expect(reasonPassesVacuityGate(`These are ${phrase.toUpperCase()} indeed here`)).toBe(false);
    }
  });

  it('accepts a specific, long-enough shared-concept reason', () => {
    expect(reasonPassesVacuityGate('Both discuss de-dollarization of trade settlement.')).toBe(true);
  });
});

describe('acceptSimilarity (S15 full gate)', () => {
  it('requires related AND a non-vacuous reason', () => {
    expect(acceptSimilarity({ related: false, reason: 'Both cover yen policy specifics.' })).toBe(false);
    expect(acceptSimilarity({ related: true, reason: 'both are notes about things' })).toBe(false);
    expect(acceptSimilarity({ related: true, reason: 'Both analyze BOJ balance-sheet policy.' })).toBe(true);
  });
});

describe('pairKey (S15 unordered dedup)', () => {
  it('is symmetric in the two endpoints', () => {
    const a = { vaultId: 'v1', relPath: 'a.md' };
    const b = { vaultId: 'v1', relPath: 'b.md' };
    expect(pairKey(a, b)).toBe(pairKey(b, a));
  });
  it('distinguishes same relPath across vaults', () => {
    const a = { vaultId: 'v1', relPath: 'x.md' };
    const b = { vaultId: 'v2', relPath: 'x.md' };
    expect(pairKey(a, a)).not.toBe(pairKey(a, b));
  });
});

describe('ownerOf / isCrossVault (S15 ownership + S24)', () => {
  it('owner is the lexicographically smaller relPath, payload carries the other', () => {
    expect(ownerOf('z.md', 'a.md')).toEqual({ owner: 'a.md', other: 'z.md' });
    expect(ownerOf('a.md', 'z.md')).toEqual({ owner: 'a.md', other: 'z.md' });
  });
  it('detects cross-vault endpoints', () => {
    expect(isCrossVault({ vaultId: 'v1', relPath: 'a' }, { vaultId: 'v1', relPath: 'b' })).toBe(false);
    expect(isCrossVault({ vaultId: 'v1', relPath: 'a' }, { vaultId: 'v2', relPath: 'a' })).toBe(true);
  });
});
