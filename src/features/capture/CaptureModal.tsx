// src/features/capture/CaptureModal.tsx — the paste-summarize review (pass 7, D27 partial). A
// large paste (≥800 chars) opens this instead of filing blind: on-device summarize + enrich
// suggest a title, a one-line summary, and tags, all editable, before the note is created. The
// model-picker label shows the current routing default (Settings → AI changes it). Fully offline.

import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useUiStore, type CaptureDraft } from '../../state/uiStore';
import { useVaultStore } from '../../state/vaultStore';
import { fileCapture } from './pasteCapture';

/** Gate: only mounted while a capture is pending, keyed on the text so each paste gets a fresh
 *  component (state seeds from the text synchronously, no setState-in-effect). */
export function CaptureModal() {
  const draft = useUiStore((s) => s.captureDraft);
  if (draft == null) return null;
  return <CaptureReview key={`${draft.capturedAt}:${draft.text}`} draft={draft} />;
}

function seedTitle(text: string): string {
  return text.split(/\r?\n/, 1)[0]?.trim().slice(0, 80) || 'Untitled';
}

function displayBackend(id: string): string {
  if (id === 'anthropic') return 'Cloud: Anthropic';
  if (id === 'apple') return 'On this Mac: Apple';
  if (id === 'mock') return 'Test backend: deterministic preview';
  return id;
}

function CaptureReview({ draft }: { draft: CaptureDraft }) {
  const text = draft.text;
  const closeCapture = useUiStore((s) => s.closeCapture);
  const suggestForCapture = useVaultStore((s) => s.suggestForCapture);
  const routingBackendFor = useVaultStore((s) => s.routingBackendFor);
  const registry = useVaultStore((s) => s.registry);
  const activeVaultId = useVaultStore((s) => s.vaultId);

  const [title, setTitle] = useState(() => seedTitle(text));
  const [summary, setSummary] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [enabledTags, setEnabledTags] = useState<Set<string>>(() => new Set());
  const [folder, setFolder] = useState(() => localStorage.getItem('denote:captureFolder') ?? 'Inbox');
  const [vaultId, setVaultId] = useState(activeVaultId ?? registry[0]?.id ?? '');
  const [loading, setLoading] = useState(true);

  const backend = routingBackendFor('summarize');
  const preview = text.slice(0, 600);

  useEffect(() => {
    void getCurrentWindow().setAlwaysOnTop(true).catch(() => {});
    return () => { void getCurrentWindow().setAlwaysOnTop(false).catch(() => {}); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void suggestForCapture(text).then((s) => {
      if (cancelled) return;
      if (s.title) setTitle(s.title);
      setSummary(s.summary);
      setTags(s.tags);
      setEnabledTags(new Set(s.tags));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [text, suggestForCapture]);

  function toggleTag(t: string): void {
    setEnabledTags((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  async function create(): Promise<void> {
    await fileCapture({
      title,
      body: text,
      summary: summary || undefined,
      tags: tags.filter((t) => enabledTags.has(t)),
      folder,
      sourceUrl: draft.sourceUrl,
      sourceApp: draft.sourceApp,
      sourceTitle: draft.sourceTitle,
      capturedAt: draft.capturedAt,
      vaultId: vaultId || undefined,
    });
    localStorage.setItem('denote:captureFolder', folder.trim() || 'Inbox');
    closeCapture();
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && closeCapture()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-24px)] w-[540px] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 overflow-auto p-5"
          style={{
            backgroundColor: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
          }}
        >
          <form onSubmit={(event) => { event.preventDefault(); void create(); }}>
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold">Capture note</Dialog.Title>
            <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
              {loading ? 'Analyzing on-device…' : `Suggested by ${displayBackend(backend)}`}
            </span>
          </div>

          <label className="mb-1 block text-xs" style={{ color: 'var(--fg-muted)' }}>Vault</label>
          <select
            className="mb-3 w-full rounded px-2 py-1.5 text-sm"
            style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg-panel)' }}
            value={vaultId}
            onChange={(event) => setVaultId(event.target.value)}
          >
            {registry.map((vault) => <option key={vault.id} value={vault.id}>{vault.name}{vault.localOnly ? ' · local only' : ''}</option>)}
          </select>

          <label className="mb-1 block text-xs" style={{ color: 'var(--fg-muted)' }}>
            Title
          </label>
          <input
            className="mb-3 w-full rounded px-2 py-1.5 text-sm"
            style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg-panel)' }}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <label className="mb-1 block text-xs" style={{ color: 'var(--fg-muted)' }}>
            Folder
          </label>
          <input
            className="mb-3 w-full rounded px-2 py-1.5 text-sm"
            style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg-panel)' }}
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          />

          <label className="mb-1 block text-xs" style={{ color: 'var(--fg-muted)' }}>
            Summary
          </label>
          <textarea
            className="mb-3 w-full rounded px-2 py-1.5 text-sm"
            style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg-panel)' }}
            rows={2}
            value={summary}
            placeholder={loading ? 'Summarizing…' : 'No summary'}
            onChange={(e) => setSummary(e.target.value)}
          />

          {tags.length > 0 && (
            <div className="mb-3">
              <div className="mb-1 text-xs" style={{ color: 'var(--fg-muted)' }}>
                Tags
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => {
                  const on = enabledTags.has(t);
                  return (
                    <button
                      type="button"
                      key={t}
                      onClick={() => toggleTag(t)}
                      className="rounded-full px-2 py-0.5 text-xs"
                      style={{
                        border: '1px solid var(--border)',
                        backgroundColor: on ? 'var(--accent)' : 'transparent',
                        color: on ? '#fff' : 'var(--fg-muted)',
                      }}
                    >
                      #{t}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div
            className="mb-4 max-h-32 overflow-auto rounded px-2 py-1.5 text-xs"
            style={{ backgroundColor: 'var(--bg-panel)', color: 'var(--fg-muted)', whiteSpace: 'pre-wrap' }}
          >
            {preview}
            {text.length > preview.length ? '…' : ''}
          </div>

          {(draft.sourceApp || draft.sourceUrl || draft.warning) && (
            <div className="mb-4 truncate text-xs" style={{ color: 'var(--fg-muted)' }}>
              {draft.sourceApp ? `Source: ${draft.sourceApp}` : 'Source captured'}
              {draft.sourceUrl ? ` · ${draft.sourceUrl}` : ''}
              {draft.warning ? ` · ${draft.warning}` : ''}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded px-3 py-1.5 text-sm"
              style={{ color: 'var(--fg-muted)' }}
              onClick={() => closeCapture()}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded px-3 py-1.5 text-sm"
              style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
            >
              Create note
            </button>
          </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
