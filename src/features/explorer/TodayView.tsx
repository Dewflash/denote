// src/features/explorer/TodayView.tsx — cmd-T: all notes created OR edited today (S26 precedence
// via domain/noteDates.ts), across the open vault. Replaces the center pane while open.
// Also the home of the pass-8 resurfacing cards ("Worth revisiting") — owner UX audit
// 2026-07-13 found the engine computed them but no UI ever showed them.

import { useEffect, useMemo, useState } from 'react';
import { useVaultStore } from '../../state/vaultStore';
import { useUiStore } from '../../state/uiStore';
import { computeNoteDates, isSameLocalDay } from '../../domain/noteDates';
import { captureFromClipboard, isPasteCaptureTarget } from '../capture';
import type { ResurfaceCard } from '../../domain/ontology';

function WorthRevisiting() {
  const repo = useVaultStore((s) => s.repo);
  const revision = useVaultStore((s) => s.revision);
  const setTodayViewOpen = useUiStore((s) => s.setTodayViewOpen);
  const [cards, setCards] = useState<ResurfaceCard[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const engine = useVaultStore.getState().getActiveOntologyEngine();
      const next = engine ? await engine.computeResurfacingCards().catch(() => []) : [];
      if (!cancelled) setCards(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, revision]);

  if (cards.length === 0) return null;

  return (
    <div className="mt-6">
      <h3 className="mb-1 text-sm font-semibold">Worth revisiting</h3>
      <p className="mb-2 text-xs" style={{ color: 'var(--fg-muted)' }}>
        Older notes related to what you've been writing about lately.
      </p>
      <div className="flex flex-col gap-1">
        {cards.map((c) => (
          <div
            key={c.relPath}
            className="flex items-center gap-2 rounded px-3 py-2 text-sm"
            style={{ border: '1px solid var(--border)', cursor: 'pointer' }}
            onClick={() => {
              void useVaultStore.getState().setActiveNote(c.relPath);
              setTodayViewOpen(false);
            }}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">
                {repo?.getParsed(c.relPath)?.title ?? c.relPath}
              </div>
              <div className="truncate text-xs" style={{ color: 'var(--fg-muted)' }}>
                {c.reason}
              </div>
            </div>
            <button
              title="Don't suggest this note again"
              className="rounded px-1.5"
              style={{ color: 'var(--fg-muted)' }}
              onClick={(e) => {
                e.stopPropagation();
                const engine = useVaultStore.getState().getActiveOntologyEngine();
                void engine?.dismissResurfacing(c.relPath).then(() => {
                  setCards((cur) => cur.filter((x) => x.relPath !== c.relPath));
                });
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TodayView() {
  const repo = useVaultStore((s) => s.repo);
  const revision = useVaultStore((s) => s.revision);
  const setTodayViewOpen = useUiStore((s) => s.setTodayViewOpen);
  // Impure Date.now() confined to the lazy initializer (React's sanctioned escape hatch).
  const [now] = useState(() => Date.now());

  const notes = useMemo(() => {
    if (!repo) return [];
    const out: { relPath: string; title: string; created: number; edited: number }[] = [];
    for (const relPath of repo.listNotePaths()) {
      const parsed = repo.getParsed(relPath);
      if (!parsed) continue;
      const btime = repo.index.getBtime(relPath) ?? repo.index.mtimes.get(relPath) ?? now;
      const mtime = repo.index.mtimes.get(relPath) ?? now;
      const dates = computeNoteDates(parsed.frontmatter, btime, mtime);
      if (isSameLocalDay(dates.created, now) || isSameLocalDay(dates.edited, now)) {
        out.push({ relPath, title: parsed.title, created: dates.created, edited: dates.edited });
      }
    }
    out.sort((a, b) => b.edited - a.edited);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, revision, now]);

  return (
    <div
      className="flex h-full flex-col overflow-auto p-4"
      tabIndex={0}
      onPaste={(e) => {
        if (!isPasteCaptureTarget(e.target)) return;
        const text = e.clipboardData.getData('text/plain');
        if (!text) return;
        e.preventDefault();
        void captureFromClipboard(text);
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Today</h2>
        <button
          className="text-sm"
          style={{ color: 'var(--fg-muted)' }}
          onClick={() => setTodayViewOpen(false)}
        >
          Close
        </button>
      </div>
      {notes.length === 0 ? (
        <p style={{ color: 'var(--fg-muted)' }}>No notes created or edited today yet.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {notes.map((n) => (
            <div
              key={n.relPath}
              className="cursor-pointer rounded px-3 py-2 text-sm"
              style={{ border: '1px solid var(--border)' }}
              onClick={() => {
                void useVaultStore.getState().setActiveNote(n.relPath);
                setTodayViewOpen(false);
              }}
            >
              <div className="font-medium">{n.title}</div>
              <div style={{ color: 'var(--fg-muted)' }}>{n.relPath}</div>
            </div>
          ))}
        </div>
      )}
      <WorthRevisiting />
    </div>
  );
}
