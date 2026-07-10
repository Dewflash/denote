// src/features/capture/CaptureModal.tsx — the paste-summarize review (pass 7, D27 partial). A
// large paste (≥800 chars) opens this instead of filing blind: on-device summarize + enrich
// suggest a title, a one-line summary, and tags, all editable, before the note is created. The
// model-picker label shows the current routing default (Settings → AI changes it). Fully offline.

import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useUiStore } from '../../state/uiStore';
import { useVaultStore } from '../../state/vaultStore';
import { fileCapture } from './pasteCapture';

/** Gate: only mounted while a capture is pending, keyed on the text so each paste gets a fresh
 *  component (state seeds from the text synchronously, no setState-in-effect). */
export function CaptureModal() {
  const text = useUiStore((s) => s.captureText);
  if (text == null) return null;
  return <CaptureReview key={text} text={text} />;
}

function seedTitle(text: string): string {
  return text.split(/\r?\n/, 1)[0]?.trim().slice(0, 80) || 'Untitled';
}

function CaptureReview({ text }: { text: string }) {
  const closeCapture = useUiStore((s) => s.closeCapture);
  const suggestForCapture = useVaultStore((s) => s.suggestForCapture);
  const routingBackendFor = useVaultStore((s) => s.routingBackendFor);

  const [title, setTitle] = useState(() => seedTitle(text));
  const [summary, setSummary] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [enabledTags, setEnabledTags] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);

  const backend = routingBackendFor('summarize');
  const preview = text.slice(0, 600);

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
    });
    closeCapture();
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && closeCapture()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[540px] -translate-x-1/2 -translate-y-1/2 p-5"
          style={{
            backgroundColor: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
          }}
        >
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold">Capture note</Dialog.Title>
            <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
              {loading ? 'Analyzing on-device…' : `Suggested by ${backend}`}
            </span>
          </div>

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

          <div className="flex justify-end gap-2">
            <button
              className="rounded px-3 py-1.5 text-sm"
              style={{ color: 'var(--fg-muted)' }}
              onClick={() => closeCapture()}
            >
              Cancel
            </button>
            <button
              className="rounded px-3 py-1.5 text-sm"
              style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
              onClick={() => void create()}
            >
              Create note
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
