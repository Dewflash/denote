import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useUiStore, type ImportReviewDraft } from '../../state/uiStore';
import { useVaultStore } from '../../state/vaultStore';

export function ImportReviewModal() {
  const draft = useUiStore((s) => s.importReview);
  if (!draft) return null;
  return <ImportReview key={`${draft.sourceLabel}:${draft.items.map((item) => item.incoming.relPath).join('|')}`} draft={draft} />;
}

function ImportReview({ draft }: { draft: ImportReviewDraft }) {
  const close = useUiStore((s) => s.closeImportReview);
  const repo = useVaultStore((s) => s.repo);
  const createNote = useVaultStore((s) => s.createNote);
  const [items, setItems] = useState(draft.items);
  const [message, setMessage] = useState<string | null>(null);

  async function importItem(item: ImportReviewDraft['items'][number]): Promise<void> {
    try {
      await createNote(item.incoming.relPath, item.incoming.content);
      setItems((current) => current.filter((candidate) => candidate !== item));
      setMessage(`Imported ${item.incoming.relPath}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-24px)] w-[560px] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 overflow-auto p-5" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: '0 8px 30px rgba(0,0,0,0.2)' }}>
          <Dialog.Title className="mb-1 text-base font-semibold">Review imported notes</Dialog.Title>
          <p className="mb-3 text-xs" style={{ color: 'var(--fg-muted)' }}>{draft.sourceLabel} · {draft.exactSkipped} exact duplicate{draft.exactSkipped === 1 ? '' : 's'} skipped automatically.</p>
          {draft.warnings.length > 0 && <p className="mb-3 rounded p-2 text-xs" style={{ border: '1px solid var(--danger)', color: 'var(--danger)' }}>{draft.warnings.join(' ')}</p>}
          <div className="flex max-h-72 flex-col gap-2 overflow-auto">
            {items.length === 0 ? <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>All incoming files have been handled.</p> : items.map((item) => (
              <div key={`${item.incoming.relPath}:${item.duplicateOf ?? ''}`} className="rounded p-2 text-xs" style={{ border: '1px solid var(--border)' }}>
                <div className="flex items-center justify-between gap-2"><strong className="truncate">{item.incoming.relPath}</strong><span style={{ color: 'var(--fg-muted)' }}>{item.decision === 'review-near' ? `${Math.round((item.similarity ?? 0) * 100)}% similar` : 'warning'}</span></div>
                <div className="my-1 truncate" style={{ color: 'var(--fg-muted)' }}>{item.reason}{item.duplicateOf ? ` · ${item.duplicateOf}` : ''}</div>
                <div className="flex gap-2"><button type="button" className="rounded px-2 py-1" style={{ border: '1px solid var(--border)' }} disabled={!repo} onClick={() => void importItem(item)}>Import anyway</button><button type="button" onClick={() => setItems((current) => current.filter((candidate) => candidate !== item))} style={{ color: 'var(--fg-muted)' }}>Skip</button></div>
              </div>
            ))}
          </div>
          {message && <p className="mt-2 text-xs" style={{ color: 'var(--fg-muted)' }}>{message}</p>}
          <div className="mt-4 flex justify-end"><button type="button" className="rounded px-3 py-1.5 text-sm" style={{ border: '1px solid var(--border)' }} onClick={close}>Done</button></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
