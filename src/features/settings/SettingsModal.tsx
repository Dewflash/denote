// src/features/settings/SettingsModal.tsx — Settings sections skeleton (pass-03 brief):
// Vaults, Editor, Appearance (functional), AI & Models, Graph, Hotkeys, Data. Vaults (pass-05)
// and Appearance do real work; everything else is a stub that later passes fill in, so the
// section structure never needs to be reshuffled.

import * as Dialog from '@radix-ui/react-dialog';
import { useMemo, useState } from 'react';
import { useUiStore, type ThemeMode } from '../../state/uiStore';
import { useVaultStore } from '../../state/vaultStore';
import { pickFolder } from '../../services/dialogs';
import { appKeymap } from '../../app/keymap';
import { VAULT_COLOR_PALETTE } from '../../services/vaultRegistry';

const ACCENT_PRESETS = ['#3b6fd6', '#6f9bef', '#d6763b', '#3bd6a0', '#a03bd6', '#d63b6f'];

type Section = 'vaults' | 'editor' | 'appearance' | 'ai' | 'graph' | 'hotkeys' | 'data';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'vaults', label: 'Vaults' },
  { id: 'editor', label: 'Editor' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'ai', label: 'AI & Models' },
  { id: 'graph', label: 'Graph' },
  { id: 'hotkeys', label: 'Hotkeys' },
  { id: 'data', label: 'Data' },
];

function Stub({ text }: { text: string }) {
  return <p style={{ color: 'var(--fg-muted)' }}>{text}</p>;
}

function RelocateRow({ vaultId, expectedPath }: { vaultId: string; expectedPath: string }) {
  const registry = useVaultStore((s) => s.registry);
  const relocateVault = useVaultStore((s) => s.relocateVault);
  const clearRelocateError = useVaultStore((s) => s.clearRelocateError);
  const name = registry.find((v) => v.id === vaultId)?.name ?? vaultId;

  return (
    <div
      className="flex flex-col gap-2 rounded p-2 text-sm"
      style={{ border: '1px solid #c0392b' }}
    >
      <div>
        Couldn&apos;t open <strong>{name}</strong> at <code>{expectedPath}</code>. Did you move
        it?
      </div>
      <div className="flex gap-2">
        <button
          className="rounded px-2 py-1 text-xs"
          style={{ border: '1px solid var(--border)' }}
          onClick={() =>
            void pickFolder(`Locate "${name}"`).then((p) => {
              if (p) void relocateVault(vaultId, p);
            })
          }
        >
          Locate...
        </button>
        <button className="text-xs" style={{ color: 'var(--fg-muted)' }} onClick={clearRelocateError}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

function VaultRow({ id, name, path, color, localOnly }: { id: string; name: string; path: string; color: string; localOnly: boolean }) {
  const vaultId = useVaultStore((s) => s.vaultId);
  const openVaultIds = useVaultStore((s) => s.openVaultIds);
  const switchVault = useVaultStore((s) => s.switchVault);
  const closeVault = useVaultStore((s) => s.closeVault);
  const removeVaultFromRegistry = useVaultStore((s) => s.removeVaultFromRegistry);
  const setVaultColor = useVaultStore((s) => s.setVaultColor);
  const setVaultLocalOnly = useVaultStore((s) => s.setVaultLocalOnly);
  const isActive = id === vaultId;
  const isOpen = openVaultIds.includes(id);

  return (
    <div className="flex flex-col gap-1.5 rounded p-2" style={{ border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between gap-2">
        <button
          className="flex min-w-0 items-center gap-2 text-left text-sm"
          onClick={() => void switchVault(id)}
        >
          <span
            aria-hidden
            style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: color, flexShrink: 0 }}
          />
          <span className="truncate font-medium">{name}</span>
          {isActive && <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>(active)</span>}
        </button>
        <div className="flex shrink-0 items-center gap-2 text-xs" style={{ color: 'var(--fg-muted)' }}>
          {isOpen && !isActive && (
            <button onClick={() => void closeVault(id)} title="Stop watching (stays registered)">
              Close
            </button>
          )}
          <button onClick={() => void removeVaultFromRegistry(id)} title="Remove from registry (files are untouched)">
            Remove
          </button>
        </div>
      </div>
      <div className="truncate text-xs" style={{ color: 'var(--fg-muted)' }}>
        {path}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          {VAULT_COLOR_PALETTE.map((c) => (
            <button
              key={c}
              aria-label={c}
              className="h-4 w-4 rounded-full"
              style={{ backgroundColor: c, outline: color === c ? '2px solid var(--fg)' : 'none' }}
              onClick={() => void setVaultColor(id, c)}
            />
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--fg-muted)' }}>
          <input
            type="checkbox"
            checked={localOnly}
            onChange={(e) => void setVaultLocalOnly(id, e.target.checked)}
          />
          Local only (never sent to a cloud AI backend)
        </label>
      </div>
    </div>
  );
}

function VaultsSection() {
  const registry = useVaultStore((s) => s.registry);
  const openVaultAt = useVaultStore((s) => s.openVaultAt);
  const createVaultAt = useVaultStore((s) => s.createVaultAt);
  const relocateError = useVaultStore((s) => s.relocateError);
  const error = useVaultStore((s) => s.error);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <button
          className="rounded px-3 py-1.5 text-sm"
          style={{ border: '1px solid var(--border)' }}
          onClick={() =>
            void pickFolder('Open vault').then((p) => {
              if (p) void openVaultAt(p);
            })
          }
        >
          Open vault...
        </button>
        <button
          className="rounded px-3 py-1.5 text-sm"
          style={{ border: '1px solid var(--border)' }}
          onClick={() =>
            void pickFolder('Create vault').then((p) => {
              if (p) void createVaultAt(p);
            })
          }
        >
          Create vault...
        </button>
      </div>

      {relocateError && <RelocateRow vaultId={relocateError.vaultId} expectedPath={relocateError.expectedPath} />}
      {error && !relocateError && (
        <p className="text-xs" style={{ color: '#c0392b' }}>
          {error}
        </p>
      )}

      <div>
        <div className="mb-1 text-xs uppercase" style={{ color: 'var(--fg-muted)' }}>
          Registered vaults
        </div>
        {registry.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
            No vaults registered yet.
          </p>
        )}
        <div className="flex flex-col gap-2">
          {registry.map((v) => (
            <VaultRow key={v.id} {...v} />
          ))}
        </div>
      </div>
    </div>
  );
}

function AppearanceSection() {
  const theme = useUiStore((s) => s.theme);
  const accent = useUiStore((s) => s.accent);
  const setTheme = useUiStore((s) => s.setTheme);
  const setAccent = useUiStore((s) => s.setAccent);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-1 text-xs uppercase" style={{ color: 'var(--fg-muted)' }}>
          Theme
        </div>
        <div className="flex gap-2">
          {(['light', 'dark', 'system'] as ThemeMode[]).map((mode) => (
            <button
              key={mode}
              className="rounded px-3 py-1.5 text-sm capitalize"
              style={{
                border: '1px solid var(--border)',
                backgroundColor: theme === mode ? 'var(--bg-panel)' : 'transparent',
              }}
              onClick={() => setTheme(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs uppercase" style={{ color: 'var(--fg-muted)' }}>
          Accent color
        </div>
        <div className="flex items-center gap-2">
          {ACCENT_PRESETS.map((c) => (
            <button
              key={c}
              aria-label={c}
              className="h-6 w-6 rounded-full"
              style={{ backgroundColor: c, outline: accent === c ? '2px solid var(--fg)' : 'none' }}
              onClick={() => setAccent(c)}
            />
          ))}
          <input
            type="color"
            value={accent ?? '#3b6fd6'}
            onChange={(e) => setAccent(e.target.value)}
            className="h-6 w-6"
          />
          <button className="text-xs" style={{ color: 'var(--fg-muted)' }} onClick={() => setAccent(null)}>
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

const AI_TASKS: { id: string; label: string }[] = [
  { id: 'summarize', label: 'Summarize' },
  { id: 'enrich', label: 'Enrich note' },
  { id: 'label-similarity', label: 'Label similarity' },
  { id: 'deep-organize', label: 'Deep organize (vault)' },
];

const AI_BACKENDS: { id: string; label: string; enabled: boolean; note?: string }[] = [
  { id: 'mock', label: 'Mock', enabled: true },
  { id: 'apple', label: 'Apple (on-device)', enabled: true },
  { id: 'anthropic', label: 'Anthropic (cloud)', enabled: false, note: 'pass 9' },
];

function AiSection() {
  const threshold = useUiStore((s) => s.aiTakeoverThreshold);
  const setThreshold = useUiStore((s) => s.setAiTakeoverThreshold);
  const topK = useUiStore((s) => s.similarityTopK);
  const setTopK = useUiStore((s) => s.setSimilarityTopK);
  const minCos = useUiStore((s) => s.similarityMinCos);
  const setMinCos = useUiStore((s) => s.setSimilarityMinCos);
  const registry = useVaultStore((s) => s.registry);
  const setVaultLocalOnly = useVaultStore((s) => s.setVaultLocalOnly);
  // `revision` bumps when routing changes, re-rendering the selects with the live table.
  const revision = useVaultStore((s) => s.revision);
  const setTaskRouting = useVaultStore((s) => s.setTaskRouting);
  const routing = useMemo(() => {
    void revision; // recompute when routing changes (revision bumps)
    return useVaultStore.getState().aiRoutingTable();
  }, [revision]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="mb-1 text-xs uppercase" style={{ color: 'var(--fg-muted)' }}>
          Task routing
        </div>
        <p className="mb-2 text-xs" style={{ color: 'var(--fg-muted)' }}>
          Each task runs on a backend. Apple runs on-device (free, offline); the Anthropic cloud
          tier arrives in pass 9. The Mock backend stays available for testing.
        </p>
        <div className="flex flex-col gap-1.5">
          {AI_TASKS.map((t) => (
            <div key={t.id} className="flex items-center justify-between text-sm">
              <span>{t.label}</span>
              <select
                value={routing[t.id] ?? 'mock'}
                onChange={(e) => setTaskRouting(t.id, e.target.value)}
                className="rounded px-2 py-1 text-sm"
                style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg)', color: 'var(--fg)' }}
              >
                {AI_BACKENDS.map((b) => (
                  <option key={b.id} value={b.id} disabled={!b.enabled}>
                    {b.label}
                    {b.note ? ` (${b.note})` : ''}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs uppercase" style={{ color: 'var(--fg-muted)' }}>
          Similarity (ai-similar edges)
        </div>
        <p className="mb-2 text-xs" style={{ color: 'var(--fg-muted)' }}>
          Embeddings propose up to <strong>{topK}</strong> neighbors per note above cosine{' '}
          <strong>{minCos.toFixed(2)}</strong>; the on-device model must then name a specific shared
          concept before an edge is drawn (D6a).
        </p>
        <div className="flex items-center gap-3">
          <span className="w-24 text-xs" style={{ color: 'var(--fg-muted)' }}>Top-K neighbors</span>
          <input type="range" min={1} max={10} step={1} value={topK} onChange={(e) => setTopK(Number(e.target.value))} className="flex-1" />
          <span className="w-8 text-right text-sm tabular-nums">{topK}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-3">
          <span className="w-24 text-xs" style={{ color: 'var(--fg-muted)' }}>Min cosine</span>
          <input type="range" min={0.4} max={0.9} step={0.02} value={minCos} onChange={(e) => setMinCos(Number(e.target.value))} className="flex-1" />
          <span className="w-8 text-right text-sm tabular-nums">{minCos.toFixed(2)}</span>
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs uppercase" style={{ color: 'var(--fg-muted)' }}>
          Takeover threshold
        </div>
        <p className="mb-2 text-xs" style={{ color: 'var(--fg-muted)' }}>
          A note with no tags or links of your own gets AI structure auto-applied (as reversible
          provisional metadata) only for suggestions at or above this confidence.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0.4}
            max={0.95}
            step={0.05}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="flex-1"
          />
          <span className="w-10 text-right text-sm tabular-nums">{Math.round(threshold * 100)}%</span>
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs uppercase" style={{ color: 'var(--fg-muted)' }}>
          Privacy (per vault)
        </div>
        <p className="mb-2 text-xs" style={{ color: 'var(--fg-muted)' }}>
          A local-only vault’s content can never reach a cloud AI backend (enforced in the router,
          D18).
        </p>
        {registry.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
            No vaults registered yet.
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          {registry.map((v) => (
            <label key={v.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={v.localOnly}
                onChange={(e) => void setVaultLocalOnly(v.id, e.target.checked)}
              />
              <span
                aria-hidden
                style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: v.color, flexShrink: 0 }}
              />
              <span className="truncate">{v.name}</span>
              <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                local only
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function HotkeysSection() {
  return (
    <div className="flex flex-col gap-1 text-sm">
      {appKeymap.all().map((b) => (
        <div key={b.id} className="flex items-center justify-between">
          <span>{b.description}</span>
          <code
            className="rounded px-2 py-0.5"
            style={{ backgroundColor: 'var(--bg-panel)', fontFamily: 'var(--font-editor)' }}
          >
            {b.combo}
          </code>
        </div>
      ))}
    </div>
  );
}

export function SettingsModal() {
  const open = useUiStore((s) => s.settingsOpen);
  const setOpen = useUiStore((s) => s.setSettingsOpen);
  const [section, setSection] = useState<Section>('appearance');

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex h-[520px] w-[720px] -translate-x-1/2 -translate-y-1/2"
          style={{
            backgroundColor: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
          }}
        >
          <Dialog.Title className="sr-only">Settings</Dialog.Title>
          <nav
            className="flex w-40 shrink-0 flex-col gap-0.5 p-2"
            style={{ borderRight: '1px solid var(--border)' }}
          >
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className="rounded px-2 py-1.5 text-left text-sm"
                style={{ backgroundColor: section === s.id ? 'var(--bg-panel)' : 'transparent' }}
                onClick={() => setSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>
          <div className="flex-1 overflow-auto p-4">
            {section === 'vaults' && <VaultsSection />}
            {section === 'editor' && <Stub text="Editor settings arrive alongside their features." />}
            {section === 'appearance' && <AppearanceSection />}
            {section === 'ai' && <AiSection />}
            {section === 'graph' && <Stub text="Graph settings arrive in pass 04." />}
            {section === 'hotkeys' && <HotkeysSection />}
            {section === 'data' && <Stub text="Data management (snapshots, export, migrations) arrives in later passes." />}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
