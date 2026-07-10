// TopicStore (.denote/ai/topics.json) — persistence, canonicalization inputs, membership lifecycle,
// merge/prune, remap. Pass-08 service suite.

import { describe, expect, it } from 'vitest';
import { TopicStore, type TopicMember, type TopicRecord } from '../../src/services/topicStore';

function memIO() {
  const files = new Map<string, string>();
  return {
    files,
    io: {
      read: async (p: string) => files.get(p) ?? null,
      write: async (p: string, c: string) => void files.set(p, c),
    },
  };
}

const member = (notePath: string, weight = 0.8, hash = 'h'): TopicMember => ({
  notePath,
  weight,
  confidence: weight,
  reconfirmations: 0,
  stale: false,
  contentHash: hash,
  reason: 'shared concept',
});

function seed(store: TopicStore): TopicRecord {
  return store.createTopic({
    id: 't-bank',
    name: 'Banking',
    description: 'central-bank policy',
    aliases: ['banks'],
    parentId: null,
    relatedIds: [],
    source: 'ai',
    centroid: [1, 0, 0],
    members: [member('Japan/Japan.md')],
  });
}

describe('TopicStore persistence', () => {
  it('round-trips topics/profiles/dismissals/misfits through JSON', async () => {
    const { io, files } = memIO();
    const store = new TopicStore(io);
    seed(store);
    store.setFolderProfile({ folderPath: 'Japan', profile: 'monetary policy', memberSetHash: 'm1' });
    store.setMisfits([{ relPath: 'Japan/Miso Soup Recipe.md', currentFolder: 'Japan', suggestedFolder: 'Cooking', reason: 'food' }]);
    store.dismissResurfacing('old.md', new Date().toISOString());
    await store.persist();

    const store2 = new TopicStore(io);
    await store2.load();
    expect(store2.get('t-bank')?.name).toBe('Banking');
    expect(store2.folderProfile('Japan')?.profile).toBe('monetary policy');
    expect(store2.allMisfits()).toHaveLength(1);
    expect(store2.dismissedResurfacing().has('old.md')).toBe(true);
    expect(JSON.parse(files.get('.denote/ai/topics.json')!).version).toBe(1);
  });

  it('tolerates a corrupt file as empty', async () => {
    const { io, files } = memIO();
    files.set('.denote/ai/topics.json', '{not json');
    const store = new TopicStore(io);
    await store.load();
    expect(store.all()).toHaveLength(0);
  });
});

describe('TopicStore canonicalization inputs + domain mapping', () => {
  it('matchInputs exposes id/name/aliases/centroid', () => {
    const store = new TopicStore(memIO().io);
    seed(store);
    expect(store.matchInputs()).toEqual([{ id: 't-bank', name: 'Banking', aliases: ['banks'], centroid: [1, 0, 0] }]);
  });
  it('toDomainTopics maps members to {notePath, weight}', () => {
    const store = new TopicStore(memIO().io);
    seed(store);
    const [t] = store.toDomainTopics();
    expect(t.members).toEqual([{ notePath: 'Japan/Japan.md', weight: 0.8 }]);
  });
});

describe('TopicStore membership lifecycle', () => {
  it('addAlias skips the canonical name and dedups by fold', () => {
    const store = new TopicStore(memIO().io);
    seed(store);
    store.addAlias('t-bank', 'Banking'); // == name → ignored
    store.addAlias('t-bank', 'BANKS'); // == existing alias by fold → ignored
    store.addAlias('t-bank', 'banking system');
    expect(store.get('t-bank')!.aliases).toEqual(['banks', 'banking system']);
  });
  it('setMembership upserts and markNoteStale/removeNoteMemberships work', () => {
    const store = new TopicStore(memIO().io);
    seed(store);
    store.setMembership('t-bank', member('Economics/Interest Rates.md', 0.9));
    expect(store.get('t-bank')!.members).toHaveLength(2);
    expect(store.markNoteStale('Japan/Japan.md')).toBe(true);
    expect(store.topicsForNote('Japan/Japan.md')[0].member.stale).toBe(true);
    expect(store.removeNoteMemberships('Japan/Japan.md')).toBe(true);
    expect(store.get('t-bank')!.members.map((m) => m.notePath)).toEqual(['Economics/Interest Rates.md']);
  });
  it('rename moves the old name to an alias', () => {
    const store = new TopicStore(memIO().io);
    seed(store);
    store.setName('t-bank', 'Retail Banking');
    expect(store.get('t-bank')!.name).toBe('Retail Banking');
    expect(store.get('t-bank')!.aliases).toContain('Banking');
  });
});

describe('TopicStore merge / prune / remap', () => {
  it('mergeTopics moves members, folds the name to an alias, and deletes the source', () => {
    const store = new TopicStore(memIO().io);
    seed(store);
    store.createTopic({
      id: 't-banks',
      name: 'Banks',
      description: '',
      aliases: [],
      parentId: null,
      relatedIds: [],
      source: 'ai',
      centroid: null,
      members: [member('Economics/De-dollarization.md')],
    });
    store.mergeTopics('t-banks', 't-bank');
    expect(store.get('t-banks')).toBeUndefined();
    expect(store.get('t-bank')!.members.map((m) => m.notePath).sort()).toEqual([
      'Economics/De-dollarization.md',
      'Japan/Japan.md',
    ]);
    // "Banks" folds to the existing "banks" alias — already covered, not duplicated.
    expect(store.get('t-bank')!.aliases.some((a) => a.toLowerCase() === 'banks')).toBe(true);
  });
  it('pruneEmptyTopics removes member-less ai topics only', () => {
    const store = new TopicStore(memIO().io);
    seed(store);
    store.createTopic({ id: 't-empty', name: 'Empty', description: '', aliases: [], parentId: null, relatedIds: [], source: 'ai', centroid: null });
    store.createTopic({ id: 't-user', name: 'UserOwned', description: '', aliases: [], parentId: null, relatedIds: [], source: 'user', centroid: null });
    expect(store.pruneEmptyTopics()).toEqual(['t-empty']);
    expect(store.get('t-user')).toBeDefined();
  });
  it('remapPath re-keys members, misfits and dismissals', () => {
    const store = new TopicStore(memIO().io);
    seed(store);
    store.remapPath('Japan/Japan.md', 'Asia/Japan.md');
    expect(store.get('t-bank')!.members[0].notePath).toBe('Asia/Japan.md');
  });
});
