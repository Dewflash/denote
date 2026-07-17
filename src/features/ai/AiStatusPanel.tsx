// src/features/ai/AiStatusPanel.tsx — the live R-1 diagnostic surface. Every value comes from
// the running sidecar, Rust embedding events, or the per-vault engines; no empty-state guess is
// presented as success.

import { useVaultStore } from '../../state/vaultStore';

function stateLabel(value: string): string {
  return value.replace(/-/g, ' ');
}

function statusColor(status: string): string {
  if (status === 'available' || status === 'ready' || status === 'done') return 'var(--accent)';
  if (status === 'error' || status === 'unavailable' || status === 'parked') return 'var(--danger)';
  return 'var(--fg-muted)';
}

function gateLabel(gate: string): string {
  switch (gate) {
    case 'accepted': return 'linked';
    case 'cosine-floor': return 'rejected: cosine floor';
    case 'vacuity': return 'rejected: vacuity gate';
    case 'llm-unrelated': return 'rejected: AI said unrelated';
    case 'llm-refusal': return 'rejected: AI refused';
    default: return 'waiting for AI label';
  }
}

export function AiStatusPanel({ onClose }: { onClose: () => void }) {
  const revision = useVaultStore((s) => s.revision);
  const apple = useVaultStore((s) => s.appleAiHealth);
  const embeddingModel = useVaultStore((s) => s.embeddingModelHealth);
  const retry = useVaultStore((s) => s.retryAiVault);
  const retryApple = useVaultStore((s) => s.refreshAppleAiStatus);
  void revision;

  const vaults = useVaultStore.getState().aiVaultStatuses();
  const note = useVaultStore.getState().activeNoteAiStatus();

  const parked = vaults.flatMap((vault) => vault.queue.jobs
    .filter((job) => job.state === 'parked')
    .map((job) => ({ ...job, vaultId: vault.vaultId, vaultName: vault.name })));

  return (
    <div
      id="status-ai-panel"
      role="dialog"
      aria-label="AI status"
      className="absolute bottom-7 right-0 z-40 flex max-h-[min(78vh,680px)] w-[min(510px,calc(100vw-24px))] flex-col gap-3 overflow-auto rounded p-3 text-xs shadow-lg"
      style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--fg)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <strong className="text-sm">AI status</strong>
          <div style={{ color: 'var(--fg-muted)' }}>Live reasons for queued, missing, and rejected links.</div>
        </div>
        <button type="button" aria-label="Close AI status" onClick={onClose} style={{ color: 'var(--fg-muted)' }}>×</button>
      </div>

      <section className="flex flex-col gap-1.5">
        <div className="font-medium">Apple sidecar</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1" style={{ color: 'var(--fg-muted)' }}>
          <span>spawned: <strong style={{ color: apple.spawned === true ? 'var(--accent)' : apple.spawned === false ? 'var(--danger)' : 'var(--fg-muted)' }}>{apple.spawned === undefined ? 'unknown' : apple.spawned ? 'yes' : 'no'}</strong></span>
          <span>capabilities: <strong style={{ color: statusColor(apple.status) }}>{stateLabel(apple.status)}</strong></span>
          {apple.modelVersion && <span>model: <strong style={{ color: 'var(--fg)' }}>{apple.modelVersion}</strong></span>}
        </div>
        {apple.reason && <div className="break-words" style={{ color: 'var(--danger)' }}>{apple.reason}</div>}
        <button
          type="button"
          className="self-start rounded px-2 py-1"
          style={{ border: '1px solid var(--border)' }}
          onClick={() => void retryApple(true)}
        >
          Retry Apple status
        </button>
      </section>

      <section className="flex flex-col gap-1.5">
        <div className="font-medium">Embedding model</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1" style={{ color: 'var(--fg-muted)' }}>
          <span>state: <strong style={{ color: statusColor(embeddingModel.status) }}>{stateLabel(embeddingModel.status)}</strong></span>
          <span>model: <strong style={{ color: 'var(--fg)' }}>{embeddingModel.modelId}</strong></span>
          {embeddingModel.status === 'downloading' && <strong style={{ color: 'var(--fg)' }}>{embeddingModel.percent ?? 0}%</strong>}
        </div>
        {embeddingModel.file && <div className="truncate" title={embeddingModel.file} style={{ color: 'var(--fg-muted)' }}>file: {embeddingModel.file}</div>}
        {embeddingModel.status === 'downloading' && (
          <div aria-label={`Embedding model download ${embeddingModel.percent ?? 0}%`} style={{ height: 5, borderRadius: 999, backgroundColor: 'var(--border)' }}>
            <div style={{ width: `${Math.max(0, Math.min(100, embeddingModel.percent ?? 0))}%`, height: 5, borderRadius: 999, backgroundColor: 'var(--accent)' }} />
          </div>
        )}
        {embeddingModel.detail && <div className="break-words" style={{ color: 'var(--danger)' }}>{embeddingModel.detail}</div>}
      </section>

      <section className="flex flex-col gap-2">
        <div className="font-medium">Enrichment queue</div>
        {vaults.length === 0 ? (
          <div style={{ color: 'var(--fg-muted)' }}>Open a vault to see its queue.</div>
        ) : vaults.map((vault) => (
          <div key={vault.vaultId} className="flex flex-col gap-1 rounded p-2" style={{ border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between gap-2">
              <strong className="truncate" title={vault.name}>{vault.name}</strong>
              <button type="button" className="rounded px-1.5 py-0.5" style={{ border: '1px solid var(--border)' }} onClick={() => retry(vault.vaultId)}>Retry vault</button>
            </div>
            <div style={{ color: 'var(--fg-muted)' }}>
              pending {vault.queue.counts.pending} · running {vault.queue.counts.running} · parked {vault.queue.counts.parked}
            </div>
            <div style={{ color: 'var(--fg-muted)' }}>
              embeddings: {stateLabel(vault.embedding.state)}{vault.embedding.total > 0 ? ` (${vault.embedding.done}/${vault.embedding.total})` : ''}
            </div>
            {vault.embedding.error && <div className="break-words" style={{ color: 'var(--danger)' }}>{vault.embedding.error}</div>}
          </div>
        ))}
        {parked.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="font-medium" style={{ color: 'var(--danger)' }}>Parked jobs</div>
            {parked.map((job) => (
              <div key={`${job.vaultId}:${job.relPath}`} className="rounded p-2" style={{ border: '1px dashed var(--danger)' }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate" title={`${job.vaultName} · ${job.relPath}`}>{job.vaultName} · {job.relPath}</span>
                  <button type="button" className="shrink-0 underline" onClick={() => retry(job.vaultId)}>Retry</button>
                </div>
                <div className="mt-1 break-words" style={{ color: 'var(--danger)' }}>{job.lastError ?? 'No error text was recorded.'}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="font-medium">Why isn&apos;t this note linked?</div>
        {!note ? (
          <div style={{ color: 'var(--fg-muted)' }}>Open a note to inspect its enrichment hash, embedding, and similarity gates.</div>
        ) : (
          <div className="flex flex-col gap-2">
            <div><strong>{note.title}</strong> <span style={{ color: 'var(--fg-muted)' }}>({note.relPath})</span></div>
            <div style={{ color: statusColor(note.enrichment.enrichmentState) }}>
              enrichment: {note.enrichment.enrichmentState === 'done'
                ? `done: ${note.enrichment.suggestionCount} suggestions, ${note.enrichment.belowThresholdCount} below threshold`
                : note.enrichment.enrichmentState === 'parked'
                  ? `parked + error: ${note.enrichment.error ?? 'no error recorded'}`
                  : stateLabel(note.enrichment.enrichmentState)}
              {note.enrichment.hashGated && <span style={{ color: 'var(--fg-muted)' }}> · current hash is gated</span>}
            </div>
            <div style={{ color: 'var(--fg-muted)' }}>embedding: <strong style={{ color: statusColor(note.embedding) }}>{stateLabel(note.embedding)}</strong></div>
            <div className="flex flex-col gap-1">
              <div>similarity candidates found: <strong>{note.similarity.length}</strong></div>
              {note.similarity.length === 0 ? (
                <div style={{ color: 'var(--fg-muted)' }}>No similarity candidates have been checked for this hash yet.</div>
              ) : note.similarity.map((candidate) => (
                <div key={candidate.relPath} className="flex items-start justify-between gap-2 rounded px-1.5 py-1" style={{ backgroundColor: 'var(--bg-panel)' }}>
                  <span className="min-w-0 truncate" title={candidate.relPath}>{candidate.relPath}</span>
                  <span className="shrink-0" style={{ color: statusColor(candidate.gate) }}>
                    {Math.round(candidate.cosine * 100)}% · {gateLabel(candidate.gate)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
