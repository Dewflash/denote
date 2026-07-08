// src/features/settings/SettingsModal.tsx — Settings sections skeleton (pass-03 brief):
// Vaults, Editor, Appearance (functional), AI & Models, Graph, Hotkeys, Data. Only Appearance
// does real work this pass; everything else is a stub that later passes fill in, so the
// section structure never needs to be reshuffled.

import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { useUiStore, type ThemeMode } from '../../state/uiStore';
import { useVaultStore } from '../../state/vaultStore';
import { pickFolder } from '../../services/dialogs';
import { appKeymap } from '../../app/keymap';

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

function VaultsSection() {
  const root = useVaultStore((s) => s.root);
  const recentVaults = useVaultStore((s) => s.recentVaults);
  const openVaultAt = useVaultStore((s) => s.openVaultAt);
  const createVaultAt = useVaultStore((s) => s.createVaultAt);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-xs uppercase" style={{ color: 'var(--fg-muted)' }}>
          Current vault
        </div>
        <div className="text-sm">{root ?? 'No vault open'}</div>
      </div>
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
      {recentVaults.length > 0 && (
        <div>
          <div className="mb-1 text-xs uppercase" style={{ color: 'var(--fg-muted)' }}>
            Recent
          </div>
          <div className="flex flex-col gap-1">
            {recentVaults.map((p) => (
              <button
                key={p}
                className="truncate rounded px-2 py-1 text-left text-sm"
                style={{ backgroundColor: p === root ? 'var(--bg-panel)' : 'transparent' }}
                onClick={() => void openVaultAt(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}
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
            {section === 'ai' && <Stub text="AI & Models routing arrives in pass 06." />}
            {section === 'graph' && <Stub text="Graph settings arrive in pass 04." />}
            {section === 'hotkeys' && <HotkeysSection />}
            {section === 'data' && <Stub text="Data management (snapshots, export, migrations) arrives in later passes." />}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
