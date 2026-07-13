// src/features/explorer/ExplorerPanel.tsx — left sidebar: an affordance toolbar + Recent notes
// + collapsible tree. Paste-to-capture v1 (pass-03 brief): pasting here with nothing focused
// creates a note from the clipboard.
//
// The toolbar (post-06 manual-testing fix #1: hotkey-only UX failed discoverability) exposes the
// three most-used actions as visible buttons with hotkey tooltips. It reuses the ONE keymap
// registry (S21) via `appKeymap.invoke(id)`, so a button and its shortcut always do the identical
// thing and can never drift apart. Tokens only, no new deps.

import { useState, type ReactNode } from 'react';
import { RecentNotes } from './RecentNotes';
import { FileTree } from './FileTree';
import { captureFromClipboard, isPasteCaptureTarget } from '../capture';
import { appKeymap, formatCombo } from '../../app/keymap';
import { useVaultStore } from '../../state/vaultStore';
import { useUiStore } from '../../state/uiStore';
import { importDroppedFiles } from '../import';

function comboFor(id: string): string {
  const binding = appKeymap.all().find((b) => b.id === id);
  return binding ? formatCombo(binding.combo) : '';
}

function ToolbarButton({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const combo = comboFor(id);
  return (
    <button
      type="button"
      title={combo ? `${label} (${combo})` : label}
      aria-label={label}
      onClick={() => appKeymap.invoke(id)}
      className="flex items-center justify-center rounded"
      style={{ width: 26, height: 26, color: 'var(--fg-muted)', border: '1px solid transparent' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--bg)';
        e.currentTarget.style.borderColor = 'var(--border)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
        e.currentTarget.style.borderColor = 'transparent';
      }}
    >
      {children}
    </button>
  );
}

const ICON_PROPS = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function ExplorerPanel() {
  const repo = useVaultStore((s) => s.repo);
  const createNote = useVaultStore((s) => s.createNote);
  const createFolder = useVaultStore((s) => s.createFolder);
  const openImportReview = useUiStore((s) => s.openImportReview);
  const selectedFolder = useUiStore((s) => s.selectedFolder);
  const [dropActive, setDropActive] = useState(false);
  const [dropMessage, setDropMessage] = useState<string | null>(null);
  const [folderDraftOpen, setFolderDraftOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderError, setFolderError] = useState<string | null>(null);
  const [createdFolders, setCreatedFolders] = useState<string[]>([]);

  async function handleDrop(files: FileList | null): Promise<void> {
    setDropActive(false);
    if (!repo || !files || files.length === 0) return;
    try {
      const result = await importDroppedFiles(files, repo, createNote);
      if (result.reviewItems.length > 0) openImportReview({ sourceLabel: 'Dropped files', items: result.reviewItems, exactSkipped: result.exactSkipped, warnings: result.warnings });
      setDropMessage(`Imported ${result.imported}; ${result.exactSkipped} exact duplicate${result.exactSkipped === 1 ? '' : 's'} skipped${result.reviewItems.length ? `; ${result.reviewItems.length} need review` : ''}.`);
      void repo.rebuildDerivedCaches();
    } catch (error) {
      setDropMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function submitFolder(): Promise<void> {
    const name = folderName.trim();
    if (!name) {
      setFolderError('Enter a folder name.');
      return;
    }
    const path = `${selectedFolder ? `${selectedFolder}/` : ''}${name}`;
    setFolderError(null);
    try {
      const createdPath = await createFolder(path);
      setCreatedFolders((current) => current.includes(createdPath) ? current : [...current, createdPath]);
      useUiStore.getState().setSelectedFolder(createdPath);
      setFolderName('');
      setFolderDraftOpen(false);
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div
      className="flex h-full flex-col overflow-auto"
      tabIndex={0}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(event) => {
        event.preventDefault();
        void handleDrop(event.dataTransfer.files);
      }}
      onPaste={(e) => {
        if (!isPasteCaptureTarget(e.target)) return;
        const text = e.clipboardData.getData('text/plain');
        if (!text) return;
        e.preventDefault();
        void captureFromClipboard(text);
      }}
    >
      <div
        className="flex items-center gap-1 px-2 py-1.5"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <ToolbarButton id="new-note" label="New note">
          <svg {...ICON_PROPS}>
            <path d="M12 5v14M5 12h14" />
          </svg>
        </ToolbarButton>
        <button
          type="button"
          title="New folder"
          aria-label="New folder"
          onClick={() => setFolderDraftOpen((open) => !open)}
          className="flex items-center justify-center rounded"
          style={{ width: 26, height: 26, color: 'var(--fg-muted)', border: '1px solid transparent' }}
        >
          <svg {...ICON_PROPS}>
            <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h5l2 2h8A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
            <path d="M12 10v5M9.5 12.5h5" />
          </svg>
        </button>
        <ToolbarButton id="search" label="Search">
          <svg {...ICON_PROPS}>
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </ToolbarButton>
        <ToolbarButton id="graph-view" label="Graph view">
          <svg {...ICON_PROPS}>
            <circle cx="5" cy="18" r="2.5" />
            <circle cx="19" cy="16" r="2.5" />
            <circle cx="13" cy="6" r="2.5" />
            <path d="m7 16.5 4-8M15 8l2.5 6" />
          </svg>
        </ToolbarButton>
        <ToolbarButton id="today-view" label="Today — notes created or edited today">
          <svg {...ICON_PROPS}>
            <rect x="3" y="4" width="18" height="17" rx="2" />
            <path d="M3 9h18M8 2v4M16 2v4" />
          </svg>
        </ToolbarButton>
        <ToolbarButton id="quick-switcher" label="Jump to a note by title">
          <svg {...ICON_PROPS}>
            <path d="M13 5h8M13 12h8M13 19h8M3 5l3 3-3 3M6 15l-3 3 3 3" />
          </svg>
        </ToolbarButton>
        <ToolbarButton id="command-palette" label="All commands — everything the app can do">
          <svg {...ICON_PROPS}>
            <path d="m7 8-4 4 4 4M17 8l4 4-4 4M14 4l-4 16" />
          </svg>
        </ToolbarButton>
      </div>
      <div className="flex flex-col gap-2 p-2">
        {folderDraftOpen && (
          <div className="flex flex-col gap-1">
            <form className="flex items-center gap-1" onSubmit={(event) => { event.preventDefault(); void submitFolder(); }}>
              <input
                autoFocus
                aria-label="New folder name"
                className="min-w-0 flex-1 rounded px-2 py-1 text-xs"
                style={{ border: '1px solid var(--accent)', backgroundColor: 'var(--bg)', color: 'var(--fg)' }}
                placeholder="Folder name"
                value={folderName}
                onChange={(event) => { setFolderName(event.target.value); setFolderError(null); }}
                onKeyDown={(event) => { if (event.key === 'Escape') { setFolderDraftOpen(false); setFolderName(''); setFolderError(null); } }}
              />
              <button type="submit" className="rounded px-1.5 py-1 text-xs" style={{ border: '1px solid var(--border)' }}>Create</button>
              <button type="button" className="rounded px-1.5 py-1 text-xs" style={{ color: 'var(--fg-muted)' }} onClick={() => { setFolderDraftOpen(false); setFolderName(''); setFolderError(null); }}>Cancel</button>
            </form>
            {folderError && <div role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>{folderError}</div>}
          </div>
        )}
        {dropActive && <div className="rounded p-2 text-xs" style={{ border: '1px dashed var(--accent)', color: 'var(--accent)' }}>Drop notes to import</div>}
        {dropMessage && <button type="button" className="text-left text-xs" style={{ color: 'var(--fg-muted)' }} onClick={() => setDropMessage(null)}>{dropMessage}</button>}
        <RecentNotes />
        <FileTree extraFolders={createdFolders} onFolderCreated={(path) => setCreatedFolders((current) => current.includes(path) ? current : [...current, path])} />
      </div>
    </div>
  );
}
