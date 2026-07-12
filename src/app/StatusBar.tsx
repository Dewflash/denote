// src/app/StatusBar.tsx — word count of the open note + the active vault's name (pass-05: with
// its registered accent color dot, the "headers" surface named alongside rail + hulls in the
// brief's "per-vault accent color used on rail + hulls + headers").

import { useMemo } from 'react';
import { useVaultStore } from '../state/vaultStore';

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
  const derived = useMemo(() => {
    void revision;
    if (!repo) return { orphans: 0, ghosts: 0 };
    const notes = repo.index.allNotes();
    const linkIndex = repo.index.getLinkIndex();
    const outbound = new Set(linkIndex.map((l) => l.fromPath));
    const linked = new Set(
      linkIndex
        .filter((l) => l.resolution.kind === 'note')
        .map((l) => (l.resolution.kind === 'note' ? l.resolution.relPath : '')),
    );
    const ghosts = new Set(
      linkIndex
        .filter((l) => l.resolution.kind === 'ghost')
        .map((l) => (l.resolution.kind === 'ghost' ? l.resolution.id : '')),
    );
    return {
      orphans: notes.filter((n) => repo.getBacklinks(n.relPath).length === 0 && !linked.has(n.relPath) && !outbound.has(n.relPath)).length,
      ghosts: ghosts.size,
    };
  }, [repo, revision]);

  return (
    <div
      className="flex items-center justify-between px-3 text-xs"
      style={{
        height: 24,
        borderTop: '1px solid var(--border)',
        color: 'var(--fg-muted)',
        backgroundColor: 'var(--bg-panel)',
      }}
    >
      <span className="flex items-center gap-1.5">
        {activeEntry && (
          <span
            aria-hidden
            style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: activeEntry.color }}
          />
        )}
        {vaultName}
      </span>
      <span className="flex items-center gap-3">
        {repo && (
          <span title="Unlinked notes and unresolved wikilinks">
            {derived.orphans} orphans · {derived.ghosts} ghosts
          </span>
        )}
        {buffer && <span>{words} words</span>}
      </span>
    </div>
  );
}
