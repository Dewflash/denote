// src/features/editor/BacklinksPanel.tsx — backlinks for the active note: source note + the
// line containing the link, click navigates. Backlinks are NEVER stored (D5) — this reads
// straight off repo.getBacklinks(), which is recomputed from the link index on every change.

import { useEffect, useMemo, useState } from 'react';
import { useVaultStore } from '../../state/vaultStore';

function lineContext(content: string, offset: number): string {
  const before = content.lastIndexOf('\n', offset - 1) + 1;
  let after = content.indexOf('\n', offset);
  if (after === -1) after = content.length;
  return content.slice(before, after).trim();
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="p-3 text-sm" style={{ color: 'var(--fg-muted)' }}>
      {text}
    </div>
  );
}

function PanelHint({ text }: { text: string }) {
  return (
    <div
      className="px-3 pt-2 text-xs"
      style={{ color: 'var(--fg-muted)' }}
    >
      {text}
    </div>
  );
}

export function BacklinksPanel() {
  const repo = useVaultStore((s) => s.repo);
  const revision = useVaultStore((s) => s.revision);
  const activeNotePath = useVaultStore((s) => s.activeNotePath);
  const [contents, setContents] = useState<Record<string, string>>({});

  const backlinks = useMemo(() => {
    if (!repo || !activeNotePath) return [];
    return repo.getBacklinks(activeNotePath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, activeNotePath, revision]);

  useEffect(() => {
    if (!repo || backlinks.length === 0) return;
    let cancelled = false;
    const paths = [...new Set(backlinks.map((b) => b.fromPath))];
    void Promise.all(paths.map(async (p): Promise<[string, string]> => [p, await repo.readNote(p).catch(() => '')])).then(
      (entries) => {
        if (!cancelled) setContents(Object.fromEntries(entries));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [repo, backlinks]);

  if (!activeNotePath)
    return <EmptyState text="Open a note to see which other notes link to it." />;
  if (backlinks.length === 0)
    return (
      <EmptyState text="No other notes link to this one yet. To create a link, type [[ in another note and pick this note's title." />
    );

  return (
    <>
    <PanelHint text="Notes that link to this note — click one to open it." />
    <div className="flex flex-col gap-2 p-2 text-sm">
      {backlinks.map((b, i) => {
        const content = contents[b.fromPath];
        const context = content ? lineContext(content, b.link.offsetStart) : '';
        return (
          <button
            type="button"
            key={`${b.fromPath}-${b.link.offsetStart}-${i}`}
            className="w-full rounded p-2 text-left"
            style={{ border: '1px solid var(--border)', color: 'var(--fg)' }}
            onClick={() => void useVaultStore.getState().setActiveNote(b.fromPath)}
          >
            <span className="block truncate font-medium">{repo?.getParsed(b.fromPath)?.title ?? b.fromPath}</span>
            {context && (
              <span className="block truncate text-xs" style={{ color: 'var(--fg-muted)' }}>
                {context}
              </span>
            )}
          </button>
        );
      })}
    </div>
    </>
  );
}
