import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useState } from 'react';
import { useVaultStore } from '../../state/vaultStore';
import { gitFileHistory, gitReadFileAt, type GitCommitInfo } from '../../services/nativeGit';
import type { SnapshotFile } from '../../services/snapshots';
import { lineDiff, type VersionEntry } from './history';

export function VersionTimeline({ snapshots, root, relPath }: { snapshots: Promise<SnapshotFile[]>; root: string | null; relPath: string }) {
  const repo = useVaultStore((s) => s.repo);
  const revision = useVaultStore((s) => s.revision);
  const [entries, setEntries] = useState<VersionEntry[]>([]);
  const [preview, setPreview] = useState<{ entry: VersionEntry; content: string; diff: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      snapshots,
      root ? gitFileHistory(root, relPath).catch(() => [] as GitCommitInfo[]) : Promise.resolve([] as GitCommitInfo[]),
    ])
      .then(([snapshotItems, commits]) => {
        if (cancelled) return;
        const combined: VersionEntry[] = [
          ...snapshotItems.map((s) => ({
            id: `snapshot:${s.name}`,
            kind: 'snapshot' as const,
            label: new Date(s.at).toLocaleString(),
            at: s.at,
            size: s.size,
            name: s.name,
          })),
          ...commits.map((c) => ({
            id: `git:${c.oid}`,
            kind: 'git' as const,
            label: new Date(c.time * 1000).toLocaleString(),
            at: c.time * 1000,
            oid: c.oid,
            summary: c.summary,
          })),
        ].sort((a, b) => b.at - a.at).slice(0, 12);
        setEntries(combined);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [root, relPath, revision, snapshots]);

  const readEntry = async (entry: VersionEntry): Promise<string> => {
    if (!repo) throw new Error('vault not open');
    if (entry.kind === 'snapshot') return repo.readSnapshot(relPath, entry.name);
    if (!root) throw new Error('history is not enabled');
    return gitReadFileAt(root, relPath, entry.oid);
  };

  if (entries.length === 0) return <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>No versions yet.</p>;
  return (
    <div className="mt-3 flex flex-col gap-1 text-xs">
      {entries.map((entry) => (
        <div key={entry.id} className="flex items-center justify-between gap-2">
          <span className="truncate">
            {entry.label} · {entry.kind === 'git' ? entry.summary : `${Math.round(entry.size / 1024)} KB snapshot`}
          </span>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              style={{ color: 'var(--fg-muted)' }}
              onClick={() => {
                void readEntry(entry)
                  .then(async (content) => {
                    const current = await repo?.readNote(relPath).catch(() => '') ?? '';
                    setPreview({ entry, content, diff: lineDiff(current, content) });
                  })
                  .catch((err) => setMessage(err instanceof Error ? err.message : String(err)));
              }}
            >
              Diff
            </button>
            <button
              type="button"
              style={{ color: 'var(--fg-muted)' }}
              onClick={() => {
                void readEntry(entry)
                  .then(async (content) => {
                    if (!repo) throw new Error('vault not open');
                    const store = useVaultStore.getState();
                    if (store.buffer?.relPath === relPath && store.buffer.dirty) await store.flushAutosave();
                    await repo.restoreNoteVersion(relPath, content);
                    await useVaultStore.getState().setActiveNote(relPath, { reveal: false });
                    setMessage(`Restored ${entry.kind === 'git' ? entry.oid.slice(0, 8) : entry.name}.`);
                  })
                  .catch((err) => setMessage(err instanceof Error ? err.message : String(err)));
              }}
            >
              Restore
            </button>
          </div>
        </div>
      ))}
      {preview && (
        <div className="mt-2 rounded p-2" style={{ border: '1px solid var(--border)' }}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="truncate">{preview.entry.label}</span>
            <button type="button" style={{ color: 'var(--fg-muted)' }} onClick={() => setPreview(null)}>Close</button>
          </div>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap" style={{ color: 'var(--fg-muted)' }}>
            {preview.diff || preview.content}
          </pre>
        </div>
      )}
      {message && <div style={{ color: 'var(--fg-muted)' }}>{message}</div>}
    </div>
  );
}

export function NoteHistoryDialog({ open, onOpenChange, relPath }: { open: boolean; onOpenChange: (open: boolean) => void; relPath: string | null }) {
  const repo = useVaultStore((s) => s.repo);
  const root = useVaultStore((s) => s.root);
  const revision = useVaultStore((s) => s.revision);
  const snapshots = useMemo(() => {
    void revision;
    return relPath && repo ? repo.listSnapshotVersions(relPath) : Promise.resolve([] as SnapshotFile[]);
  }, [relPath, repo, revision]);
  const title = relPath?.split('/').pop()?.replace(/\.md$/i, '') ?? 'Note';

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(620px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 p-5"
          style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: '0 8px 30px rgba(0,0,0,0.2)' }}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <Dialog.Title className="truncate text-base font-semibold">History: {title}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close note history" style={{ color: 'var(--fg-muted)' }}>×</button>
            </Dialog.Close>
          </div>
          {relPath ? <VersionTimeline snapshots={snapshots} root={root} relPath={relPath} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
