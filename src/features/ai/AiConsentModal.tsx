// src/features/ai/AiConsentModal.tsx — first-run bulk takeover consent (S28/D35). Before the AI
// writes provisional `ai:` blocks into MORE than 20 notes in a vault, it pauses and asks once.
// The answer is a per-vault setting (persisted in the enrichment cache). Below the threshold,
// takeover proceeds silently; bulk demotion never asks (removing AI data is always safe).

import * as Dialog from '@radix-ui/react-dialog';
import { useVaultStore } from '../../state/vaultStore';

export function AiConsentModal() {
  const prompt = useVaultStore((s) => s.aiConsentPrompt);
  const resolve = useVaultStore((s) => s.resolveAiConsent);

  return (
    <Dialog.Root open={!!prompt} onOpenChange={(o) => !o && void resolve('ask')}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[460px] -translate-x-1/2 -translate-y-1/2 p-5"
          style={{
            backgroundColor: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
          }}
        >
          <Dialog.Title className="mb-2 text-base font-semibold">Let AI organize this vault?</Dialog.Title>
          <p className="mb-4 text-sm" style={{ color: 'var(--fg-muted)' }}>
            DeNote’s AI can annotate about <strong>{prompt?.count}</strong> uncategorized notes with
            provisional tags and links, stored in an <code>ai:</code> metadata block — reversible and
            clearly marked. It never edits your note text.
          </p>
          <div className="flex justify-end gap-2">
            <button
              className="rounded px-3 py-1.5 text-sm"
              style={{ color: 'var(--fg-muted)' }}
              onClick={() => void resolve('ask')}
            >
              Always ask
            </button>
            <button
              className="rounded px-3 py-1.5 text-sm"
              style={{ border: '1px solid var(--border)' }}
              onClick={() => void resolve('none')}
            >
              Keep suggestions only
            </button>
            <button
              className="rounded px-3 py-1.5 text-sm"
              style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
              onClick={() => void resolve('apply')}
            >
              Apply all
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
