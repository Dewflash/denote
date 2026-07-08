// src/features/explorer/FileTree.tsx — collapsible folder tree over the live index. Renaming a
// note is an inline edit (double-click the label) so pass 03 doesn't need a context-menu
// dependency; it goes through vaultStore.renameNote, which is what rewrites inbound links (S9).

import { useMemo, useState } from 'react';
import { useVaultStore } from '../../state/vaultStore';
import { useUiStore } from '../../state/uiStore';
import { buildTree, type TreeNode } from './tree';

function NoteRow({ node }: { node: TreeNode }) {
  const activeNotePath = useVaultStore((s) => s.activeNotePath);
  const renameNote = useVaultStore((s) => s.renameNote);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const isActive = activeNotePath === node.path;
  const isAsset = node.kind === 'asset';
  const displayName = node.name.replace(/\.md$/i, '');

  const commitRename = (): void => {
    setEditing(false);
    const newBase = draft.trim();
    if (!newBase || newBase === displayName) return;
    const dir = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '';
    const newRel = `${dir ? `${dir}/` : ''}${newBase}.md`;
    void renameNote(node.path, newRel);
  };

  return (
    <div
      className="flex items-center gap-1 rounded px-2 py-1 text-sm"
      style={{
        color: isAsset ? 'var(--fg-muted)' : 'var(--fg)',
        backgroundColor: isActive ? 'var(--bg-panel)' : 'transparent',
        cursor: isAsset ? 'default' : 'pointer',
      }}
      onClick={() => {
        if (!isAsset) void useVaultStore.getState().setActiveNote(node.path);
      }}
      onDoubleClick={() => {
        if (isAsset) return;
        setDraft(displayName);
        setEditing(true);
      }}
    >
      {editing ? (
        <input
          autoFocus
          className="w-full bg-transparent outline-none"
          style={{ color: 'var(--fg)', border: '1px solid var(--accent)', borderRadius: 'var(--radius)' }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            else if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <span className="truncate">{isAsset ? node.name : displayName}</span>
      )}
    </div>
  );
}

function FolderRow({ node, depth }: { node: TreeNode; depth: number }) {
  const [expanded, setExpanded] = useState(true);
  const selectedFolder = useUiStore((s) => s.selectedFolder);
  const setSelectedFolder = useUiStore((s) => s.setSelectedFolder);
  const isSelected = selectedFolder === node.path;

  return (
    <div>
      <div
        className="flex items-center gap-1 rounded px-2 py-1 text-sm font-medium"
        style={{
          backgroundColor: isSelected ? 'var(--bg-panel)' : 'transparent',
          cursor: 'pointer',
        }}
        onClick={() => {
          setExpanded((v) => !v);
          setSelectedFolder(node.path);
        }}
      >
        <span style={{ color: 'var(--fg-muted)' }}>{expanded ? '▾' : '▸'}</span>
        <span className="truncate">{node.name}</span>
      </div>
      {expanded && (
        <div style={{ marginLeft: 12 }}>
          <TreeChildren nodes={node.children ?? []} depth={depth + 1} />
        </div>
      )}
    </div>
  );
}

function TreeChildren({ nodes, depth }: { nodes: TreeNode[]; depth: number }) {
  return (
    <>
      {nodes.map((n) =>
        n.kind === 'folder' ? (
          <FolderRow key={n.path} node={n} depth={depth} />
        ) : (
          <NoteRow key={n.path} node={n} />
        ),
      )}
    </>
  );
}

export function FileTree() {
  const repo = useVaultStore((s) => s.repo);
  const revision = useVaultStore((s) => s.revision);

  const tree = useMemo(() => {
    if (!repo) return [];
    const entries = [
      ...repo.listNotePaths().map((relPath) => ({ relPath, kind: 'note' as const })),
      ...[...repo.index.assets.keys()].map((relPath) => ({ relPath, kind: 'asset' as const })),
    ];
    return buildTree(entries);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, revision]);

  return (
    <div className="flex flex-col gap-0.5">
      <TreeChildren nodes={tree} depth={0} />
    </div>
  );
}
