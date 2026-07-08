import { describe, expect, it } from 'vitest';
import { resolveLink, buildLinkIndex, type NoteRef } from '../../src/domain/links';
import { parseNote } from '../../src/domain/parser';

const V = 'vault-1';

const notes: NoteRef[] = [
  { relPath: 'Japan/Japan.md', title: 'Japan' },
  { relPath: 'Economics/Interest Rates.md', title: 'Interest Rates' },
  { relPath: 'Japan/Yen Intervention.md', title: 'Yen Intervention' },
];

describe('S4 link resolution', () => {
  it('step 1: exact relPath with and without .md (case-insensitive)', () => {
    expect(resolveLink('Japan/Japan', notes, V)).toMatchObject({ kind: 'note', relPath: 'Japan/Japan.md', matchType: 'path' });
    expect(resolveLink('japan/japan.md', notes, V)).toMatchObject({ kind: 'note', relPath: 'Japan/Japan.md', matchType: 'path' });
  });

  it('step 2: filename basename match', () => {
    expect(resolveLink('Yen Intervention', notes, V)).toMatchObject({ kind: 'note', relPath: 'Japan/Yen Intervention.md', matchType: 'filename' });
  });

  it('step 3: title match when filename differs from title', () => {
    const dated: NoteRef[] = [{ relPath: 'daily/2026-05-01.md', title: 'Journal Entry' }];
    expect(resolveLink('Journal Entry', dated, V)).toMatchObject({ kind: 'note', relPath: 'daily/2026-05-01.md', matchType: 'title' });
  });

  it('no hit → ghost keyed by lowercased NFC target ([[Foo]] and [[foo]] share a ghost)', () => {
    const a = resolveLink('Bank of Japan', notes, V);
    const b = resolveLink('bank of japan', notes, V);
    expect(a).toEqual({ kind: 'ghost', id: `ghost:${V}/bank of japan` });
    expect(b).toEqual(a);
  });

  it('ghost id is vault-namespaced', () => {
    expect(resolveLink('X', notes, 'vault-A')).not.toEqual(resolveLink('X', notes, 'vault-B'));
  });

  it('tie-break among filename matches: equal length → lexicographic', () => {
    const dup: NoteRef[] = [
      { relPath: 'z/Note.md', title: 'Z' },
      { relPath: 'a/Note.md', title: 'A' },
    ];
    // filename 'Note' matches both (no root Note.md to path-match); equal length → 'a/Note.md'
    expect(resolveLink('Note', dup, V)).toMatchObject({ relPath: 'a/Note.md', matchType: 'filename' });
  });

  it('tie-break by shortest relPath first', () => {
    const dup: NoteRef[] = [
      { relPath: 'deep/nested/Note.md', title: 'A' },
      { relPath: 'x/Note.md', title: 'B' },
    ];
    expect(resolveLink('Note', dup, V)).toMatchObject({ relPath: 'x/Note.md', matchType: 'filename' });
  });

  it('path match precedes filename/title match', () => {
    const set: NoteRef[] = [
      { relPath: 'A/Target.md', title: 'Target' },
      { relPath: 'Target.md', title: 'Something Else' },
    ];
    // 'Target' as filename matches both, but 'A/Target' path-form must resolve to A/Target.md
    expect(resolveLink('A/Target', set, V)).toMatchObject({ relPath: 'A/Target.md', matchType: 'path' });
  });
});

describe('buildLinkIndex', () => {
  it('resolves every outbound link, keeping ghosts', () => {
    const japan = parseNote('Japan/Japan.md', '# Japan\n\n[[Yen Intervention]] and [[Bank of Japan]].');
    const index = buildLinkIndex([japan, ...notes.map((n) => parseNote(n.relPath, `# ${n.title}\n`))], V);
    const fromJapan = index.filter((e) => e.fromPath === 'Japan/Japan.md');
    expect(fromJapan.map((e) => e.resolution.kind)).toEqual(['note', 'ghost']);
  });
});
