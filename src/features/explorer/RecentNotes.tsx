// src/features/explorer/RecentNotes.tsx — top notes by `edited` (mtime, S26), above the tree.

import { useEffect, useMemo, useState } from 'react';
import { useVaultStore } from '../../state/vaultStore';

const MAX_RECENT = 8;
const TICK_MS = 60_000;

function relativeTime(at: number, now: number): string {
  const diffMs = now - at;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return 'just now';
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  return `${Math.floor(diffMs / day)}d ago`;
}

export function RecentNotes() {
  const repo = useVaultStore((s) => s.repo);
  const revision = useVaultStore((s) => s.revision);
  const activeNotePath = useVaultStore((s) => s.activeNotePath);

  // Impure `Date.now()` reads are confined to the lazy useState initializer + the effect below
  // (React's sanctioned escape hatches), never the render body itself.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const recent = useMemo(() => {
    if (!repo) return [];
    return [...repo.index.mtimes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_RECENT)
      .map(([relPath, mtime]) => ({
        relPath,
        mtime,
        title: repo.getParsed(relPath)?.title ?? relPath,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, revision]);

  if (recent.length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5 pb-2" style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="px-2 pb-1 text-xs uppercase tracking-wide" style={{ color: 'var(--fg-muted)' }}>
        Recent
      </div>
      {recent.map((n) => (
        <button
          type="button"
          key={n.relPath}
          className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-sm"
          style={{
            backgroundColor: activeNotePath === n.relPath ? 'var(--bg-panel)' : 'transparent',
            color: 'var(--fg)',
          }}
          onClick={() => void useVaultStore.getState().setActiveNote(n.relPath)}
        >
          <span className="truncate">{n.title}</span>
          <span className="shrink-0 text-xs" style={{ color: 'var(--fg-muted)' }}>
            {relativeTime(n.mtime, now)}
          </span>
        </button>
      ))}
    </div>
  );
}
