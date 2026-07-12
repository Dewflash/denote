// src/features/graph/TopicAnalysisPanel.tsx — the pass-9 "Analysis" slot for a topic node (D13).
// On demand, synthesizes over the topic's member-note SUMMARIES ordered by time: stance evolution,
// rising/fading themes, contradictions (citing specific note pairs), open questions. Framed as
// analysis of the USER'S OWN thinking (never market/predictive) and rendered with clickable links
// to the cited notes. Capped by the same monthly budget as everything cloud (S27).

import { useState } from 'react';
import { useVaultStore } from '../../state/vaultStore';
import { useUiStore } from '../../state/uiStore';
import type { TopicAnalysis } from '../../state/deepInsights';

export function TopicAnalysisPanel({
  vaultId,
  topicId,
  topicName,
  members,
}: {
  vaultId: string;
  topicId: string;
  topicName: string;
  members: { relPath: string; title: string }[];
}) {
  const keyPresent = useVaultStore((s) => s.anthropicKeyPresent);
  const analyze = useVaultStore((s) => s.analyzeTopic);
  const switchVault = useVaultStore((s) => s.switchVault);
  const setActiveNote = useVaultStore((s) => s.setActiveNote);
  const setGraphViewOpen = useUiStore((s) => s.setGraphViewOpen);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<TopicAnalysis | null>(null);

  const titleToRel = new Map(members.map((m) => [m.title.trim().toLowerCase(), m.relPath]));
  const openTitle = (title: string): void => {
    const rel = titleToRel.get(title.trim().toLowerCase());
    if (!rel) return;
    void (async () => {
      await switchVault(vaultId);
      await setActiveNote(rel);
      setGraphViewOpen(false);
    })();
  };

  const Cite = ({ title }: { title: string }) =>
    titleToRel.has(title.trim().toLowerCase()) ? (
      <button className="underline" style={{ color: 'var(--accent)' }} onClick={() => openTitle(title)}>
        {title}
      </button>
    ) : (
      <span>{title}</span>
    );

  const run = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      setResult(await analyze(vaultId, topicId, topicName));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded p-2" style={{ border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: 'var(--fg-muted)' }}>
          Analysis (cloud) — of your own notes
        </span>
        <button
          className="rounded px-2 py-0.5 text-xs"
          style={{ border: '1px solid var(--border)', opacity: keyPresent && members.length > 0 && !busy ? 1 : 0.5 }}
          disabled={!keyPresent || members.length === 0 || busy}
          onClick={() => void run()}
        >
          {busy ? 'Analyzing…' : result ? 'Re-run' : 'Run'}
        </button>
      </div>
      {!keyPresent && (
        <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
          Add an Anthropic key in Settings to enable.
        </span>
      )}
      {error && <span className="text-xs" style={{ color: 'var(--danger)' }}>{error}</span>}
      {result && (
        <div className="flex flex-col gap-2 text-xs" style={{ color: 'var(--fg)' }}>
          {result.stanceEvolution && (
            <div>
              <div className="font-medium" style={{ color: 'var(--fg-muted)' }}>How your thinking evolved</div>
              <p>{result.stanceEvolution}</p>
            </div>
          )}
          {result.risingThemes.length > 0 && (
            <div>
              <div className="font-medium" style={{ color: 'var(--fg-muted)' }}>Rising</div>
              <ul className="list-disc pl-4">{result.risingThemes.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          )}
          {result.fadingThemes.length > 0 && (
            <div>
              <div className="font-medium" style={{ color: 'var(--fg-muted)' }}>Fading</div>
              <ul className="list-disc pl-4">{result.fadingThemes.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          )}
          {result.contradictions.length > 0 && (
            <div>
              <div className="font-medium" style={{ color: 'var(--fg-muted)' }}>Tensions between notes</div>
              <ul className="flex flex-col gap-1 pl-1">
                {result.contradictions.map((c, i) => (
                  <li key={i}>
                    <Cite title={c.noteA} /> ↔ <Cite title={c.noteB} />: {c.note}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.openQuestions.length > 0 && (
            <div>
              <div className="font-medium" style={{ color: 'var(--fg-muted)' }}>Open questions your notes raise</div>
              <ul className="list-disc pl-4">{result.openQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
