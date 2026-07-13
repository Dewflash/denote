// src/features/ai/SuggestionsPanel.tsx — the AI suggestions surface (right sidebar, third tab).
// Groups the active note's live annotations by kind; each row shows the reason, a confidence
// bar, and a model badge (provenance, D6). Actions: Accept (writes real markdown via the
// repository), Reject (→ rejection memory, D10), and Accept-all-above-threshold. Applied
// provisional entries are shown distinctly (softer, "AI provisional" — S10) and are informational.

import { useMemo, useState } from 'react';
import { useVaultStore } from '../../state/vaultStore';
import { useUiStore } from '../../state/uiStore';
import type { AiAnnotation } from '../../domain';

const KIND_LABEL: Record<AiAnnotation['kind'], string> = {
  topic: 'Topics',
  link: 'Links',
  tag: 'Tags',
  summary: 'Summary',
  alias: 'Aliases',
};
const KIND_ORDER: AiAnnotation['kind'][] = ['topic', 'link', 'tag', 'alias', 'summary'];

function payloadLabel(a: AiAnnotation): string {
  const p = (a.payload ?? {}) as Record<string, unknown>;
  switch (a.kind) {
    case 'link':
      return String(p.target ?? '');
    case 'summary':
      return String(p.text ?? '');
    default:
      return String(p.name ?? '');
  }
}

function modelLabel(model: string): string {
  if (model.startsWith('apple')) return 'On-device AI';
  if (model.startsWith('claude') || model.startsWith('anthropic')) return 'Cloud AI';
  if (model.startsWith('mock')) return 'Test backend';
  return model;
}

function backendLabel(backend: string): string {
  if (backend === 'apple') return 'on-device AI';
  if (backend === 'anthropic') return 'Cloud AI';
  if (backend === 'mock') return 'the test backend preview';
  return backend;
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-1.5" title={`Confidence ${pct}%`}>
      <div style={{ width: 40, height: 5, borderRadius: 999, backgroundColor: 'var(--border)' }}>
        <div
          style={{
            width: `${pct}%`,
            height: 5,
            borderRadius: 999,
            backgroundColor: value >= 0.75 ? 'var(--accent)' : 'var(--fg-muted)',
          }}
        />
      </div>
      <span className="text-xs tabular-nums" style={{ color: 'var(--fg-muted)' }}>
        {pct}%
      </span>
    </div>
  );
}

function SuggestionRow({ ann }: { ann: AiAnnotation }) {
  const accept = useVaultStore((s) => s.acceptSuggestion);
  const reject = useVaultStore((s) => s.rejectSuggestion);
  const provisional = ann.status === 'applied-provisional';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-1 rounded p-2 text-sm"
      style={{
        border: `1px ${provisional ? 'dashed' : 'solid'} var(--border)`,
        opacity: provisional ? 0.85 : 1,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium" title={payloadLabel(ann)}>
          {payloadLabel(ann)}
        </span>
        <ConfidenceBar value={ann.confidence} />
      </div>
      <div className="text-xs" style={{ color: 'var(--fg-muted)' }}>
        {ann.reason}
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
          style={{ backgroundColor: 'var(--bg-panel)', color: 'var(--fg-muted)' }}
          title={provisional ? 'Applied provisionally into the ai: block (S10)' : `Suggested by ${ann.model}`}
        >
          {provisional ? 'AI provisional' : modelLabel(ann.model)}
        </span>
        <div className="flex gap-1.5">
          <button
            className="rounded px-2 py-0.5 text-xs"
            style={{ border: '1px solid var(--border)' }}
            disabled={busy}
            aria-busy={busy}
            onClick={() => void run(() => accept(ann.id))}
          >
            {busy ? 'Working…' : 'Accept'}
          </button>
          <button
            className="rounded px-2 py-0.5 text-xs"
            style={{ color: 'var(--fg-muted)' }}
            disabled={busy}
            onClick={() => void run(() => reject(ann.id))}
          >
            Reject
          </button>
        </div>
      </div>
      {error && <div role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>{error}</div>}
    </div>
  );
}

export function SuggestionsPanel() {
  const activeNotePath = useVaultStore((s) => s.activeNotePath);
  const revision = useVaultStore((s) => s.revision);
  const threshold = useUiStore((s) => s.aiTakeoverThreshold);
  const enrich = useVaultStore((s) => s.enrichActiveNote);
  const acceptAbove = useVaultStore((s) => s.acceptSuggestionsAbove);
  const appleAiHealth = useVaultStore((s) => s.appleAiHealth);
  const queueState = useVaultStore((s) => (activeNotePath ? s.aiQueueStateFor(activeNotePath) : 'idle'));
  const aiProcessed = useVaultStore((s) => (activeNotePath ? s.aiHasProcessed(activeNotePath) : false));
  const refreshAppleAiStatus = useVaultStore((s) => s.refreshAppleAiStatus);
  const enrichBackend = useVaultStore((s) => s.routingBackendFor('enrich'));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptingAll, setAcceptingAll] = useState(false);

  const suggestions = useMemo(
    () => (activeNotePath ? useVaultStore.getState().aiSuggestionsFor(activeNotePath) : []),
    // revision is the deliberate re-derive signal (engine bumps it on any annotation change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeNotePath, revision],
  );

  const grouped = useMemo(() => {
    const m = new Map<AiAnnotation['kind'], AiAnnotation[]>();
    for (const a of suggestions) {
      const list = m.get(a.kind) ?? [];
      list.push(a);
      m.set(a.kind, list);
    }
    return m;
  }, [suggestions]);

  // Misfit observation (pass-8): if Organize-vault flagged this note as not fitting its folder,
  // surface it here as an OBSERVATION — never an automatic move (D8/brief).
  const misfit = useMemo(
    () => useVaultStore.getState().getActiveOntologyEngine()?.misfits().find((m) => m.relPath === activeNotePath),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeNotePath, revision],
  );

  if (!activeNotePath) {
    return (
      <div className="p-3 text-sm" style={{ color: 'var(--fg-muted)' }}>
        Open a note to see AI suggestions.
      </div>
    );
  }

  const acceptableCount = suggestions.filter(
    (a) => a.status === 'suggested' && a.confidence >= threshold,
  ).length;

  const requestSuggestions = async (): Promise<void> => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      await enrich();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const acceptAll = async (): Promise<void> => {
    if (acceptingAll) return;
    setAcceptingAll(true);
    setError(null);
    try {
      await acceptAbove(activeNotePath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAcceptingAll(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="px-2 pt-2 text-xs" style={{ color: 'var(--fg-muted)' }}>
        The configured AI backend can suggest tags, links, and topics. High-confidence structure
        may appear provisionally in the reserved <code>ai:</code> metadata; your note body changes
        only when you accept a suggestion.
      </div>
      <div className="flex items-center justify-between gap-2 p-2" style={{ borderBottom: '1px solid var(--border)' }}>
        <button
          className="rounded px-2 py-1 text-xs"
          style={{ border: '1px solid var(--border)' }}
          disabled={running}
          aria-busy={running}
          onClick={() => void requestSuggestions()}
          title="Ask the AI to re-read this note right now"
        >
          {running ? 'Getting suggestions…' : 'Get suggestions'}
        </button>
        {acceptableCount > 0 && (
          <button
            className="rounded px-2 py-1 text-xs"
            style={{ border: '1px solid var(--border)' }}
            disabled={acceptingAll}
            aria-busy={acceptingAll}
            onClick={() => void acceptAll()}
            title={`Accept the ${acceptableCount} suggestion(s) at or above ${Math.round(threshold * 100)}% confidence`}
          >
            {acceptingAll ? 'Accepting…' : `Accept all ≥ ${Math.round(threshold * 100)}%`}
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto p-2">
        {error && (
          <div className="mb-3 flex items-start justify-between gap-2 rounded p-2 text-xs" role="alert" style={{ border: '1px solid var(--danger)', color: 'var(--danger)' }}>
            <span>{error}</span>
            <button type="button" className="shrink-0 underline" onClick={() => void requestSuggestions()}>
              Retry
            </button>
          </div>
        )}
        {misfit && (
          <div
            className="mb-3 rounded p-2 text-xs"
            style={{ border: '1px dashed var(--border)', color: 'var(--fg-muted)' }}
          >
            <span style={{ color: 'var(--fg)' }}>May belong elsewhere.</span> This note looks like a
            misfit in <em>{misfit.currentFolder || '(vault root)'}</em> — it may fit{' '}
            <em>{misfit.suggestedFolder}</em>. {misfit.reason} (Observation only — nothing is moved.)
          </div>
        )}
        {running && (
          <p className="mb-3 text-sm" style={{ color: 'var(--fg-muted)' }}>
            Getting suggestions from {backendLabel(enrichBackend)}…
          </p>
        )}
        {suggestions.length === 0 && !running && (
          <div className="flex flex-col gap-2">
            <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
              {queueState === 'queued'
                ? 'Preparing suggestions for this note… the map will update when the pass finishes.'
                : queueState === 'parked'
                  ? `Suggestions are waiting for ${backendLabel(enrichBackend)}. Retry it when it is available.`
                  : aiProcessed
                    ? `The configured ${backendLabel(enrichBackend)} checked this note and found no actionable suggestions.`
                  : 'No suggestions yet. Press “Get suggestions” to ask the AI to read this note.'}
            </p>
            {appleAiHealth.status === 'unavailable' && enrichBackend === 'apple' && (
              <div className="flex flex-col items-start gap-2">
                <p className="text-xs" style={{ color: 'var(--danger)' }}>
                  {backendLabel(enrichBackend)} is unavailable right now. Your typed links, tags, and topic groups remain available.
                </p>
                <button
                  type="button"
                  className="rounded px-2 py-1 text-xs"
                  style={{ border: '1px solid var(--border)' }}
                  onClick={() => void refreshAppleAiStatus(true)}
                >
                  Retry {backendLabel(enrichBackend)}
                </button>
              </div>
            )}
          </div>
        )}
        <div className="flex flex-col gap-3">
          {KIND_ORDER.filter((k) => grouped.has(k)).map((kind) => (
            <div key={kind} className="flex flex-col gap-1.5">
              <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--fg-muted)' }}>
                {KIND_LABEL[kind]}
              </div>
              {grouped.get(kind)!.map((a) => (
                <SuggestionRow key={a.id} ann={a} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
