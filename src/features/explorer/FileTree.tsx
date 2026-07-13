// src/features/explorer/FileTree.tsx — collapsible folder tree over the live index. Renaming a
// note is an inline edit (double-click the label, or right-click → Rename); it goes through
// vaultStore.renameNote, which is what rewrites inbound links (S9). The right-click context menu
// (owner UX audit 2026-07-13: deleteNote/moveNote existed with NO visible affordance) is a
// dependency-free positioned div — Open / Rename / Move to folder / Delete (two-step confirm),
// all routed through the existing vaultStore actions so every path stays pipeline-safe.

import * as Dialog from '@radix-ui/react-dialog';
import { useMemo, useState } from 'react';
import { useVaultStore } from '../../state/vaultStore';
import { useUiStore } from '../../state/uiStore';
import { buildTree, type TreeNode } from './tree';
import { NoteHistoryDialog } from '../history/VersionTimeline';

interface MenuState {
  x: number;
  y: number;
  path: string;
  displayName: string;
  mode: 'main' | 'move' | 'confirm-delete';
}

interface FolderMoveDraft {
  notePath: string;
  baseName: string;
  currentDir: string;
}

interface TreeActions {
  onDropNote: (notePath: string, folder: string) => void;
}

function NoteRow({
  node,
  isRenaming,
  onRequestRename,
  onRenameDone,
  onOpen,
  onRename,
  onContextMenu,
}: {
  node: TreeNode;
  isRenaming: boolean;
  onRequestRename: (path: string) => void;
  onRenameDone: () => void;
  onOpen: (path: string) => void;
  onRename: (oldRel: string, newRel: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string, displayName: string) => void;
}) {
  const activeNotePath = useVaultStore((s) => s.activeNotePath);

  const isActive = activeNotePath === node.path;
  const isAsset = node.kind === 'asset';
  const displayName = node.name.replace(/\.md$/i, '');

  // Rename-editing state is OWNED by FileTree (`renameTarget`), so double-click and the context
  // menu's Rename item share one mechanism and no local-state/effect sync is needed. The input
  // is uncontrolled (defaultValue) — the committed value is read from the DOM on blur/Enter.
  const commitRename = (value: string): void => {
    onRenameDone();
    const newBase = value.trim().replace(/\.md$/i, '');
    if (!newBase || newBase === displayName) return;
    const dir = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '';
    const newRel = `${dir ? `${dir}/` : ''}${newBase}.md`;
    onRename(node.path, newRel);
  };

  return (
    <div
      data-denote-note-row
      className="flex items-center gap-1 rounded px-2 py-1 text-sm"
      title={isAsset ? node.name : 'Click to open · double-click to rename · right-click for more'}
      style={{
        color: isAsset ? 'var(--fg-muted)' : 'var(--fg)',
        backgroundColor: isActive ? 'var(--bg-panel)' : 'transparent',
        cursor: isAsset ? 'default' : 'pointer',
      }}
      role={isAsset || isRenaming ? undefined : 'button'}
      tabIndex={isAsset || isRenaming ? undefined : 0}
      aria-current={isActive ? 'page' : undefined}
      onClick={() => {
        if (!isAsset) onOpen(node.path);
      }}
      onKeyDown={(e) => {
        if (isAsset || e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(node.path);
        }
      }}
      onDoubleClick={() => {
        if (!isAsset) onRequestRename(node.path);
      }}
      onContextMenu={(e) => {
        if (isAsset) return;
        e.preventDefault();
        onContextMenu(e, node.path, displayName);
      }}
      draggable={!isAsset && !isRenaming}
      onDragStart={(e) => {
        if (isAsset) return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-denote-note', node.path);
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
  onOpen,
  onRename,
  onContextMenu,
  onDropNote,
}: {
  node: TreeNode;
  depth: number;
  renameTarget: string | null;
  onRequestRename: (path: string) => void;
  onRenameDone: () => void;
  onOpen: (path: string) => void;
  onRename: (oldRel: string, newRel: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string, displayName: string) => void;
  onDropNote: TreeActions['onDropNote'];
}) {
  const [expanded, setExpanded] = useState(true);
  const [dropActive, setDropActive] = useState(false);
  const selectedFolder = useUiStore((s) => s.selectedFolder);
  const setSelectedFolder = useUiStore((s) => s.setSelectedFolder);
  const isSelected = selectedFolder === node.path;

  return (
    <div>
      <div
        className="flex items-center gap-1 rounded px-2 py-1 text-sm font-medium"
        style={{
          backgroundColor: dropActive ? 'var(--accent)' : isSelected ? 'var(--bg-panel)' : 'transparent',
          color: dropActive ? '#fff' : 'inherit',
          cursor: 'pointer',
        }}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-pressed={isSelected}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('application/x-denote-note')) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          setDropActive(true);
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDropActive(false);
          const path = e.dataTransfer.getData('application/x-denote-note');
          if (path) onDropNote(path, node.path);
        }}
        onClick={() => {
          setExpanded((v) => !v);
          setSelectedFolder(node.path);
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((v) => !v);
            setSelectedFolder(node.path);
          }
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
            onOpen={onOpen}
            onRename={onRename}
            onContextMenu={onContextMenu}
            onDropNote={onDropNote}
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
  onOpen,
  onRename,
  onContextMenu,
  onDropNote,
}: {
  nodes: TreeNode[];
  depth: number;
  renameTarget: string | null;
  onRequestRename: (path: string) => void;
  onRenameDone: () => void;
  onOpen: (path: string) => void;
  onRename: (oldRel: string, newRel: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string, displayName: string) => void;
  onDropNote: TreeActions['onDropNote'];
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
            onOpen={onOpen}
            onRename={onRename}
            onContextMenu={onContextMenu}
            onDropNote={onDropNote}
          />
        ) : (
          <NoteRow
            key={n.path}
            node={n}
            isRenaming={renameTarget === n.path}
            onRequestRename={onRequestRename}
            onRenameDone={onRenameDone}
            onOpen={onOpen}
            onRename={onRename}
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
  onOpen,
  onRename,
  onMove,
  onDelete,
  onSetMode,
  onHistory,
  onCreateFolderAndMove,
}: {
  menu: MenuState;
  folders: string[];
  onClose: () => void;
  onOpen: (path: string) => void;
  onRename: (path: string) => void;
  onMove: (oldRel: string, newRel: string) => void;
  onDelete: (path: string) => void;
  onSetMode: (mode: MenuState['mode']) => void;
  onHistory: (path: string) => void;
  onCreateFolderAndMove: (notePath: string, baseName: string, currentDir: string) => void;
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
                onOpen(menu.path);
                onClose();
              }}
            >
              Open
            </button>
            <button className={MENU_ITEM_CLASS} onClick={() => onRename(menu.path)}>
              Rename…
            </button>
            <button className={MENU_ITEM_CLASS} onClick={() => onHistory(menu.path)}>
              History…
            </button>
            <button
              className={MENU_ITEM_CLASS}
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
                  onMove(menu.path, newRel);
                  onClose();
                }}
              >
                {folder || 'Vault root (top level)'}
              </button>
            ))}
            <button
              className={MENU_ITEM_CLASS}
              style={{ color: 'var(--fg-muted)' }}
              onClick={() => onCreateFolderAndMove(menu.path, baseName, currentDir)}
            >
              New folder…
            </button>
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
                onDelete(menu.path);
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

export function FileTree({ extraFolders = [], onFolderCreated }: { extraFolders?: string[]; onFolderCreated?: (path: string) => void }) {
  const repo = useVaultStore((s) => s.repo);
  const revision = useVaultStore((s) => s.revision);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [historyPath, setHistoryPath] = useState<string | null>(null);
  const [sessionFolders, setSessionFolders] = useState<string[]>([]);
  const [rootDropActive, setRootDropActive] = useState(false);
  const [folderMoveDraft, setFolderMoveDraft] = useState<FolderMoveDraft | null>(null);
  const [folderName, setFolderName] = useState('New folder');
  const [folderError, setFolderError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function runAction(action: () => Promise<void>): Promise<void> {
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  function rememberFolder(path: string): void {
    setSessionFolders((current) => current.includes(path) ? current : [...current, path]);
    onFolderCreated?.(path);
  }

  async function createFolder(path: string): Promise<string | null> {
    if (!repo || !path.trim()) return null;
    try {
      const createdPath = await useVaultStore.getState().createFolder(path.trim());
      rememberFolder(createdPath);
      return createdPath;
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  async function submitFolderMove(): Promise<void> {
    if (!folderMoveDraft) return;
    const name = folderName.trim();
    if (!name) {
      setFolderError('Enter a folder name.');
      return;
    }
    const path = `${folderMoveDraft.currentDir ? `${folderMoveDraft.currentDir}/` : ''}${name}`;
    setFolderError(null);
    const createdPath = await createFolder(path);
    if (!createdPath) return;
    try {
      await useVaultStore.getState().moveNote(folderMoveDraft.notePath, `${createdPath}/${folderMoveDraft.baseName}`);
      setFolderMoveDraft(null);
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : String(error));
    }
  }

  function moveNote(notePath: string, folder: string): void {
    const baseName = notePath.split('/').pop() ?? notePath;
    const nextPath = `${folder ? `${folder}/` : ''}${baseName}`;
    if (nextPath === notePath) return;
    void runAction(() => useVaultStore.getState().moveNote(notePath, nextPath));
  }

  const tree = useMemo(() => {
    if (!repo) return [];
    const entries = [
      ...repo.listNotePaths().map((relPath) => ({ relPath, kind: 'note' as const })),
      ...[...repo.index.assets.keys()].map((relPath) => ({ relPath, kind: 'asset' as const })),
    ];
    return buildTree(entries, [...repo.index.allFolders(), ...extraFolders, ...sessionFolders]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, revision, extraFolders, sessionFolders]);

  // Move targets: the vault root plus every folder that currently holds a note or asset.
  const folders = useMemo(() => {
    if (!repo) return [];
    const set = new Set<string>(['']);
    for (const relPath of [
      ...repo.listNotePaths(),
      ...repo.index.assets.keys(),
    ]) {
      let dir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
      while (dir) {
        set.add(dir);
        dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
      }
    }
    for (const folder of [...repo.index.allFolders(), ...extraFolders, ...sessionFolders]) {
      let dir = folder;
      while (dir) {
        set.add(dir);
        dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, revision, extraFolders, sessionFolders]);

  return (
    <div
      className="flex flex-col gap-0.5 rounded"
      style={{ backgroundColor: rootDropActive ? 'var(--bg-panel)' : 'transparent', outline: rootDropActive ? '1px dashed var(--accent)' : 'none' }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('application/x-denote-note')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setRootDropActive(true);
      }}
      onDragLeave={() => setRootDropActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setRootDropActive(false);
        // A note row is a child of the root container, but dropping onto it is not a request to
        // move to the root. Folder rows stop propagation themselves; this guard keeps a drop on
        // any other child from becoming an accidental root move.
        if (e.target !== e.currentTarget) return;
        const path = e.dataTransfer.getData('application/x-denote-note');
        if (path) moveNote(path, '');
      }}
    >
      <TreeChildren
        nodes={tree}
        depth={0}
        renameTarget={renameTarget}
        onRequestRename={(path) => setRenameTarget(path)}
        onRenameDone={() => setRenameTarget(null)}
        onOpen={(path) => { void runAction(() => useVaultStore.getState().setActiveNote(path)); }}
        onRename={(oldRel, newRel) => { void runAction(() => useVaultStore.getState().renameNote(oldRel, newRel)); }}
        onContextMenu={(e, path, displayName) =>
          setMenu({ x: e.clientX, y: e.clientY, path, displayName, mode: 'main' })
        }
        onDropNote={moveNote}
      />
      {menu && (
        <NoteContextMenu
          menu={menu}
          folders={folders}
          onClose={() => setMenu(null)}
          onHistory={(path) => {
            setMenu(null);
            setHistoryPath(path);
          }}
          onCreateFolderAndMove={(notePath, baseName, currentDir) => {
            setMenu(null);
            setFolderName('New folder');
            setFolderError(null);
            setFolderMoveDraft({ notePath, baseName, currentDir });
          }}
          onRename={(path) => {
            setMenu(null);
            setRenameTarget(path);
          }}
          onOpen={(path) => { void runAction(() => useVaultStore.getState().setActiveNote(path)); }}
          onMove={(oldRel, newRel) => { void runAction(() => useVaultStore.getState().moveNote(oldRel, newRel)); }}
          onDelete={(path) => { void runAction(() => useVaultStore.getState().deleteNote(path)); }}
          onSetMode={(mode) => setMenu((m) => (m ? { ...m, mode } : m))}
        />
      )}
      {actionError && (
        <button type="button" role="alert" className="mt-1 rounded px-2 py-1 text-left text-xs" style={{ border: '1px solid var(--danger)', color: 'var(--danger)' }} onClick={() => setActionError(null)}>
          {actionError}
        </button>
      )}
      <NoteHistoryDialog open={historyPath !== null} onOpenChange={(open) => { if (!open) setHistoryPath(null); }} relPath={historyPath} />
      <Dialog.Root
        open={folderMoveDraft !== null}
        onOpenChange={(open) => {
          if (!open) {
            setFolderMoveDraft(null);
            setFolderError(null);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-50 w-[360px] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 p-4"
            style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: '0 8px 30px rgba(0,0,0,0.2)' }}
          >
            <Dialog.Title className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>New folder</Dialog.Title>
            <Dialog.Description className="mt-1 text-xs" style={{ color: 'var(--fg-muted)' }}>
              Create a folder and move “{folderMoveDraft?.baseName}” into it.
            </Dialog.Description>
            <form className="mt-4 flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void submitFolderMove(); }}>
              <input
                autoFocus
                aria-label="Folder name"
                value={folderName}
                onChange={(event) => setFolderName(event.target.value)}
                className="rounded px-2 py-1.5 text-sm"
                style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg-panel)', color: 'var(--fg)' }}
              />
              {folderError && <div role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>{folderError}</div>}
              <div className="flex justify-end gap-2">
                <Dialog.Close asChild>
                  <button type="button" className="rounded px-2 py-1 text-xs" style={{ border: '1px solid var(--border)' }}>Cancel</button>
                </Dialog.Close>
                <button type="submit" className="rounded px-2 py-1 text-xs" style={{ backgroundColor: 'var(--accent)', color: '#fff' }}>Create and move</button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
