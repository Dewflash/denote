// Ported verbatim from docs/reference/hash_spec_test.mjs (architect-verified 2026-07-07).
// If these disagree with the reference script, the implementation is wrong (pass-01 brief).

import { describe, expect, it } from 'vitest';
import { contentHash, stripAiBlock } from '../../src/domain/hashing';

const hash = contentHash;
const body = '# Japan\n\nBanking notes.\n';

describe('S1 contentHash — mandatory vectors', () => {
  it('V1 bare note == ai-only frontmatter prepended', () => {
    expect(hash(body)).toBe(hash(`---\nai:\n  v: 1\n  tags: [finance]\n---\n${body}`));
  });

  it('V2 ai: block position (first/middle/last) is irrelevant', () => {
    const fmA = `---\nai:\n  tags: [x]\ntitle: Japan\ndate: 2026-01-01\n---\n${body}`;
    const fmB = `---\ntitle: Japan\nai:\n  tags: [x]\ndate: 2026-01-01\n---\n${body}`;
    const fmC = `---\ntitle: Japan\ndate: 2026-01-01\nai:\n  tags: [x]\n---\n${body}`;
    expect(hash(fmA)).toBe(hash(fmB));
    expect(hash(fmB)).toBe(hash(fmC));
  });

  it('V3 changing ai: payload does not change the hash', () => {
    const fmC = `---\ntitle: Japan\ndate: 2026-01-01\nai:\n  tags: [x]\n---\n${body}`;
    expect(hash(fmC)).toBe(hash(fmC.replace('[x]', '[x, y, z]')));
  });

  it('V4 changing a user frontmatter key changes the hash', () => {
    const fmC = `---\ntitle: Japan\ndate: 2026-01-01\nai:\n  tags: [x]\n---\n${body}`;
    expect(hash(fmC)).not.toBe(hash(fmC.replace('Japan', 'Nippon')));
  });

  it('V5 changing the body changes the hash', () => {
    const fmC = `---\ntitle: Japan\ndate: 2026-01-01\nai:\n  tags: [x]\n---\n${body}`;
    expect(hash(fmC)).not.toBe(hash(fmC.replace('Banking', 'Cooking')));
  });

  it('V6 CRLF == LF', () => {
    expect(hash(body.replace(/\n/g, '\r\n'))).toBe(hash(body));
  });

  it('V7 NFC == NFD', () => {
    // 'Café' composed vs decomposed e + combining acute
    expect(hash('# Café\n')).toBe(hash('# Café\n'));
  });

  it('V8 inline ai: {tags: [x]} stripped like the block form', () => {
    expect(hash(body)).toBe(hash(`---\nai: {tags: [x]}\n---\n${body}`));
  });

  it('V9 blank line inside the ai: block (followed by indented line) stays in the block', () => {
    expect(hash(`---\ntitle: T\n---\n${body}`)).toBe(
      hash(`---\ntitle: T\nai:\n  tags: [x]\n\n  links: [y]\n---\n${body}`),
    );
  });

  it('V10 `aim:` and nested `  ai:` are NOT stripped', () => {
    expect(hash(`---\naim: goals\n---\n${body}`)).not.toBe(hash(body));
    expect(hash(`---\nmeta:\n  ai: userdata\n---\n${body}`)).not.toBe(hash(body));
  });

  it('V11 stripAiBlock is idempotent', () => {
    const fmC = `---\ntitle: Japan\ndate: 2026-01-01\nai:\n  tags: [x]\n---\n${body}`;
    expect(stripAiBlock(fmC)).toBe(stripAiBlock(stripAiBlock(fmC)));
  });

  it('V12 unterminated frontmatter is hashed as-is (no strip, no crash)', () => {
    expect(hash(`---\nai:\n  tags: [x]\n${body}`)).not.toBe(hash(body));
  });
});

describe('S1 property (R1): ai: block edits never change the hash', () => {
  const base = `---\ntitle: Japan\ndate: 2026-01-01\n---\n${body}`;
  const withAi = `---\ntitle: Japan\ndate: 2026-01-01\nai:\n  v: 1\n  tags: [finance, banking]\n  links: ["Yen Intervention"]\n---\n${body}`;
  const withAiChanged = `---\ntitle: Japan\ndate: 2026-01-01\nai:\n  v: 1\n  tags: [cooking]\n---\n${body}`;

  it('adding, changing, or removing ONLY the ai: block yields the same hash', () => {
    expect(hash(base)).toBe(hash(withAi));
    expect(hash(withAi)).toBe(hash(withAiChanged));
    expect(hash(withAiChanged)).toBe(hash(base));
  });

  it('BOM is stripped before hashing', () => {
    expect(hash('﻿' + body)).toBe(hash(body));
  });
});
