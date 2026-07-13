import { describe, expect, it } from 'vitest';
import { buildGraph } from '../../src/domain/graphBuilder';
import { parseNote } from '../../src/domain/parser';
import type { Topic } from '../../src/domain/types';

const V = 'vault-1';
const V2 = 'vault-2';

describe('graphBuilder (D6/D6a/D7/D17)', () => {
  it('two-note wikilink', () => {
    const notes = [
      parseNote('A.md', '# A\n\n[[B]]'),
      parseNote('B.md', '# B\n'),
    ];
    const g = buildGraph({ vaults: [{ vaultId: V, notes }] });
    expect(g).toMatchSnapshot();
    const edge = g.edges.find((e) => e.type === 'wikilink');
    expect(edge).toMatchObject({ from: 'vault-1/A.md', to: 'vault-1/B.md', source: 'parser' });
  });

  it('ghost node for an unresolved link', () => {
    const notes = [parseNote('Japan.md', '# Japan\n\n[[Bank of Japan]]')];
    const g = buildGraph({ vaults: [{ vaultId: V, notes }] });
    expect(g.nodes.find((n) => n.type === 'ghost')?.id).toBe('ghost:vault-1/bank of japan');
    expect(g).toMatchSnapshot();
  });

  it('tag hub with 3 notes → exactly 3 note→tag edges, zero note→note edges (no clique)', () => {
    const notes = [
      parseNote('a.md', '# A\n#japan'),
      parseNote('b.md', '# B\n#japan'),
      parseNote('c.md', '# C\n#japan'),
    ];
    const g = buildGraph({ vaults: [{ vaultId: V, notes }] });
    const tagEdges = g.edges.filter((e) => e.type === 'note-tag');
    expect(tagEdges).toHaveLength(3);
    expect(g.edges.every((e) => e.type !== 'wikilink' || false)).toBe(true);
    // no note→note edge of any kind
    const noteIds = new Set(g.nodes.filter((n) => n.type === 'note').map((n) => n.id));
    expect(g.edges.some((e) => noteIds.has(e.from) && noteIds.has(e.to))).toBe(false);
    expect(g.nodes.find((n) => n.type === 'tag')?.id).toBe('tag:japan');
    expect(g).toMatchSnapshot();
  });

  it('embed edge is typed embed, not wikilink', () => {
    const notes = [parseNote('a.md', '# A\n![[B]]'), parseNote('B.md', '# B\n')];
    const g = buildGraph({ vaults: [{ vaultId: V, notes }] });
    expect(g.edges.find((e) => e.from === 'vault-1/a.md')?.type).toBe('embed');
  });

  it('parallel wikilinks to the same note collapse into one weighted edge', () => {
    const notes = [parseNote('a.md', '# A\n[[B]] and again [[B]]'), parseNote('B.md', '# B\n')];
    const g = buildGraph({ vaults: [{ vaultId: V, notes }] });
    const edges = g.edges.filter((e) => e.type === 'wikilink');
    expect(edges).toHaveLength(1);
    expect(edges[0].weight).toBe(2);
  });

  it('topic hub: note→topic and topic→topic hierarchy edges (source ai)', () => {
    const notes = [parseNote('Japan.md', '# Japan\n'), parseNote('Yen.md', '# Yen\n')];
    const topics: Topic[] = [
      {
        id: 'finance',
        name: 'Finance',
        aliases: [],
        parentId: null,
        relatedIds: [],
        source: 'ai',
        members: [],
      },
      {
        id: 'banking',
        name: 'Banking',
        aliases: [],
        parentId: 'finance',
        relatedIds: [],
        source: 'ai',
        members: [
          { notePath: 'Japan.md', weight: 0.9 },
          { notePath: 'Yen.md', weight: 0.8 },
        ],
      },
    ];
    const g = buildGraph({ vaults: [{ vaultId: V, notes, topics }] });
    expect(g.edges.filter((e) => e.type === 'note-topic')).toHaveLength(2);
    const hier = g.edges.find((e) => e.type === 'topic-topic');
    expect(hier).toMatchObject({ from: 'topic:banking', to: 'topic:finance', source: 'ai' });
    expect(g.edges.filter((e) => e.type === 'note-topic').every((e) => e.source === 'ai' && e.reason)).toBe(true);
    expect(g).toMatchSnapshot();
  });

  it('cross-vault id namespacing: same relPath in two vaults → distinct nodes; shared tag hub merges', () => {
    const g = buildGraph({
      vaults: [
        { vaultId: V, notes: [parseNote('Note.md', '# Note\n#shared')] },
        { vaultId: V2, notes: [parseNote('Note.md', '# Note\n#shared')] },
      ],
    });
    const noteNodes = g.nodes.filter((n) => n.type === 'note').map((n) => n.id);
    expect(noteNodes).toEqual(['vault-1/Note.md', 'vault-2/Note.md']);
    // one global tag hub, two note→tag edges into it
    expect(g.nodes.filter((n) => n.type === 'tag')).toHaveLength(1);
    expect(g.edges.filter((e) => e.type === 'note-tag')).toHaveLength(2);
    expect(g).toMatchSnapshot();
  });

  it('ai-similar edge carries reason + confidence and is unordered/deduped', () => {
    const g = buildGraph({
      vaults: [
        { vaultId: V, notes: [parseNote('Untitled Capture.md', 'banks merging'), parseNote('Yen.md', '# Yen\n')] },
      ],
      similarPairs: [
        {
          aVaultId: V,
          aRelPath: 'Yen.md',
          bVaultId: V,
          bRelPath: 'Untitled Capture.md',
          reason: 'both discuss BOJ zero-rate policy and its effect on regional banks',
          confidence: 0.82,
        },
      ],
    });
    const sim = g.edges.filter((e) => e.type === 'ai-similar');
    expect(sim).toHaveLength(1);
    expect(sim[0]).toMatchObject({ source: 'ai', confidence: 0.82 });
    expect(sim[0].reason).toContain('BOJ');
    // owned by lexicographically smaller relPath endpoint ordering
    expect(sim[0].from < sim[0].to).toBe(true);
    expect(g).toMatchSnapshot();
  });

  it('ai-similar edge whose endpoint is not loaded is dropped (S24)', () => {
    const g = buildGraph({
      vaults: [{ vaultId: V, notes: [parseNote('a.md', '# A\n')] }],
      similarPairs: [
        { aVaultId: V, aRelPath: 'a.md', bVaultId: V2, bRelPath: 'missing.md', reason: 'x'.repeat(20), confidence: 0.7 },
      ],
    });
    expect(g.edges.filter((e) => e.type === 'ai-similar')).toHaveLength(0);
  });

  it('renders AI provisional links and tags without pretending the user typed them', () => {
    const notes = [
      parseNote('Japan.md', `---\nai:\n  v: 1\n  links: ["Bank of Japan"]\n  tags: [macro]\n  model: apple-fm@1\n---\n# Japan`),
      parseNote('Bank.md', '# Bank of Japan'),
    ];
    const g = buildGraph({ vaults: [{ vaultId: V, notes }] });
    expect(g.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'ai-link', source: 'ai', from: 'vault-1/Japan.md', to: 'vault-1/Bank.md', confidence: 0.75, reason: expect.any(String) }),
      expect.objectContaining({ type: 'ai-tag', source: 'ai', to: 'tag:macro', confidence: 0.75, reason: expect.any(String) }),
    ]));
    expect(g.edges.some((edge) => edge.type === 'wikilink')).toBe(false);
  });

  it('renders live AI link suggestions before they are accepted', () => {
    const notes = [
      parseNote('Japan.md', '# Japan\nCentral bank policy.\n'),
      parseNote('Bank.md', '# Bank of Japan\nInterest rates.\n'),
    ];
    const g = buildGraph({
      vaults: [{ vaultId: V, notes }],
      aiLinks: [{
        vaultId: V,
        relPath: 'Japan.md',
        target: 'Bank of Japan',
        targetPath: 'Bank.md',
        reason: 'Both notes discuss central-bank policy.',
        confidence: 0.86,
      }],
    });
    expect(g.edges).toContainEqual(expect.objectContaining({
      id: 'ai-link:vault-1/Japan.md->vault-1/Bank.md',
      type: 'ai-link',
      source: 'ai',
      confidence: 0.86,
      reason: 'Both notes discuss central-bank policy.',
    }));
  });

  it('deduplicates AI links against a differently-worded typed link and recovers stale paths', () => {
    const notes = [
      parseNote('Japan.md', '# Japan\nAlready connected: [[Bank]].\n'),
      parseNote('Bank.md', '# Bank of Japan\n'),
    ];
    const duplicate = buildGraph({
      vaults: [{ vaultId: V, notes }],
      aiLinks: [{ vaultId: V, relPath: 'Japan.md', target: 'Bank of Japan', targetPath: 'Bank.md', reason: 'same', confidence: 0.9 }],
    });
    expect(duplicate.edges.filter((e) => e.type === 'ai-link')).toHaveLength(0);

    const recovered = buildGraph({
      vaults: [{ vaultId: V, notes: [parseNote('Japan.md', '# Japan\n'), notes[1]] }],
      aiLinks: [{ vaultId: V, relPath: 'Japan.md', target: 'Bank of Japan', targetPath: 'Old/Bank.md', reason: 'renamed', confidence: 0.9 }],
    });
    expect(recovered.edges).toContainEqual(expect.objectContaining({ type: 'ai-link', to: 'vault-1/Bank.md' }));
  });

  it('output is deterministic (nodes and edges sorted by id)', () => {
    const build = () =>
      buildGraph({
        vaults: [
          { vaultId: V2, notes: [parseNote('z.md', '# Z\n[[q]] #t')] },
          { vaultId: V, notes: [parseNote('a.md', '# A\n#t')] },
        ],
      });
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
    const g = build();
    const nodeIds = g.nodes.map((n) => n.id);
    expect([...nodeIds].sort()).toEqual(nodeIds);
  });
});
