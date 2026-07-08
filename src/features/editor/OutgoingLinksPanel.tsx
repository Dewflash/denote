// src/features/editor/OutgoingLinksPanel.tsx — outgoing links of the active note, with
// resolution status (resolved note vs ghost). Ghost click creates the note (S4).

import { useMemo } from 'react';
import { resolveLink } from '../../domain/links';
import { useVaultStore } from '../../state/vaultStore';

function EmptyState({ text }: { text: string }) {
  return (
    <div className="p-3 text-sm" style={{ color: 'var(--fg-muted)' }}>
      {text}
    </div>
  );
}

export function OutgoingLinksPanel() {
  const repo = useVaultStore((s) => s.repo);
  const revision = useVaultStore((s) => s.revision);
  const activeNotePath = useVaultStore((s) => s.activeNotePath);

  const links = useMemo(() => {
    if (!repo || !activeNotePath) return [];
    const parsed = repo.getParsed(activeNotePath);
    if (!parsed) return [];
    const notes = repo.listNotePaths().map((relPath) => ({
      relPath,
      title: repo.getParsed(relPath)?.title ?? relPath,
    }));
    return parsed.links.map((link) => ({
      link,
      resolution: resolveLink(link.targetTitle, notes, repo.vaultId),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, activeNotePath, revision]);

  if (!activeNotePath) return <EmptyState text="No note open" />;
  if (links.length === 0) return <EmptyState text="No outgoing links" />;

  return (
    <div className="flex flex-col gap-1 p-2 text-sm">
      {links.map(({ link, resolution }, i) => {
        const ghost = resolution.kind === 'ghost';
        return (
          <div
            key={`${link.offsetStart}-${i}`}
            className="rounded px-2 py-1"
            style={{ cursor: 'pointer' }}
            onClick={() => {
              if (resolution.kind === 'note') void useVaultStore.getState().setActiveNote(resolution.relPath);
              else void useVaultStore.getState().createGhostAndOpen(link.targetTitle);
            }}
          >
            <span className={ghost ? 'cm-denote-link cm-denote-link-ghost' : 'cm-denote-link'}>
              {link.alias ?? link.targetTitle}
            </span>
          </div>
        );
      })}
    </div>
  );
}
