// src/features/ai/OrganizeVaultModal.tsx — the pass-8 "Organize vault" batch UI: an on-device
// sweep (re-enrich stale notes → folder profiles + misfit → topic merge/prune → `_topics`
// materialization) with a live progress bar and a Cancel button (the job is cooperatively
// cancellable via a CancelToken the modal owns). Radix Dialog (D16), token-driven.

import * as Dialog from '@radix-ui/react-dialog';
import { useRef, useState } from 'react';
import { useUiStore } from '../../state/uiStore';
import { useVaultStore } from '../../state/vaultStore';
import type { OrganizePhase, OrganizeResult, CancelToken } from '../../state/vaultOntologyEngine';

const PHASE_LABEL: Record<OrganizePhase, string> = {
  're-enrich': 'Re-enriching changed notes',
  folders: 'Profiling folders & finding misfits',
  topics: 'Merging near-duplicate topics',
};

export function OrganizeVaultModal() {
  const open = useUiStore((s) => s.organizeVaultOpen);
  const setOpen = useUiStore((s) => s.setOrganizeVaultOpen);
  const organize = useVaultStore((s) => s.organizeActiveVault);
  const vaultId = useVaultStore((s) => s.vaultId);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; phase: OrganizePhase } | null>(null);
  const [result, setResult] = useState<OrganizeResult | null>(null);
  const cancelRef = useRef<CancelToken>({ aborted: false });

  const start = async (): Promise<void> => {
    setRunning(true);
    setResult(null);
    cancelRef.current = { aborted: false };
    const res = await organize({
      onProgress: (done, total, phase) => setProgress({ done, total, phase }),
      signal: cancelRef.current,
    });
    setRunning(false);
    setProgress(null);
    setResult(res ?? { cancelled: true, mergedTopics: 0, prunedTopics: 0, materializedTopics: 0 });
  };

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !running && setOpen(o)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-24px)] w-[440px] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 overflow-auto p-5"
          style={{
            backgroundColor: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
          }}
        >
          <Dialog.Title className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>
            Organize vault
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-xs" style={{ color: 'var(--fg-muted)' }}>
            An on-device pass that reconciles topics, profiles folders, flags misfit notes, and
            regenerates topic hub notes. Nothing is sent off-device; note bodies are never moved.
          </Dialog.Description>

          {progress && (
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs" style={{ color: 'var(--fg-muted)' }}>
                <span>{PHASE_LABEL[progress.phase]}</span>
                <span>
                  {progress.done}/{progress.total}
                </span>
              </div>
              <div style={{ height: 6, backgroundColor: 'var(--bg-panel)', borderRadius: 3 }}>
                <div style={{ width: `${pct}%`, height: '100%', backgroundColor: 'var(--accent)', borderRadius: 3, transition: 'width 120ms' }} />
              </div>
            </div>
          )}

          {result && (
            <div className="mt-4 text-xs" style={{ color: 'var(--fg-muted)' }}>
              {result.cancelled
                ? 'Cancelled.'
                : `Done — merged ${result.mergedTopics}, pruned ${result.prunedTopics}, regenerated ${result.materializedTopics} topic notes.`}
            </div>
          )}

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {running ? (
              <button
                className="rounded px-3 py-1.5 text-xs"
                style={{ border: '1px solid var(--border)', color: 'var(--fg)' }}
                onClick={() => (cancelRef.current.aborted = true)}
              >
                Cancel
              </button>
            ) : (
              <>
                <button
                  className="rounded px-3 py-1.5 text-xs"
                  style={{ border: '1px solid var(--border)', color: 'var(--fg)' }}
                  onClick={() => setOpen(false)}
                >
                  Close
                </button>
                <button
                  className="rounded px-3 py-1.5 text-xs font-medium"
                  style={{ backgroundColor: 'var(--accent)', color: '#fff', opacity: vaultId ? 1 : 0.5 }}
                  disabled={!vaultId}
                  onClick={() => void start()}
                >
                  {result ? 'Run again' : 'Start'}
                </button>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
