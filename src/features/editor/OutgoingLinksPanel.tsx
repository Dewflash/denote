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

function PanelHint({ text }: { text: string }) {
  return (
    <div className="px-3 pt-2 text-xs" style={{ color: 'var(--fg-muted)' }}>
      {text}
    </div>
  );
}

export function OutgoingLinksPanel() {
  const repo = useVaultStore((s) => s.repo);
  const indexRevision = useVaultStore((s) => s.indexRevision);
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
  }, [repo, activeNotePath, indexRevision]);

  if (!activeNotePath)
    return <EmptyState text="Open a note to see where it links to." />;
  if (links.length === 0)
    return (
      <EmptyState text="This note doesn't link anywhere yet. Type [[ while writing to link to another note." />
    );

  return (
    <>
    <PanelHint text="Notes this note links to — click one to open it. Faded names don't exist yet; clicking creates them." />
    <div className="flex flex-col gap-1 p-2 text-sm">
      {links.map(({ link, resolution }, i) => {
        const ghost = resolution.kind === 'ghost';
        return (
          <button
            type="button"
            key={`${link.offsetStart}-${i}`}
            className="w-full rounded px-2 py-1 text-left"
            style={{ color: 'var(--fg)' }}
            onClick={() => {
              if (resolution.kind === 'note') void useVaultStore.getState().setActiveNote(resolution.relPath);
              else void useVaultStore.getState().createGhostAndOpen(link.targetTitle);
            }}
          >
            <span className={ghost ? 'cm-denote-link cm-denote-link-ghost' : 'cm-denote-link'}>
              {link.alias ?? link.targetTitle}
            </span>
          </button>
        );
      })}
    </div>
    </>
  );
}
