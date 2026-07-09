// src/app/VaultRail.tsx — far-left vault rail: one icon per REGISTERED vault (D17's real
// `vaults.json` registry, not the pass-03 localStorage MRU stand-in), one-click switch (instant
// if already open), per-vault accent color, add-vault flow (folder picker → bootstrap or adopt
// existing `.denote/`, pass-05 brief). A small dot marks vaults that are currently open (have a
// live Repository + watcher) vs merely registered.

import { useVaultStore } from '../state/vaultStore';
import { pickFolder } from '../services/dialogs';

function vaultInitials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

export function VaultRail() {
  const vaultId = useVaultStore((s) => s.vaultId);
  const registry = useVaultStore((s) => s.registry);
  const openVaultIds = useVaultStore((s) => s.openVaultIds);
  const switchVault = useVaultStore((s) => s.switchVault);
  const openVaultAt = useVaultStore((s) => s.openVaultAt);
  const createVaultAt = useVaultStore((s) => s.createVaultAt);
  const closeVault = useVaultStore((s) => s.closeVault);

  return (
    <div
      className="flex h-full flex-col items-center gap-2 py-3"
      style={{ backgroundColor: 'var(--bg-panel)', borderRight: '1px solid var(--border)' }}
    >
      {registry.map((v) => {
        const isActive = v.id === vaultId;
        const isOpen = openVaultIds.includes(v.id);
        return (
          <div key={v.id} className="group relative">
            <button
              title={`${v.name}${v.localOnly ? ' (local only)' : ''}\n${v.path}`}
              onClick={() => void switchVault(v.id)}
              className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold"
              style={{
                backgroundColor: v.color,
                color: '#fff',
                outline: isActive ? '2px solid var(--fg)' : 'none',
                outlineOffset: 1,
                opacity: isOpen ? 1 : 0.55,
              }}
            >
              {vaultInitials(v.name)}
            </button>
            {isOpen && !isActive && (
              <button
                title={`Close ${v.name} (stop watching, keep registered)`}
                onClick={(e) => {
                  e.stopPropagation();
                  void closeVault(v.id);
                }}
                className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full text-[10px] group-hover:flex"
                style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--fg-muted)' }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
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
