// Pure `_topics/*.md` rendering + freeze decision (S18/D8c). Part of the pass-08 domain suite.

import { describe, expect, it } from 'vitest';
import {
  assembleTopicFile,
  decideTopicFile,
  readTopicFile,
  renderTopicBody,
  topicBodyHash,
  topicFilePath,
  type TopicFileInput,
} from '../../src/domain/topicFile';

const finance: TopicFileInput = {
  id: 'topic-uuid-1',
  name: 'Finance',
  description: 'Money, banking and monetary policy.',
  parentName: null,
  relatedNames: ['Currencies', 'Banking'],
  members: [
    { title: 'Japan', reason: 'central-bank policy', weight: 0.8, relPath: 'Japan/Japan.md' },
    { title: 'Interest Rates', reason: 'rate dynamics', weight: 0.9, relPath: 'Economics/Interest Rates.md' },
    { title: 'Yen Intervention', reason: 'BOJ action', weight: 0.9, relPath: 'Japan/Yen Intervention.md' },
  ],
};

describe('renderTopicBody (S18 byte-stable)', () => {
  it('renders heading, description, sorted related, and weight-sorted members', () => {
    const body = renderTopicBody(finance);
    expect(body).toBe(
      [
        '# Finance',
        '',
        'Money, banking and monetary policy.',
        '',
        '**Related:** [[_topics/Banking]], [[_topics/Currencies]]',
        '',
        '## Notes',
        '- [[Interest Rates]] — rate dynamics',
        '- [[Yen Intervention]] — BOJ action',
        '- [[Japan]] — central-bank policy',
        '',
      ].join('\n'),
    );
  });
  it('omits Parent/Related lines when absent', () => {
    const body = renderTopicBody({ ...finance, parentName: null, relatedNames: [] });
    expect(body).not.toContain('**Parent:**');
    expect(body).not.toContain('**Related:**');
  });
  it('emits a Parent line when set', () => {
    const body = renderTopicBody({ ...finance, parentName: 'Economics', relatedNames: [] });
    expect(body).toContain('**Parent:** [[_topics/Economics]]');
  });
  it('is byte-identical across renders of the same ontology (no timestamps)', () => {
    expect(renderTopicBody(finance)).toBe(renderTopicBody(finance));
  });
  it('member ordering is weight desc then relPath asc regardless of input order', () => {
    const shuffled = { ...finance, members: [...finance.members].reverse() };
    expect(renderTopicBody(shuffled)).toBe(renderTopicBody(finance));
  });
});

describe('assembleTopicFile', () => {
  it('embeds source/topic_id/generated_hash and the body', () => {
    const { content, generatedHash, body } = assembleTopicFile(finance);
    expect(content.startsWith('---\nsource: ai\ntopic_id: topic-uuid-1\n')).toBe(true);
    expect(content).toContain(`generated_hash: ${generatedHash}`);
    expect(generatedHash).toBe(topicBodyHash(body));
    expect(content.endsWith(body)).toBe(true);
  });
  it('topicFilePath uses the topic name verbatim', () => {
    expect(topicFilePath('Finance')).toBe('_topics/Finance.md');
  });
});

describe('readTopicFile', () => {
  it('round-trips source/topic_id/generated_hash/body from an assembled file', () => {
    const { content, generatedHash, body } = assembleTopicFile(finance);
    const parsed = readTopicFile(content);
    expect(parsed.source).toBe('ai');
    expect(parsed.topicId).toBe('topic-uuid-1');
    expect(parsed.generatedHash).toBe(generatedHash);
    expect(parsed.body).toBe(body);
  });
});

describe('decideTopicFile (S18 freeze rule)', () => {
  const { body: desiredBody } = assembleTopicFile(finance);

  it('creates when the file is absent', () => {
    expect(
      decideTopicFile({ exists: false, currentSource: null, currentBodyHash: null, storedGeneratedHash: null, desiredBody }).action,
    ).toBe('create');
  });
  it('skips a byte-stable file (unchanged ontology, unedited)', () => {
    const hash = topicBodyHash(desiredBody);
    expect(
      decideTopicFile({ exists: true, currentSource: 'ai', currentBodyHash: hash, storedGeneratedHash: hash, desiredBody }).action,
    ).toBe('skip');
  });
  it('regenerates when the ontology changed but the file is unedited', () => {
    const oldHash = topicBodyHash('# Finance\n\nold\n');
    expect(
      decideTopicFile({ exists: true, currentSource: 'ai', currentBodyHash: oldHash, storedGeneratedHash: oldHash, desiredBody }).action,
    ).toBe('regenerate');
  });
  it('freezes when the user edited the file (body hash ≠ lineage)', () => {
    const lineage = topicBodyHash(desiredBody);
    expect(
      decideTopicFile({ exists: true, currentSource: 'ai', currentBodyHash: 'userEditedHash', storedGeneratedHash: lineage, desiredBody }).action,
    ).toBe('freeze');
  });
  it('never touches a file already marked user-modified', () => {
    expect(
      decideTopicFile({ exists: true, currentSource: 'user-modified', currentBodyHash: 'x', storedGeneratedHash: 'y', desiredBody }).action,
    ).toBe('skip');
  });
});
