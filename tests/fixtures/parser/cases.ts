// Parser fixture corpus (pass-01 brief). Data-driven so a bug found later just adds a case.
// Each case asserts the outputs it names; unspecified fields are not checked.

export interface ExpectedLink {
  target: string;
  alias?: string;
  heading?: string;
  embed?: boolean;
}

export interface ParserCase {
  name: string;
  relPath?: string; // default 'note.md'
  input: string;
  links?: ExpectedLink[]; // in document order
  tags?: string[]; // display casing, order of first appearance
  title?: string;
  headings?: { depth: number; text: string }[];
  minWarnings?: number;
}

const fence = '```';

export const parserCases: ParserCase[] = [
  // ---- wikilinks ----
  { name: 'simple wikilink', input: 'See [[Note]].', links: [{ target: 'Note' }] },
  {
    name: 'aliased wikilink',
    input: 'See [[Note|the note]].',
    links: [{ target: 'Note', alias: 'the note' }],
  },
  { name: 'embed', input: '![[Note]]', links: [{ target: 'Note', embed: true }] },
  {
    name: 'wikilink with heading',
    input: '[[Note#Section]]',
    links: [{ target: 'Note', heading: 'Section' }],
  },
  {
    name: 'wikilink with heading and alias',
    input: '[[Note#Section|shown]]',
    links: [{ target: 'Note', heading: 'Section', alias: 'shown' }],
  },
  {
    name: 'multiple links per line',
    input: 'Both [[Alpha]] and [[Beta]] here.',
    links: [{ target: 'Alpha' }, { target: 'Beta' }],
  },
  { name: 'unicode title', input: 'See [[日本語のノート]].', links: [{ target: '日本語のノート' }] },
  {
    name: 'alias may contain a pipe',
    input: '[[Note|a|b|c]]',
    links: [{ target: 'Note', alias: 'a|b|c' }],
  },
  {
    name: 'pipe before hash: hash is part of alias, not a heading',
    input: '[[Note|alias#notheading]]',
    links: [{ target: 'Note', alias: 'alias#notheading' }],
  },
  {
    name: 'block reference is heading text',
    input: '[[Note#^block-id]]',
    links: [{ target: 'Note', heading: '^block-id' }],
  },
  { name: 'empty target is not a link', input: '[[]] and [[|x]]', links: [] },
  { name: 'unclosed wikilink is plain text', input: 'text [[foo bar', links: [] },
  {
    name: 'dangling close: [[a]]b]] parses one link',
    input: '[[a]]b]]',
    links: [{ target: 'a' }],
  },
  {
    name: 'adjacent wikilinks',
    input: '[[Alpha]][[Beta]]',
    links: [{ target: 'Alpha' }, { target: 'Beta' }],
  },
  { name: 'target whitespace is trimmed', input: '[[  Spaced Note  ]]', links: [{ target: 'Spaced Note' }] },
  { name: 'subpath target preserved', input: '[[Folder/Sub Note]]', links: [{ target: 'Folder/Sub Note' }] },
  { name: 'target with .md extension preserved', input: '[[Note.md]]', links: [{ target: 'Note.md' }] },
  {
    name: 'embed with heading',
    input: '![[Note#Intro]]',
    links: [{ target: 'Note', heading: 'Intro', embed: true }],
  },
  { name: 'heading whitespace trimmed', input: '[[Note#  Deep Section  ]]', links: [{ target: 'Note', heading: 'Deep Section' }] },
  {
    name: 'alias whitespace trimmed',
    input: '[[Note|  shown  ]]',
    links: [{ target: 'Note', alias: 'shown' }],
  },

  // ---- tags ----
  { name: 'simple tag', input: 'A #finance note.', tags: ['finance'] },
  { name: 'nested tag', input: '#nested/tag', tags: ['nested/tag'] },
  { name: 'tag with dash', input: '#tag-with-dash', tags: ['tag-with-dash'] },
  { name: 'tag with underscore', input: '#tag_name', tags: ['tag_name'] },
  { name: 'hash space is a heading not a tag', input: '# Heading', tags: [] },
  { name: 'numeric-only is not a tag', input: '#123', tags: [] },
  { name: 'url anchor is not a tag', input: 'see http://x.com/#anchor here', tags: [] },
  { name: 'tag in parens', input: '(#ok) done', tags: ['ok'] },
  { name: 'trailing punctuation excluded', input: 'end #tag.', tags: ['tag'] },
  { name: 'duplicate tags deduped', input: '#dup and #dup', tags: ['dup'] },
  { name: 'tags deduped case-insensitively, first casing kept', input: '#Japan #japan', tags: ['Japan'] },
  { name: 'unicode tag', input: '#café', tags: ['café'] },
  { name: 'multiple distinct tags', input: '#a #b #c', tags: ['a', 'b', 'c'] },
  { name: 'nested dashed digit tag', input: '#nested/tag-2', tags: ['nested/tag-2'] },

  // ---- code / html masking (D20 / S5) ----
  {
    name: 'fenced code block excludes links and tags',
    input: `Real [[Yes]] #real\n\n${fence}\n[[No]] #notag\n${fence}\n`,
    links: [{ target: 'Yes' }],
    tags: ['real'],
  },
  {
    name: 'fenced code with language info string',
    input: `${fence}md\n[[Not A Link]] #not-a-tag\n${fence}\n`,
    links: [],
    tags: [],
  },
  {
    name: 'tilde fence excludes',
    input: '~~~\n[[No]] #no\n~~~\n',
    links: [],
    tags: [],
  },
  {
    name: 'inline code excludes',
    input: 'Text `[[also not a link]]` and `#nope` then [[Real]] #real.',
    links: [{ target: 'Real' }],
    tags: ['real'],
  },
  {
    name: 'indented code block excludes',
    input: 'Para.\n\n    [[Indented]] #indented\n\nAfter [[Real]].',
    links: [{ target: 'Real' }],
    tags: [],
  },
  {
    name: 'html block excludes',
    input: '<div>\n[[InHtml]] #inhtml\n</div>\n',
    links: [],
    tags: [],
  },

  // ---- title / headings / frontmatter ----
  { name: 'title from first H1', input: '# Real Title\n\nBody.', title: 'Real Title' },
  { name: 'title falls back to filename when no H1', relPath: 'Untitled Capture.md', input: 'Body only.', title: 'Untitled Capture' },
  {
    name: 'first H1 wins even when an H2 precedes it',
    input: '## Sub\n\n# The One\n\n# Second H1',
    title: 'The One',
    headings: [
      { depth: 2, text: 'Sub' },
      { depth: 1, text: 'The One' },
      { depth: 1, text: 'Second H1' },
    ],
  },
  {
    name: 'only H2 present → filename fallback',
    relPath: 'folder/My File.md',
    input: '## Only a subheading',
    title: 'My File',
  },
  {
    name: 'user frontmatter preserved; body link parsed; frontmatter not scanned',
    input: '---\ntitle: Meta Title\naliases: [[should not parse]]\ntags: [fmtag]\n---\n\nBody [[Real]] #bodytag.',
    links: [{ target: 'Real' }],
    tags: ['bodytag'],
  },
  {
    name: 'malformed frontmatter records a warning and does not throw',
    input: '---\ntitle: [unterminated\n---\nBody [[Real]].',
    links: [{ target: 'Real' }],
    minWarnings: 1,
  },
  {
    name: 'empty input yields nothing',
    input: '',
    links: [],
    tags: [],
  },
  {
    name: 'mixed real and masked on consecutive lines',
    input: `# Doc\n\nLive [[One]] #live\n\n${fence}\n[[Two]] #dead\n${fence}\n\nLive [[Three|third]].`,
    links: [{ target: 'One' }, { target: 'Three', alias: 'third' }],
    tags: ['live'],
    title: 'Doc',
  },
];
