import { describe, expect, it } from 'vitest';
import { parseNote } from '../../src/domain/parser';
import type { WikiLink } from '../../src/domain/types';
import { parserCases, type ExpectedLink } from '../fixtures/parser/cases';

function linkShape(l: WikiLink): ExpectedLink {
  const out: ExpectedLink = { target: l.targetTitle };
  if (l.alias !== undefined) out.alias = l.alias;
  if (l.heading !== undefined) out.heading = l.heading;
  if (l.embed) out.embed = true;
  return out;
}

describe('parser fixture corpus', () => {
  for (const c of parserCases) {
    it(c.name, () => {
      const parsed = parseNote(c.relPath ?? 'note.md', c.input);
      expect(parsed.warnings, `unexpected throw for "${c.name}"`).toBeDefined();

      if (c.links !== undefined) {
        expect(parsed.links.map(linkShape)).toEqual(c.links);
      }
      if (c.tags !== undefined) {
        expect(parsed.tags).toEqual(c.tags);
      }
      if (c.title !== undefined) {
        expect(parsed.title).toBe(c.title);
      }
      if (c.headings !== undefined) {
        expect(parsed.headings).toEqual(c.headings);
      }
      if (c.minWarnings !== undefined) {
        expect(parsed.warnings.length).toBeGreaterThanOrEqual(c.minWarnings);
      }
    });
  }
});

// S3 tag grammar vectors — ported from docs/reference/hash_spec_test.mjs.
describe('S3 tag grammar vectors', () => {
  const cases: [string, string[]][] = [
    ['see #finance and #nested/tag-2', ['finance', 'nested/tag-2']],
    ['#123 is not a tag', []],
    ['url http://x.com/#anchor stays', []],
    ['(#ok) punctuation', ['ok']],
    ['# heading not tag', []],
    ['end punctuation #tag.', ['tag']],
  ];
  for (const [input, want] of cases) {
    it(`"${input}"`, () => {
      expect(parseNote('n.md', input).tags).toEqual(want);
    });
  }
});

describe('wikilink offsets are exact (for editor decorations)', () => {
  it('reports token start/end including the embed bang', () => {
    const input = 'a ![[Note#H|x]] b';
    const [link] = parseNote('n.md', input).links;
    expect(input.slice(link.offsetStart, link.offsetEnd)).toBe('![[Note#H|x]]');
    expect(link.embed).toBe(true);
    expect(link.targetTitle).toBe('Note');
    expect(link.heading).toBe('H');
    expect(link.alias).toBe('x');
  });

  it('non-embed offsets exclude any preceding char', () => {
    const input = 'x[[Note]]y';
    const link = parseNote('n.md', input).links[0];
    expect(input.slice(link.offsetStart, link.offsetEnd)).toBe('[[Note]]');
  });
});

describe('never throws on malformed input', () => {
  const nasties = ['[[', ']]', '#', '![[', '---\n', '[[a#|]]', '﻿# BOM', '```\nunclosed fence'];
  for (const input of nasties) {
    it(JSON.stringify(input), () => {
      expect(() => parseNote('n.md', input)).not.toThrow();
    });
  }
});
