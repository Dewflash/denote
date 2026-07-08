// src/app/VaultRail.tsx — far-left vault rail: icon per vault, one-click switch. Single vault
// open at a time this pass (brief); "recentVaults" (an MRU list) is the stand-in for the real
// cross-vault registry (D17, pass 05) — see vaultStore.ts's header comment.

import { useVaultStore } from '../state/vaultStore';
import { pickFolder } from '../services/dialogs';

function vaultLabel(path: string): string {
  const name = path.split('/').filter(Boolean).pop() ?? path;
  return name.slice(0, 2).toUpperCase();
}

export function VaultRail() {
  const root = useVaultStore((s) => s.root);
  const recentVaults = useVaultStore((s) => s.recentVaults);
  const openVaultAt = useVaultStore((s) => s.openVaultAt);
  const createVaultAt = useVaultStore((s) => s.createVaultAt);

  return (
    <div
      className="flex h-full flex-col items-center gap-2 py-3"
      style={{ backgroundColor: 'var(--bg-panel)', borderRight: '1px solid var(--border)' }}
    >
      {recentVaults.map((path) => (
        <button
          key={path}
          title={path}
          onClick={() => void openVaultAt(path)}
          className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold"
          style={{
            backgroundColor: path === root ? 'var(--accent)' : 'var(--bg)',
            color: path === root ? '#fff' : 'var(--fg)',
            border: '1px solid var(--border)',
          }}
        >
          {vaultLabel(path)}
        </button>
      ))}
      <button
        title="Open or create a vault"
        onClick={() =>
          void pickFolder('Open or create a vault').then((p) => {
            if (p) void openVaultAt(p);
          })
        }
        onDoubleClick={() =>
          void pickFolder('Create a new vault').then((p) => {
            if (p) void createVaultAt(p);
          })
        }
        className="flex h-9 w-9 items-center justify-center rounded-full text-lg"
        style={{ color: 'var(--fg-muted)', border: '1px dashed var(--border)' }}
      >
        +
      </button>
    </div>
  );
}
