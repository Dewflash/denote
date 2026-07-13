// src/app/StatusBar.tsx — word count of the open note + the active vault's name (pass-05: with
// its registered accent color dot, the "headers" surface named alongside rail + hulls in the
// brief's "per-vault accent color used on rail + hulls + headers").

import { useMemo, useState } from 'react';
import { useVaultStore } from '../state/vaultStore';
import { deriveGraphHealth } from './graphHealth';

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

export function StatusBar() {
  const root = useVaultStore((s) => s.root);
  const vaultId = useVaultStore((s) => s.vaultId);
  const registry = useVaultStore((s) => s.registry);
  const buffer = useVaultStore((s) => s.buffer);
  const repo = useVaultStore((s) => s.repo);
  const revision = useVaultStore((s) => s.revision);

  const words = useMemo(() => (buffer ? wordCount(buffer.content) : 0), [buffer]);
  const activeEntry = registry.find((v) => v.id === vaultId);
  const vaultName = activeEntry?.name ?? root?.split('/').filter(Boolean).pop() ?? 'No vault';
  const health = useMemo(() => {
    void revision;
    return repo ? deriveGraphHealth(repo.index.allNotes(), repo.index.getLinkIndex()) : { orphans: [], unresolvedLinks: [] };
  }, [repo, revision]);
  const [open, setOpen] = useState(false);
  const setActiveNote = useVaultStore((s) => s.setActiveNote);
  const createGhostAndOpen = useVaultStore((s) => s.createGhostAndOpen);

  async function openGhost(sourcePath: string, target: string): Promise<void> {
    await setActiveNote(sourcePath);
    await createGhostAndOpen(target);
    setOpen(false);
  }

  return (
    <div
      className="denote-status-bar flex items-center justify-between px-3 text-xs"
      style={{
        height: 24,
        borderTop: '1px solid var(--border)',
        color: 'var(--fg-muted)',
        backgroundColor: 'var(--bg-panel)',
      }}
    >
      <span className="denote-status-vault flex items-center gap-1.5">
        {activeEntry && (
          <span
            aria-hidden
            style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: activeEntry.color }}
          />
        )}
        {vaultName}
      </span>
      <span className="denote-status-meta relative flex items-center gap-3">
        {repo && (
          <>
            <button
              type="button"
              title="Inspect unlinked notes and missing notes"
              aria-expanded={open}
              aria-controls="status-graph-health"
              onClick={() => setOpen((value) => !value)}
              className="denote-status-health rounded px-1"
              style={{ color: health.orphans.length || health.unresolvedLinks.length ? 'var(--fg)' : 'var(--fg-muted)' }}
            >
              {health.orphans.length} unlinked · {health.unresolvedLinks.length} missing
            </button>
            {open && (
              <div
                id="status-graph-health"
                role="dialog"
                aria-label="Unlinked notes and missing notes"
                className="absolute bottom-7 right-0 z-30 flex w-80 max-w-[calc(100vw-24px)] flex-col gap-3 rounded p-3 text-xs shadow-lg"
                style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--fg)' }}
              >
                <div className="flex items-center justify-between gap-2">
                  <strong>Graph health</strong>
                  <button type="button" aria-label="Close graph health" onClick={() => setOpen(false)} style={{ color: 'var(--fg-muted)' }}>×</button>
                </div>
                <section>
                  <div className="mb-1 uppercase" style={{ color: 'var(--fg-muted)' }}>Notes nothing links to ({health.orphans.length})</div>
                  <div className="mb-2 text-xs" style={{ color: 'var(--fg-muted)' }}>Link to them from another note, or delete them.</div>
                  {health.orphans.length === 0 ? (
                    <div style={{ color: 'var(--fg-muted)' }}>Every note has a connection.</div>
                  ) : (
                    <div className="flex max-h-32 flex-col gap-1 overflow-auto">
                      {health.orphans.map((note) => (
                        <button
                          type="button"
                          key={note.relPath}
                          className="truncate rounded px-1.5 py-1 text-left"
                          title={note.relPath}
                          onClick={() => { void setActiveNote(note.relPath); setOpen(false); }}
                          style={{ backgroundColor: 'var(--bg-panel)' }}
                        >
                          {note.title}
                        </button>
                      ))}
                    </div>
                  )}
                </section>
                <section>
                  <div className="mb-1 uppercase" style={{ color: 'var(--fg-muted)' }}>Links to notes that don&apos;t exist yet ({health.unresolvedLinks.length})</div>
                  <div className="mb-2 text-xs" style={{ color: 'var(--fg-muted)' }}>Click one to create that note.</div>
                  {health.unresolvedLinks.length === 0 ? (
                    <div style={{ color: 'var(--fg-muted)' }}>No unresolved wikilinks.</div>
                  ) : (
                    <div className="flex max-h-40 flex-col gap-1 overflow-auto">
                      {health.unresolvedLinks.map((link) => (
                        <button
                          type="button"
                          key={link.id}
                          className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left"
                          style={{ backgroundColor: 'var(--bg-panel)' }}
                          onClick={() => void openGhost(link.fromPath, link.target)}
                        >
                          <span className="min-w-0 flex-1 truncate" title={`${link.fromPath} → ${link.target}`}>
                            <strong>{link.target}</strong><span style={{ color: 'var(--fg-muted)' }}> from {link.fromPath}</span>
                          </span>
                          <span style={{ color: 'var(--accent)' }}>Create</span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}
          </>
        )}
        {buffer && <span>{words} words</span>}
      </span>
    </div>
  );
}
