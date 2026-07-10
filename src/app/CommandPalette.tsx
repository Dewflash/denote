// src/app/CommandPalette.tsx — cmd-P (S21): open note, new note, toggle reading view, open
// settings. Radix Dialog (D16).

import * as Dialog from '@radix-ui/react-dialog';
import { useMemo, useRef, useState } from 'react';
import { useUiStore } from '../state/uiStore';
import { useVaultStore } from '../state/vaultStore';
import { createUntitledNote } from '../features/capture';

interface PaletteCommand {
  id: string;
  label: string;
  run: () => void;
}

export function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const repo = useVaultStore((s) => s.repo);
  const activeNotePath = useVaultStore((s) => s.activeNotePath);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset the query/highlight whenever the dialog transitions to open — adjusted synchronously
  // during render (React's recommended pattern) rather than in an effect, since an effect would
  // fire a second, cascading render on every open.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery('');
      setHighlighted(0);
    }
  }

  const staticCommands: PaletteCommand[] = useMemo(
    () => [
      {
        id: 'new-note',
        label: 'New note',
        run: () => void createUntitledNote(useUiStore.getState().selectedFolder),
      },
      {
        id: 'toggle-reading',
        label: 'Toggle reading view',
        run: () => useUiStore.getState().toggleViewMode(),
      },
      { id: 'open-settings', label: 'Open settings', run: () => useUiStore.getState().setSettingsOpen(true) },
      {
        id: 'organize-vault',
        label: 'Organize vault (topics & clusters)',
        run: () => useUiStore.getState().setOrganizeVaultOpen(true),
      },
      ...(activeNotePath
        ? [
            {
              id: 'enrich-note',
              label: 'Enrich this note now',
              run: () => void useVaultStore.getState().enrichActiveNote(),
            },
            {
              id: 'suggest-links',
              label: 'Suggest links for this note',
              run: () => void useVaultStore.getState().enrichActiveNote({ linksOnly: true }),
            },
          ]
        : []),
    ],
    [activeNotePath],
  );

  const noteCommands: PaletteCommand[] = useMemo(() => {
    if (!repo) return [];
    const q = query.toLowerCase();
    return repo
      .listNotePaths()
      .map((relPath) => ({ relPath, title: repo.getParsed(relPath)?.title ?? relPath }))
      .filter((n) => n.title.toLowerCase().includes(q))
      .slice(0, 50)
      .map((n) => ({
        id: `open:${n.relPath}`,
        label: `Open: ${n.title}`,
        run: () => void useVaultStore.getState().setActiveNote(n.relPath),
      }));
  }, [repo, query]);

  const commands = useMemo(() => {
    const q = query.toLowerCase();
    return [...staticCommands.filter((c) => c.label.toLowerCase().includes(q)), ...noteCommands];
  }, [staticCommands, noteCommands, query]);

  const runAndClose = (cmd: PaletteCommand): void => {
    cmd.run();
    setOpen(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} />
        <Dialog.Content
          className="fixed left-1/2 top-24 z-50 w-[520px] -translate-x-1/2"
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
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <input
            ref={inputRef}
            className="w-full bg-transparent p-3 text-sm outline-none"
            style={{ borderBottom: '1px solid var(--border)', color: 'var(--fg)' }}
            placeholder="Type a command or search notes..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlighted(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlighted((h) => Math.min(h + 1, commands.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlighted((h) => Math.max(h - 1, 0));
              } else if (e.key === 'Enter') {
                const cmd = commands[highlighted];
                if (cmd) runAndClose(cmd);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
          />
          <div className="max-h-80 overflow-auto p-1">
            {commands.length === 0 && (
              <div className="p-3 text-sm" style={{ color: 'var(--fg-muted)' }}>
                No matches
              </div>
            )}
            {commands.map((c, i) => (
              <div
                key={c.id}
                className="cursor-pointer rounded px-3 py-2 text-sm"
                style={{ backgroundColor: i === highlighted ? 'var(--bg-panel)' : 'transparent' }}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => runAndClose(c)}
              >
                {c.label}
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
