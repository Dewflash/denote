// Pass-06 domain tests: the `ai:` frontmatter writer (R1-critical contentHash invariance),
// accept-application writes, and the rejection fingerprint (S11).

import { describe, expect, it } from 'vitest';
import {
  aiBlockUnchanged,
  applyAcceptedAnnotation,
  buildAiFrontmatter,
  contentHash,
  normalize,
  parseNote,
  rejectionFingerprint,
  writeAiFrontmatter,
  type AiAnnotation,
  type AiFrontmatter,
} from '../../src/domain';
import { sha256Hex } from '../../src/domain/sha256';

const AI: AiFrontmatter = {
  v: 1,
  tags: ['finance', 'banking'],
  links: ['Banking Policy'],
  topics: ['topic-uuid-1'],
  applied: '2026-07-07T12:00:00Z',
  model: 'mock@1',
};

const SAMPLES = [
  '',
  '# Foo\nBody text.\n',
  'No heading, just body.',
  '---\ntitle: X\n---\n# Foo\nBody.\n',
  '---\ntitle: X\ntags: [a, b]\ncreated: 2026-01-01\n---\nBody.\n',
  '---\ntitle: X\nai:\n  v: 1\n  tags: [old]\n---\nBody.\n', // already has an ai: block
];

describe('writeAiFrontmatter — R1 contentHash invariance', () => {
  it('adding an ai: block never changes contentHash (D3a/S1)', () => {
    for (const text of SAMPLES) {
      const withAi = writeAiFrontmatter(text, AI);
      expect(contentHash(withAi)).toBe(contentHash(text));
    }
  });

  it('removing the ai: block never changes contentHash and restores user frontmatter', () => {
    for (const text of SAMPLES) {
      const withAi = writeAiFrontmatter(text, AI);
      const removed = writeAiFrontmatter(withAi, null);
      expect(contentHash(removed)).toBe(contentHash(text));
    }
  });

  it('a note with only an ai: block strips back to the bare body (V1)', () => {
    const withAi = writeAiFrontmatter('# Foo\nBody.\n', AI);
    expect(writeAiFrontmatter(withAi, null)).toBe('# Foo\nBody.\n');
  });

  it('demotion preserves user frontmatter verbatim', () => {
    const text = '---\ntitle: X\ntags: [a, b]\n---\nBody.\n';
    const withAi = writeAiFrontmatter(text, AI);
    expect(writeAiFrontmatter(withAi, null)).toBe(normalize(text));
  });

  it('is idempotent — rewriting the same block is byte-identical', () => {
    const withAi = writeAiFrontmatter('# Foo\n', AI);
    expect(writeAiFrontmatter(withAi, AI)).toBe(withAi);
    expect(aiBlockUnchanged(withAi, AI)).toBe(true);
  });

  it('replaces a pre-existing ai: block rather than duplicating it', () => {
    const text = '---\ntitle: X\nai:\n  v: 1\n  tags: [old]\n---\nBody.\n';
    const withAi = writeAiFrontmatter(text, AI);
    expect(withAi.match(/^ai:/gm)?.length ?? 0).toBe(1);
    const parsed = parseNote('n.md', withAi);
    expect(parsed.aiFrontmatter?.tags).toEqual(['finance', 'banking']);
  });

  it('the parser reads the written block back (round-trip)', () => {
    const withAi = writeAiFrontmatter('---\ntitle: X\n---\nBody.\n', AI);
    const parsed = parseNote('n.md', withAi);
    expect(parsed.aiFrontmatter).toMatchObject({
      v: 1,
      tags: ['finance', 'banking'],
      links: ['Banking Policy'],
      topics: ['topic-uuid-1'],
      model: 'mock@1',
    });
    expect(parsed.frontmatter.title).toBe('X');
    // The ai: tags/links are NOT user structure — the note stays "bare".
    expect(parsed.tags).toEqual([]);
    expect(parsed.links).toEqual([]);
  });
});

describe('buildAiFrontmatter', () => {
  it('collects provisionable kinds into the ai: schema, deduped', () => {
    const anns: AiAnnotation[] = [
      mkAnn('tag', { name: 'finance' }),
      mkAnn('tag', { name: 'Finance' }), // dup (case-insensitive)
      mkAnn('link', { target: 'Banking Policy' }),
      mkAnn('topic', { name: 'Banking', existingTopicId: 'tid-1' }),
      mkAnn('summary', { text: 'ignored' }), // not provisionable
    ];
    const ai = buildAiFrontmatter(anns, 'mock@1', '2026-07-07T00:00:00Z');
    expect(ai.tags).toEqual(['finance']);
    expect(ai.links).toEqual(['Banking Policy']);
    expect(ai.topics).toEqual(['tid-1']); // prefers existingTopicId
    expect(ai.model).toBe('mock@1');
  });
});

describe('applyAcceptedAnnotation', () => {
  it('link accept appends a wikilink under ## Related (created once)', () => {
    const out = applyAcceptedAnnotation('# Note\nBody.\n', mkAnn('link', { target: 'Banking Policy' }));
    expect(out).toContain('## Related');
    expect(out).toContain('[[Banking Policy]]');
    // Accepting the same link again is a no-op (already present).
    expect(applyAcceptedAnnotation(out, mkAnn('link', { target: 'Banking Policy' }))).toBe(out);
    // A second, different link reuses the section.
    const out2 = applyAcceptedAnnotation(out, mkAnn('link', { target: 'Gold' }));
    expect(out2.match(/## Related/g)?.length).toBe(1);
    expect(out2).toContain('[[Gold]]');
  });

  it('link accept with a span wraps the existing body text in place', () => {
    const t = '# Note\nSee gold here.\n';
    const from = t.indexOf('gold');
    const out = applyAcceptedAnnotation(t, mkAnn('link', { target: 'Gold', span: { from, to: from + 4 } }));
    expect(out).toContain('See [[gold]] here.');
  });

  it('tag accept creates a frontmatter tags: list, then merges + dedupes', () => {
    const created = applyAcceptedAnnotation('# Note\nBody.\n', mkAnn('tag', { name: 'finance' }));
    expect(created).toBe('---\ntags: [finance]\n---\n# Note\nBody.\n');
    const merged = applyAcceptedAnnotation(created, mkAnn('tag', { name: 'banking' }));
    expect(merged).toContain('tags: [finance, banking]');
    const deduped = applyAcceptedAnnotation(merged, mkAnn('tag', { name: 'Finance' }));
    expect(deduped).toBe(merged);
  });

  it('tag accept appends to a block-style tags: sequence', () => {
    const t = '---\ntags:\n  - a\n---\nBody.\n';
    const out = applyAcceptedAnnotation(t, mkAnn('tag', { name: 'b' }));
    expect(out).toBe('---\ntags:\n  - a\n  - b\n---\nBody.\n');
  });

  it('summary accept sets a frontmatter scalar', () => {
    const out = applyAcceptedAnnotation('# Note\nBody.\n', mkAnn('summary', { text: 'A short summary.' }));
    expect(out).toContain('summary: "A short summary."');
  });
});

describe('rejectionFingerprint (S11)', () => {
  it('is kind + \\x1f + normalized target, reason-independent', () => {
    expect(rejectionFingerprint('tag', { name: 'Finance' })).toBe(sha256Hex('tag\x1ffinance'));
  });
  it('link prefers the resolved path over the raw target', () => {
    expect(rejectionFingerprint('link', { target: 'Foo', targetPath: 'Sub/Foo.md' })).toBe(
      sha256Hex('link\x1fsub/foo.md'),
    );
    expect(rejectionFingerprint('link', { target: 'Foo' })).toBe(sha256Hex('link\x1ffoo'));
  });
  it('summary uses only the first 64 chars', () => {
    const long = 'a'.repeat(100);
    expect(rejectionFingerprint('summary', { text: long })).toBe(
      sha256Hex('summary\x1f' + 'a'.repeat(64)),
    );
  });
});

let seq = 0;
function mkAnn(kind: AiAnnotation['kind'], payload: unknown): AiAnnotation {
  return {
    id: `ann-${seq++}`,
    notePath: 'n.md',
    contentHash: 'h',
    kind,
    payload,
    confidence: 0.9,
    reason: 'a specific stated reason for this suggestion',
    status: 'suggested',
    model: 'mock@1',
    createdAt: '2026-07-07T00:00:00Z',
  };
}
