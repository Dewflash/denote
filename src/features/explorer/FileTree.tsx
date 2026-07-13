// src/features/explorer/FileTree.tsx — collapsible folder tree over the live index. Renaming a
// note is an inline edit (double-click the label, or right-click → Rename); it goes through
// vaultStore.renameNote, which is what rewrites inbound links (S9). The right-click context menu
// (owner UX audit 2026-07-13: deleteNote/moveNote existed with NO visible affordance) is a
// dependency-free positioned div — Open / Rename / Move to folder / Delete (two-step confirm),
// all routed through the existing vaultStore actions so every path stays pipeline-safe.

import { useMemo, useState } from 'react';
import { useVaultStore } from '../../state/vaultStore';
import { useUiStore } from '../../state/uiStore';
import { buildTree, type TreeNode } from './tree';

interface MenuState {
  x: number;
  y: number;
  path: string;
  displayName: string;
  mode: 'main' | 'move' | 'confirm-delete';
}

function NoteRow({
  node,
  isRenaming,
  onRequestRename,
  onRenameDone,
  onContextMenu,
}: {
  node: TreeNode;
  isRenaming: boolean;
  onRequestRename: (path: string) => void;
  onRenameDone: () => void;
  onContextMenu: (e: React.MouseEvent, path: string, displayName: string) => void;
}) {
  const activeNotePath = useVaultStore((s) => s.activeNotePath);
  const renameNote = useVaultStore((s) => s.renameNote);

  const isActive = activeNotePath === node.path;
  const isAsset = node.kind === 'asset';
  const displayName = node.name.replace(/\.md$/i, '');

  // Rename-editing state is OWNED by FileTree (`renameTarget`), so double-click and the context
  // menu's Rename item share one mechanism and no local-state/effect sync is needed. The input
  // is uncontrolled (defaultValue) — the committed value is read from the DOM on blur/Enter.
  const commitRename = (value: string): void => {
    onRenameDone();
    const newBase = value.trim();
    if (!newBase || newBase === displayName) return;
    const dir = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '';
    const newRel = `${dir ? `${dir}/` : ''}${newBase}.md`;
    void renameNote(node.path, newRel);
  };

  return (
    <div
      className="flex items-center gap-1 rounded px-2 py-1 text-sm"
      title={isAsset ? node.name : 'Click to open · double-click to rename · right-click for more'}
      style={{
        color: isAsset ? 'var(--fg-muted)' : 'var(--fg)',
        backgroundColor: isActive ? 'var(--bg-panel)' : 'transparent',
        cursor: isAsset ? 'default' : 'pointer',
      }}
      onClick={() => {
        if (!isAsset) void useVaultStore.getState().setActiveNote(node.path);
      }}
      onDoubleClick={() => {
        if (!isAsset) onRequestRename(node.path);
      }}
      onContextMenu={(e) => {
        if (isAsset) return;
        e.preventDefault();
        onContextMenu(e, node.path, displayName);
      }}
    >
      {isRenaming ? (
        <input
          autoFocus
          className="w-full bg-transparent outline-none"
          style={{ color: 'var(--fg)', border: '1px solid var(--accent)', borderRadius: 'var(--radius)' }}
          defaultValue={displayName}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => commitRename(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename(e.currentTarget.value);
            else if (e.key === 'Escape') onRenameDone();
          }}
        />
      ) : (
        <span className="truncate">{isAsset ? node.name : displayName}</span>
      )}
    </div>
  );
}

function FolderRow({
  node,
  depth,
  renameTarget,
  onRequestRename,
  onRenameDone,
  onContextMenu,
}: {
  node: TreeNode;
  depth: number;
  renameTarget: string | null;
  onRequestRename: (path: string) => void;
  onRenameDone: () => void;
  onContextMenu: (e: React.MouseEvent, path: string, displayName: string) => void;
}) {
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
          <TreeChildren
            nodes={node.children ?? []}
            depth={depth + 1}
            renameTarget={renameTarget}
            onRequestRename={onRequestRename}
            onRenameDone={onRenameDone}
            onContextMenu={onContextMenu}
          />
        </div>
      )}
    </div>
  );
}

function TreeChildren({
  nodes,
  depth,
  renameTarget,
  onRequestRename,
  onRenameDone,
  onContextMenu,
}: {
  nodes: TreeNode[];
  depth: number;
  renameTarget: string | null;
  onRequestRename: (path: string) => void;
  onRenameDone: () => void;
  onContextMenu: (e: React.MouseEvent, path: string, displayName: string) => void;
}) {
  return (
    <>
      {nodes.map((n) =>
        n.kind === 'folder' ? (
          <FolderRow
            key={n.path}
            node={n}
            depth={depth}
            renameTarget={renameTarget}
            onRequestRename={onRequestRename}
            onRenameDone={onRenameDone}
            onContextMenu={onContextMenu}
          />
        ) : (
          <NoteRow
            key={n.path}
            node={n}
            isRenaming={renameTarget === n.path}
            onRequestRename={onRequestRename}
            onRenameDone={onRenameDone}
            onContextMenu={onContextMenu}
          />
        ),
      )}
    </>
  );
}

const MENU_ITEM_CLASS = 'block w-full rounded px-2 py-1 text-left text-sm';

function NoteContextMenu({
  menu,
  folders,
  onClose,
  onRename,
  onSetMode,
}: {
  menu: MenuState;
  folders: string[];
  onClose: () => void;
  onRename: (path: string) => void;
  onSetMode: (mode: MenuState['mode']) => void;
}) {
  const currentDir = menu.path.includes('/') ? menu.path.slice(0, menu.path.lastIndexOf('/')) : '';
  const baseName = menu.path.includes('/') ? menu.path.slice(menu.path.lastIndexOf('/') + 1) : menu.path;
  const moveTargets = folders.filter((f) => f !== currentDir);

  return (
    <>
      {/* click-away catcher */}
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        className="fixed z-50 flex flex-col gap-0.5 rounded p-1"
        style={{
          left: Math.min(menu.x, window.innerWidth - 220),
          top: Math.min(menu.y, window.innerHeight - 200),
          minWidth: 190,
          backgroundColor: 'var(--bg)',
          border: '1px solid var(--border)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
        }}
      >
        {menu.mode === 'main' && (
          <>
            <button
              className={MENU_ITEM_CLASS}
              onClick={() => {
                void useVaultStore.getState().setActiveNote(menu.path);
                onClose();
              }}
            >
              Open
            </button>
            <button className={MENU_ITEM_CLASS} onClick={() => onRename(menu.path)}>
              Rename…
            </button>
            <button
              className={MENU_ITEM_CLASS}
              disabled={moveTargets.length === 0}
              style={moveTargets.length === 0 ? { color: 'var(--fg-muted)' } : undefined}
              title={moveTargets.length === 0 ? 'No other folders in this vault yet' : undefined}
              onClick={() => onSetMode('move')}
            >
              Move to folder…
            </button>
            <button
              className={MENU_ITEM_CLASS}
              style={{ color: 'var(--danger)' }}
              onClick={() => onSetMode('confirm-delete')}
            >
              Delete…
            </button>
          </>
        )}

        {menu.mode === 'move' && (
          <>
            <div className="px-2 py-1 text-xs" style={{ color: 'var(--fg-muted)' }}>
              Move “{menu.displayName}” to:
            </div>
            {moveTargets.map((folder) => (
              <button
                key={folder || '(root)'}
                className={MENU_ITEM_CLASS}
                onClick={() => {
                  const newRel = `${folder ? `${folder}/` : ''}${baseName}`;
                  void useVaultStore.getState().moveNote(menu.path, newRel);
                  onClose();
                }}
              >
                {folder || 'Vault root (top level)'}
              </button>
            ))}
            <button className={MENU_ITEM_CLASS} style={{ color: 'var(--fg-muted)' }} onClick={() => onSetMode('main')}>
              ← Back
            </button>
          </>
        )}

        {menu.mode === 'confirm-delete' && (
          <>
            <div className="px-2 py-1 text-xs" style={{ color: 'var(--fg-muted)' }}>
              Delete “{menu.displayName}”? The file is removed from your vault folder.
            </div>
            <button
              className={MENU_ITEM_CLASS}
              style={{ color: 'var(--danger)' }}
              onClick={() => {
                void useVaultStore.getState().deleteNote(menu.path);
                onClose();
              }}
            >
              Delete note
            </button>
            <button className={MENU_ITEM_CLASS} style={{ color: 'var(--fg-muted)' }} onClick={() => onSetMode('main')}>
              Cancel
            </button>
          </>
        )}
      </div>
    </>
  );
}

export function FileTree() {
  const repo = useVaultStore((s) => s.repo);
  const revision = useVaultStore((s) => s.revision);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);

  const tree = useMemo(() => {
    if (!repo) return [];
    const entries = [
      ...repo.listNotePaths().map((relPath) => ({ relPath, kind: 'note' as const })),
      ...[...repo.index.assets.keys()].map((relPath) => ({ relPath, kind: 'asset' as const })),
    ];
    return buildTree(entries);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, revision]);

  // Move targets: the vault root plus every folder that currently holds a note or asset.
  const folders = useMemo(() => {
    if (!repo) return [];
    const set = new Set<string>(['']);
    for (const relPath of repo.listNotePaths()) {
      let dir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
      while (dir) {
        set.add(dir);
        dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, revision]);

  return (
    <div className="flex flex-col gap-0.5">
      <TreeChildren
        nodes={tree}
        depth={0}
        renameTarget={renameTarget}
        onRequestRename={(path) => setRenameTarget(path)}
        onRenameDone={() => setRenameTarget(null)}
        onContextMenu={(e, path, displayName) =>
          setMenu({ x: e.clientX, y: e.clientY, path, displayName, mode: 'main' })
        }
      />
      {menu && (
        <NoteContextMenu
          menu={menu}
          folders={folders}
          onClose={() => setMenu(null)}
          onRename={(path) => {
            setMenu(null);
            setRenameTarget(path);
          }}
          onSetMode={(mode) => setMenu((m) => (m ? { ...m, mode } : m))}
        />
      )}
    </div>
  );
}
