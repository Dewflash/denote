import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/domain/sha256';

const nodeSha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('pure sha256 matches node:crypto (ground truth for the browser-safe impl)', () => {
  it('known answers', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('agrees with node:crypto across varied inputs (lengths spanning block boundaries)', () => {
    const samples = [
      '',
      'a',
      'hello world',
      '# Japan\n\nBanking notes.\n',
      'café — naïve façade — 日本語のノート — 🚀',
      'x'.repeat(55), // one byte under a block
      'x'.repeat(56), // forces an extra padding block
      'x'.repeat(64),
      'x'.repeat(1000),
      '---\ntitle: T\n---\nbody with #tags and [[links]]\n',
    ];
    for (const s of samples) {
      expect(sha256Hex(s), JSON.stringify(s.slice(0, 20))).toBe(nodeSha(s));
    }
  });
});
