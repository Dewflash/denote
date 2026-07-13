// src/features/search/QuickSwitcher.tsx — cmd-O (S21): fuzzy note-title jump across ALL OPEN
// vaults (pass-05 brief), distinct from cmd-shift-F full-text search and from cmd-P's command
// palette (which only searches the ACTIVE vault's notes by substring, mixed in with commands).

import * as Dialog from '@radix-ui/react-dialog';
import { useMemo, useRef, useState } from 'react';
import { useUiStore } from '../../state/uiStore';
import { useVaultStore } from '../../state/vaultStore';
import { fuzzyMatch } from './fuzzyMatch';

interface Candidate {
  vaultId: string;
  vaultName: string;
  vaultColor: string;
  relPath: string;
  title: string;
}

export function QuickSwitcher() {
  const open = useUiStore((s) => s.quickSwitcherOpen);
  const setOpen = useUiStore((s) => s.setQuickSwitcherOpen);
  const openVaultIds = useVaultStore((s) => s.openVaultIds);
  const registry = useVaultStore((s) => s.registry);
  const getOpenRepo = useVaultStore((s) => s.getOpenRepo);
  const revision = useVaultStore((s) => s.revision);
  const switchVault = useVaultStore((s) => s.switchVault);
  const setActiveNote = useVaultStore((s) => s.setActiveNote);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset on open, synchronously during render (see CommandPalette.tsx for the same pattern).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery('');
      setHighlighted(0);
    }
  }

  const candidates: Candidate[] = useMemo(() => {
    const out: Candidate[] = [];
    for (const vaultId of openVaultIds) {
      const repo = getOpenRepo(vaultId);
      if (!repo) continue;
      const entry = registry.find((v) => v.id === vaultId);
      for (const relPath of repo.listNotePaths()) {
        out.push({
          vaultId,
          vaultName: entry?.name ?? vaultId,
          vaultColor: entry?.color ?? '#888888',
          relPath,
          title: repo.getParsed(relPath)?.title ?? relPath,
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openVaultIds, registry, getOpenRepo, revision]);

  const results = useMemo(() => {
    if (query.trim() === '') return candidates.slice(0, 50);
    return candidates
      .map((c) => ({ c, score: fuzzyMatch(query, c.title) ?? fuzzyMatch(query, c.relPath) }))
      .filter((x): x is { c: Candidate; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map((x) => x.c);
  }, [candidates, query]);

  async function openCandidate(c: Candidate): Promise<void> {
    await switchVault(c.vaultId);
    await setActiveNote(c.relPath);
    setOpen(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} />
        <Dialog.Content
          className="fixed left-1/2 top-24 z-50 w-[520px] max-w-[calc(100vw-24px)] -translate-x-1/2"
          style={{
            backgroundColor: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
          }}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <Dialog.Title className="sr-only">Quick switcher</Dialog.Title>
          <input
            ref={inputRef}
            className="w-full bg-transparent p-3 text-sm outline-none"
            style={{ borderBottom: '1px solid var(--border)', color: 'var(--fg)' }}
            placeholder="Jump to a note across open vaults..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlighted(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlighted((h) => Math.min(h + 1, results.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlighted((h) => Math.max(h - 1, 0));
              } else if (e.key === 'Enter') {
                const c = results[highlighted];
                if (c) void openCandidate(c);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
          />
          <div className="max-h-80 overflow-auto p-1">
            {results.length === 0 && (
              <div className="p-3 text-sm" style={{ color: 'var(--fg-muted)' }}>
                No matches
              </div>
            )}
            {results.map((c, i) => (
              <button
                type="button"
                key={`${c.vaultId}/${c.relPath}`}
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm"
                style={{ backgroundColor: i === highlighted ? 'var(--bg-panel)' : 'transparent', color: 'var(--fg)' }}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => void openCandidate(c)}
              >
                <span
                  aria-hidden
                  style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: c.vaultColor, flexShrink: 0 }}
                />
                <span className="truncate">{c.title}</span>
                <span
                  className="ml-auto shrink-0 truncate text-xs"
                  style={{ color: 'var(--fg-muted)', maxWidth: 160 }}
                >
                  {c.vaultName} · {c.relPath}
                </span>
              </button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
