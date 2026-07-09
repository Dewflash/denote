import { describe, expect, it } from 'vitest';
import { docFromNote, NoteSearchIndex, parseSearchQuery } from '../../src/services/searchIndex';
import { parseNote } from '../../src/domain';

describe('parseSearchQuery', () => {
  it('splits free text from filter tokens', () => {
    expect(parseSearchQuery('banking tag:finance folder:Japan')).toEqual({
      text: 'banking',
      tag: 'finance',
      folder: 'Japan',
      hasGhosts: false,
    });
  });

  it('parses vault: and has:ghosts', () => {
    expect(parseSearchQuery('vault:Personal has:ghosts')).toEqual({
      text: '',
      vault: 'Personal',
      hasGhosts: true,
    });
  });

  it('a bare query is all free text', () => {
    expect(parseSearchQuery('interest rates')).toEqual({ text: 'interest rates', hasGhosts: false });
  });

  it('is case-insensitive on filter keys, lowercases tag', () => {
    expect(parseSearchQuery('TAG:Finance')).toMatchObject({ tag: 'finance' });
  });
});

describe('NoteSearchIndex', () => {
  const noteA = parseNote('Japan/Japan.md', '# Japan\n\nDiscusses #banking policy and interest rates.');
  const noteB = parseNote('Recipes/Miso Soup.md', '# Miso Soup\n\nA cooking recipe with #food tag.');

  async function index(): Promise<NoteSearchIndex> {
    const idx = new NoteSearchIndex();
    await idx.rebuild([docFromNote(noteA, false), docFromNote(noteB, false)]);
    return idx;
  }

  it('rebuild is chunked/async (D15 pitfall: rebuild-on-load must not block the UI)', async () => {
    const idx = new NoteSearchIndex();
    const done = idx.rebuild([docFromNote(noteA, false)]);
    expect(idx.size).toBe(0); // not yet indexed synchronously
    await done;
    expect(idx.size).toBe(1);
  });

  it('finds a note by a word in its body (full-text)', async () => {
    const hits = (await index()).search('interest');
    expect(hits.map((h) => h.relPath)).toEqual(['Japan/Japan.md']);
    expect(hits[0].snippet.toLowerCase()).toContain('interest');
  });

  it('title/headings/tags/body boost order surfaces a title match above a body-only match', async () => {
    const idx = new NoteSearchIndex();
    await idx.rebuild([
      docFromNote(parseNote('a.md', '# Something Else\n\nMentions banking once in passing.'), false),
      docFromNote(parseNote('b.md', '# Banking\n\nUnrelated body text.'), false),
    ]);
    const hits = idx.search('banking');
    expect(hits[0].relPath).toBe('b.md'); // title match outranks a body-only mention
  });

  it('tag: filter narrows results', async () => {
    const hits = (await index()).search('', { tag: 'food' });
    expect(hits.map((h) => h.relPath)).toEqual(['Recipes/Miso Soup.md']);
  });

  it('folder: filter narrows to a folder prefix', async () => {
    const hits = (await index()).search('', { folder: 'Japan' });
    expect(hits.map((h) => h.relPath)).toEqual(['Japan/Japan.md']);
  });

  it('has:ghosts filter respects the per-doc flag', async () => {
    const idx = new NoteSearchIndex();
    await idx.rebuild([docFromNote(noteA, true), docFromNote(noteB, false)]);
    const hits = idx.search('', { hasGhosts: true });
    expect(hits.map((h) => h.relPath)).toEqual(['Japan/Japan.md']);
  });

  it('an empty query with no filters returns every document (wildcard)', async () => {
    expect((await index()).search('').length).toBe(2);
  });

  it('upsert replaces an existing doc rather than duplicating it', async () => {
    const idx = await index();
    idx.upsert(docFromNote(parseNote('Japan/Japan.md', '# Japan\n\nNow about #sushi instead.'), false));
    const hits = idx.search('', { folder: 'Japan' });
    expect(hits.length).toBe(1);
    expect(hits[0].snippet.toLowerCase()).toContain('sushi');
  });

  it('remove drops a doc from search results', async () => {
    const idx = await index();
    idx.remove('Japan/Japan.md');
    expect(idx.search('').map((h) => h.relPath)).toEqual(['Recipes/Miso Soup.md']);
    expect(idx.size).toBe(1);
  });

  it('remove of an absent id is a safe no-op', async () => {
    const idx = await index();
    expect(() => idx.remove('nope.md')).not.toThrow();
    expect(idx.size).toBe(2);
  });

  it('search indexes provisional ai: tags alongside user tags (S26)', async () => {
    const note = parseNote('n.md', '---\nai:\n  tags: [japan]\n---\nBare note.');
    const idx = new NoteSearchIndex();
    await idx.rebuild([docFromNote(note, false)]);
    expect(idx.search('', { tag: 'japan' }).map((h) => h.relPath)).toEqual(['n.md']);
  });
});
