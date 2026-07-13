// src/features/ai/DeepOrganizeModal.tsx — the pass-9 cloud "Deep organize" UI (D12/D13/S27).
// A two-step flow: PLAN (assemble the corpus, count tokens, show the cost ESTIMATE + item count —
// no submission yet) → CONFIRM → RUN (submit the Batch API job under the hard budget cap, poll,
// apply results). Confirmation is required on the first run of each month (brief). If the estimate
// exceeds the remaining cap the run button refuses (budget-exceeded is a hard code gate, S27).

import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { useUiStore } from '../../state/uiStore';
import { useVaultStore } from '../../state/vaultStore';
import type { DeepOrganizePlan } from '../../state/deepOrganize';
import { DenoteError } from '../../services/errors';

type Phase = 'idle' | 'planning' | 'ready' | 'running' | 'done' | 'error';

export function DeepOrganizeModal() {
  const open = useUiStore((s) => s.deepOrganizeOpen);
  const setOpen = useUiStore((s) => s.setDeepOrganizeOpen);
  const keyPresent = useVaultStore((s) => s.anthropicKeyPresent);
  const planFn = useVaultStore((s) => s.planDeepOrganize);
  const runFn = useVaultStore((s) => s.runDeepOrganize);

  const [phase, setPhase] = useState<Phase>('idle');
  const [plan, setPlan] = useState<DeepOrganizePlan | null>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ notes: number; themes: number; costUsd: number; lost: boolean } | null>(null);

  const reset = (): void => {
    setPhase('idle');
    setPlan(null);
    setProgress('');
    setError('');
    setResult(null);
  };

  const doPlan = async (): Promise<void> => {
    setPhase('planning');
    setError('');
    try {
      const p = await planFn();
      setPlan(p);
      setPhase('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  };

  const doRun = async (): Promise<void> => {
    if (!plan) return;
    setPhase('running');
    try {
      const res = await runFn(plan, (p) => setProgress(p.message));
      setResult(res);
      setPhase('done');
    } catch (err) {
      setError(err instanceof DenoteError ? err.message : err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  };

  const busy = phase === 'planning' || phase === 'running';

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (!busy ? (o ? setOpen(true) : (setOpen(false), reset())) : undefined)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-24px)] w-[460px] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 overflow-auto p-5"
          style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: '0 8px 30px rgba(0,0,0,0.2)' }}
        >
          <Dialog.Title className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>
            Deep organize (cloud)
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-xs" style={{ color: 'var(--fg-muted)' }}>
            A monthly cloud pass over note SUMMARIES (never full text): reasons about topics and finds
            cross-note themes the on-device model can&apos;t. Runs under your hard monthly budget cap.
            Local-only vaults are excluded.
          </Dialog.Description>

          {!keyPresent && (
            <p className="mt-3 text-xs" style={{ color: 'var(--danger)' }}>
              No Anthropic API key set. Add one in Settings → AI &amp; Models first.
            </p>
          )}

          {phase === 'planning' && (
            <p className="mt-4 text-xs" style={{ color: 'var(--fg-muted)' }}>
              Assembling corpus &amp; counting tokens…
            </p>
          )}

          {plan && (phase === 'ready' || phase === 'running' || phase === 'done') && (
            <div className="mt-4 rounded p-3 text-xs" style={{ border: '1px solid var(--border)', color: 'var(--fg-muted)' }}>
              <div className="flex justify-between">
                <span>Items</span>
                <span style={{ color: 'var(--fg)' }}>{plan.itemCount} ({plan.noteCount} notes + themes)</span>
              </div>
              <div className="flex justify-between">
                <span>Input tokens (counted)</span>
                <span style={{ color: 'var(--fg)' }}>{plan.inputTokens.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Estimated cost (Batch, ×1.2 margin)</span>
                <span style={{ color: 'var(--fg)' }}>${plan.guardCostUsd.toFixed(3)}</span>
              </div>
              <div className="flex justify-between">
                <span>Remaining budget this month</span>
                <span style={{ color: plan.withinBudget ? 'var(--fg)' : 'var(--danger)' }}>${plan.remainingUsd.toFixed(2)}</span>
              </div>
              {plan.trimmed && <div className="mt-1">Some lower-priority notes were trimmed to fit the budget.</div>}
              {!plan.withinBudget && <div className="mt-1" style={{ color: 'var(--danger)' }}>Over budget — raise the cap in Settings to run.</div>}
            </div>
          )}

          {phase === 'running' && progress && (
            <p className="mt-3 text-xs" style={{ color: 'var(--fg-muted)' }}>{progress}</p>
          )}

          {phase === 'done' && result && (
            <p className="mt-3 text-xs" style={{ color: 'var(--fg-muted)' }}>
              {result.lost
                ? 'The batch expired before results could be fetched — logged as a loss in the spend page.'
                : `Applied ${result.notes} note updates and ${result.themes} themes. Actual cost $${result.costUsd.toFixed(3)}.`}
            </p>
          )}

          {phase === 'error' && <p className="mt-3 text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              className="rounded px-3 py-1.5 text-xs"
              style={{ border: '1px solid var(--border)', color: 'var(--fg)', opacity: busy ? 0.5 : 1 }}
              disabled={busy}
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Close
            </button>
            {(phase === 'idle' || phase === 'error') && (
              <button
                className="rounded px-3 py-1.5 text-xs font-medium"
                style={{ backgroundColor: 'var(--accent)', color: '#fff', opacity: keyPresent ? 1 : 0.5 }}
                disabled={!keyPresent}
                onClick={() => void doPlan()}
              >
                Estimate…
              </button>
            )}
            {phase === 'ready' && (
              <button
                className="rounded px-3 py-1.5 text-xs font-medium"
                style={{ backgroundColor: 'var(--accent)', color: '#fff', opacity: plan?.withinBudget ? 1 : 0.5 }}
                disabled={!plan?.withinBudget}
                onClick={() => void doRun()}
              >
                {plan?.firstRunThisMonth ? 'Confirm & run (first this month)' : 'Run'}
              </button>
            )}
            {phase === 'done' && (
              <button
                className="rounded px-3 py-1.5 text-xs font-medium"
                style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
                onClick={reset}
              >
                New estimate
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
