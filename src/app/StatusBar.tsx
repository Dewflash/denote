// src/app/StatusBar.tsx — word count of the open note + the active vault's name (pass-05: with
// its registered accent color dot, the "headers" surface named alongside rail + hulls in the
// brief's "per-vault accent color used on rail + hulls + headers").

import { useMemo } from 'react';
import { useVaultStore } from '../state/vaultStore';

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

export function StatusBar() {
  const root = useVaultStore((s) => s.root);
  const vaultId = useVaultStore((s) => s.vaultId);
  const registry = useVaultStore((s) => s.registry);
  const buffer = useVaultStore((s) => s.buffer);

  const words = useMemo(() => (buffer ? wordCount(buffer.content) : 0), [buffer]);
  const activeEntry = registry.find((v) => v.id === vaultId);
  const vaultName = activeEntry?.name ?? root?.split('/').filter(Boolean).pop() ?? 'No vault';

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
      <span className="flex items-center gap-1.5">
        {activeEntry && (
          <span
            aria-hidden
            style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: activeEntry.color }}
          />
        )}
        {vaultName}
      </span>
      {buffer && <span>{words} words</span>}
    </div>
  );
}
