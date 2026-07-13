// src/app/VaultRail.tsx — far-left vault rail: one icon per REGISTERED vault (D17's real
// `vaults.json` registry, not the pass-03 localStorage MRU stand-in), one-click switch (instant
// if already open), per-vault accent color, add-vault flow (folder picker → bootstrap or adopt
// existing `.denote/`, pass-05 brief). A small dot marks vaults that are currently open (have a
// live Repository + watcher) vs merely registered.

import { useState } from 'react';
import { useVaultStore } from '../state/vaultStore';
import { useUiStore } from '../state/uiStore';
import { pickFolder } from '../services/dialogs';
import { appKeymap, formatCombo } from './keymap';
import { importDroppedFiles } from '../features/import';

function vaultInitials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

export function VaultRail() {
  const vaultId = useVaultStore((s) => s.vaultId);
  const registry = useVaultStore((s) => s.registry);
  const openVaultIds = useVaultStore((s) => s.openVaultIds);
  const switchVault = useVaultStore((s) => s.switchVault);
  const openVaultAt = useVaultStore((s) => s.openVaultAt);
  const closeVault = useVaultStore((s) => s.closeVault);
  const repo = useVaultStore((s) => s.repo);
  const createNote = useVaultStore((s) => s.createNote);
  const openImportReview = useUiStore((s) => s.openImportReview);
  const [dropActive, setDropActive] = useState(false);
  const [dropMessage, setDropMessage] = useState<string | null>(null);

  async function handleDrop(files: FileList | null): Promise<void> {
    setDropActive(false);
    if (!repo) return;
    try {
      const result = await importDroppedFiles(files, repo, createNote);
      if (result.reviewItems.length > 0) openImportReview({ sourceLabel: 'Dropped files', items: result.reviewItems, exactSkipped: result.exactSkipped, warnings: result.warnings });
      setDropMessage(`Imported ${result.imported}; ${result.exactSkipped} exact duplicate${result.exactSkipped === 1 ? '' : 's'} skipped${result.reviewItems.length ? `; ${result.reviewItems.length} need review` : ''}.`);
      void repo.rebuildDerivedCaches();
    } catch (error) {
      setDropMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div
      className="flex h-full flex-col items-center gap-2 py-3"
      style={{ backgroundColor: 'var(--bg-panel)', borderRight: '1px solid var(--border)', position: 'relative' }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files') || !repo) return;
        event.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(event) => {
        event.preventDefault();
        void handleDrop(event.dataTransfer.files);
      }}
    >
      {dropActive && <div className="absolute inset-1 z-10 flex items-center justify-center rounded p-1 text-center text-[10px]" style={{ backgroundColor: 'var(--bg)', border: '1px dashed var(--accent)', color: 'var(--accent)' }}>Drop notes</div>}
      {dropMessage && <button type="button" title={dropMessage} aria-label={dropMessage} onClick={() => setDropMessage(null)} className="absolute bottom-12 z-20 h-5 w-5 rounded-full text-[10px]" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--fg-muted)' }}>i</button>}
      {registry.map((v) => {
        const isActive = v.id === vaultId;
        const isOpen = openVaultIds.includes(v.id);
        return (
          <div key={v.id} className="group relative">
            <button
              title={`${v.name}${v.localOnly ? ' (local only)' : ''}\n${v.path}`}
              onClick={() => void switchVault(v.id)}
              className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold"
              style={{
                backgroundColor: v.color,
                color: '#fff',
                outline: isActive ? '2px solid var(--fg)' : 'none',
                outlineOffset: 1,
                opacity: isOpen ? 1 : 0.55,
              }}
            >
              {vaultInitials(v.name)}
            </button>
            {isOpen && !isActive && (
              <button
                title={`Close ${v.name} (stop watching, keep registered)`}
                onClick={(e) => {
                  e.stopPropagation();
                  void closeVault(v.id);
                }}
                className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full text-[10px] group-hover:flex"
                style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--fg-muted)' }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      {/* One gesture, no hidden double-click: openVaultAt adopt-or-bootstraps (D2 — ensureMeta
          creates `.denote/meta.json` in any folder that lacks one), so "open" and "create"
          were always the same action underneath. */}
      <button
        title="Add a vault — choose any folder (existing notes or a new empty one)"
        onClick={() =>
          void pickFolder('Add a vault — choose any folder').then((p) => {
            if (p) void openVaultAt(p);
          })
        }
        className="flex h-9 w-9 items-center justify-center rounded-full text-lg"
        style={{ color: 'var(--fg-muted)', border: '1px dashed var(--border)' }}
      >
        +
      </button>

      <button
        title={`Settings — appearance, vaults, AI (${settingsCombo()})`}
        onClick={() => appKeymap.invoke('settings')}
        className="mt-auto flex h-9 w-9 items-center justify-center rounded-full"
        style={{ color: 'var(--fg-muted)' }}
        aria-label="Settings"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </div>
  );
}

function settingsCombo(): string {
  const binding = appKeymap.all().find((b) => b.id === 'settings');
  return binding ? formatCombo(binding.combo) : '⌘,';
}
