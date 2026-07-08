// src/app/StatusBar.tsx — word count of the open note + vault name.

import { useMemo } from 'react';
import { useVaultStore } from '../state/vaultStore';

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

export function StatusBar() {
  const root = useVaultStore((s) => s.root);
  const buffer = useVaultStore((s) => s.buffer);

  const words = useMemo(() => (buffer ? wordCount(buffer.content) : 0), [buffer]);
  const vaultName = root?.split('/').filter(Boolean).pop() ?? 'No vault';

  return (
    <div
      className="flex items-center justify-between px-3 text-xs"
      style={{
        height: 24,
        borderTop: '1px solid var(--border)',
        color: 'var(--fg-muted)',
        backgroundColor: 'var(--bg-panel)',
      }}
    >
      <span>{vaultName}</span>
      {buffer && <span>{words} words</span>}
    </div>
  );
}
