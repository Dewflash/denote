import { describe, expect, it } from 'vitest';
import { buildTree } from '../../src/features/explorer/tree';

describe('buildTree', () => {
  it('nests notes under their folder path', () => {
    const tree = buildTree([
      { relPath: 'Japan/Yen Intervention.md', kind: 'note' },
      { relPath: 'Japan/Japan.md', kind: 'note' },
      { relPath: 'Inbox/Untitled.md', kind: 'note' },
    ]);
    expect(tree.map((n) => n.name)).toEqual(['Inbox', 'Japan']);
    const japan = tree.find((n) => n.name === 'Japan')!;
    expect(japan.children?.map((n) => n.name)).toEqual(['Japan.md', 'Yen Intervention.md']);
  });

  it('sorts folders before files at the same level', () => {
    const tree = buildTree([
      { relPath: 'a.md', kind: 'note' },
      { relPath: 'Folder/b.md', kind: 'note' },
    ]);
    expect(tree.map((n) => n.kind)).toEqual(['folder', 'note']);
  });

  it('handles a deep nested path', () => {
    const tree = buildTree([{ relPath: 'a/b/c/note.md', kind: 'note' }]);
    expect(tree[0].path).toBe('a');
    expect(tree[0].children![0].path).toBe('a/b');
    expect(tree[0].children![0].children![0].path).toBe('a/b/c');
    expect(tree[0].children![0].children![0].children![0].path).toBe('a/b/c/note.md');
  });

  it('keeps a session-created empty folder visible without creating a placeholder file', () => {
    const tree = buildTree([{ relPath: 'Notes/First.md', kind: 'note' }], ['Projects/Ideas']);
    expect(tree.map((n) => n.path)).toEqual(['Notes', 'Projects']);
    expect(tree.find((n) => n.path === 'Projects')?.children?.[0].path).toBe('Projects/Ideas');
  });
});
