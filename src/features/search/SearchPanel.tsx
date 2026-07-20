// src/features/search/SearchPanel.tsx — cmd-shift-F (S21): full-text search across every OPEN
// vault (each with its own MiniSearch instance, D15), with highlighted snippets and the
// `tag:`/`folder:`/`vault:`/`has:ghosts` filters (pass-05 brief). Clicking a result switches to
// its vault (instant if already active) and opens the note.

import * as Dialog from '@radix-ui/react-dialog';
import { type ReactNode, useMemo, useRef, useState } from 'react';
import { useUiStore } from '../../state/uiStore';
import { useVaultStore } from '../../state/vaultStore';
import { parseSearchQuery, type SearchHit } from '../../services/searchIndex';

interface HitWithVault extends SearchHit {
  vaultId: string;
  vaultName: string;
  vaultColor: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Highlights whole-word (case-insensitive) occurrences of the query terms within a snippet. */
function highlightSnippet(snippet: string, terms: string[]): ReactNode {
  if (terms.length === 0 || snippet === '') return snippet;
  const re = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  const parts = snippet.split(re);
  return parts.map((part, i) =>
    terms.some((t) => t.toLowerCase() === part.toLowerCase()) ? (
      <mark key={i} style={{ backgroundColor: 'var(--accent)', color: '#fff', borderRadius: 2, padding: '0 1px' }}>
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function SearchPanel() {
  const open = useUiStore((s) => s.searchOpen);
  const setOpen = useUiStore((s) => s.setSearchOpen);
  const openVaultIds = useVaultStore((s) => s.openVaultIds);
  const registry = useVaultStore((s) => s.registry);
  const getSearchIndex = useVaultStore((s) => s.getSearchIndex);
  const indexRevision = useVaultStore((s) => s.indexRevision);
  const switchVault = useVaultStore((s) => s.switchVault);
  const setActiveNote = useVaultStore((s) => s.setActiveNote);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setQuery('');
  }

  const parsed = useMemo(() => parseSearchQuery(query), [query]);

  const hits: HitWithVault[] = useMemo(() => {
    const out: HitWithVault[] = [];
    for (const vaultId of openVaultIds) {
      const entry = registry.find((v) => v.id === vaultId);
      if (parsed.vault) {
        const needle = parsed.vault.toLowerCase();
        const matchesVault = vaultId === parsed.vault || (entry?.name.toLowerCase().includes(needle) ?? false);
        if (!matchesVault) continue;
      }
      const index = getSearchIndex(vaultId);
      if (!index) continue;
      if (parsed.text.trim() === '' && !parsed.tag && parsed.folder === undefined && !parsed.hasGhosts) continue;
      for (const hit of index.search(parsed.text, { tag: parsed.tag, folder: parsed.folder, hasGhosts: parsed.hasGhosts })) {
        out.push({ ...hit, vaultId, vaultName: entry?.name ?? vaultId, vaultColor: entry?.color ?? '#888888' });
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openVaultIds, registry, getSearchIndex, parsed, indexRevision]);

  async function openHit(hit: HitWithVault): Promise<void> {
    await switchVault(hit.vaultId);
    await setActiveNote(hit.relPath);
    setOpen(false);
  }

  const matchedTerms = parsed.text.trim() === '' ? [] : parsed.text.trim().split(/\s+/);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} />
        <Dialog.Content
          className="fixed left-1/2 top-20 z-50 flex max-h-[calc(100dvh-96px)] w-[600px] max-w-[calc(100vw-24px)] flex-col -translate-x-1/2"
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
          <Dialog.Title className="sr-only">Search</Dialog.Title>
          <input
            ref={inputRef}
            className="w-full bg-transparent p-3 text-sm outline-none"
            style={{ borderBottom: '1px solid var(--border)', color: 'var(--fg)' }}
            placeholder='Search notes... "tag:finance" "folder:Japan" "vault:Personal" "has:ghosts"'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
              else if (e.key === 'Enter' && hits[0]) void openHit(hits[0]);
            }}
          />
          <div className="flex-1 overflow-auto p-1">
            {query.trim() === '' && (
              <div className="p-3 text-sm" style={{ color: 'var(--fg-muted)' }}>
                Type to search{openVaultIds.length > 1 ? ' every open vault' : ''}.
              </div>
            )}
            {query.trim() !== '' && hits.length === 0 && (
              <div className="p-3 text-sm" style={{ color: 'var(--fg-muted)' }}>
                No results
              </div>
            )}
            {hits.map((hit) => (
              <button
                key={`${hit.vaultId}/${hit.relPath}`}
                className="flex w-full flex-col items-start gap-1 rounded px-3 py-2 text-left text-sm"
                onClick={() => void openHit(hit)}
              >
                <div className="flex w-full items-center gap-2">
                  <span
                    aria-hidden
                    style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: hit.vaultColor, flexShrink: 0 }}
                  />
                  <span className="truncate font-medium">{hit.title}</span>
                  {openVaultIds.length > 1 && (
                    <span className="ml-auto shrink-0 text-xs" style={{ color: 'var(--fg-muted)' }}>
                      {hit.vaultName}
                    </span>
                  )}
                </div>
                <div className="truncate text-xs" style={{ color: 'var(--fg-muted)' }}>
                  {hit.folder || '(vault root)'}
                </div>
                {hit.snippet && (
                  <div className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                    {highlightSnippet(hit.snippet, matchedTerms)}
                  </div>
                )}
                {hit.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {hit.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded px-1.5 py-0.5 text-[10px]"
                        style={{ backgroundColor: 'var(--bg-panel)', color: 'var(--fg-muted)' }}
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
