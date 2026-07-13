// src/features/settings/SettingsModal.tsx — operational settings surface: vaults, editor,
// appearance, AI/cloud, graph, hotkeys, import, history, and sync controls.

import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useUiStore, type ThemeMode, type UiDensity } from '../../state/uiStore';
import { useVaultStore } from '../../state/vaultStore';
import { pickFolder } from '../../services/dialogs';
import { appKeymap, comboFromEvent, DEFAULT_BINDINGS, formatCombo, persistKeymap } from '../../app/keymap';
import { setGlobalCaptureHotkey } from '../../services/nativeCapture';
import { VAULT_COLOR_PALETTE } from '../../services/vaultRegistry';
import { appSupportRoot } from '../../services/appSupport';
import { createAppSupportIO } from '../../services/appSupportStore';
import { SnippetStore } from '../../services/snippets';
import { tauriStorage } from '../../services/tauriStorage';
import {
  BUNDLED_THEMES,
  parseThemeFile,
  serializeThemeFile,
  type ThemeTokens,
} from '../../services/themeSettings';
import { useGraphStore } from '../../state/graphStore';
import {
  gitCommitAll,
  gitHistoryEnable,
  gitHistoryStatus,
  gitPullFastForward,
  gitPushOrigin,
  gitSetRemote,
  githubRepoVisibility,
  type GitStatusInfo,
} from '../../services/nativeGit';
import { clearGitHubToken, hasGitHubToken, setGitHubToken } from '../../services/keychain';
import { planFolderImport } from '../../services/nativeImport';
import type { ImportPlanItem } from '../../services/importer';
import { VersionTimeline } from '../history/VersionTimeline';

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

function RelocateRow({ vaultId, expectedPath }: { vaultId: string; expectedPath: string }) {
  const registry = useVaultStore((s) => s.registry);
  const relocateVault = useVaultStore((s) => s.relocateVault);
  const clearRelocateError = useVaultStore((s) => s.clearRelocateError);
  const name = registry.find((v) => v.id === vaultId)?.name ?? vaultId;

  return (
    <div
      className="flex flex-col gap-2 rounded p-2 text-sm"
      style={{ border: '1px solid var(--danger)' }}
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
        <p className="text-xs" style={{ color: 'var(--danger)' }}>
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

const THEME_COLOR_TOKENS: { key: keyof ThemeTokens; label: string }[] = [
  { key: 'bg', label: 'Background' },
  { key: 'bgPanel', label: 'Panels' },
  { key: 'fg', label: 'Text' },
  { key: 'fgMuted', label: 'Muted text' },
  { key: 'accent', label: 'Accent' },
  { key: 'border', label: 'Borders' },
  { key: 'danger', label: 'Danger' },
  { key: 'graphNodeNote', label: 'Graph notes' },
  { key: 'graphNodeGhost', label: 'Graph ghosts' },
  { key: 'graphNodeTag', label: 'Graph tags' },
  { key: 'graphNodeTopic', label: 'Graph topics' },
  { key: 'graphEdgeSolid', label: 'Graph links' },
  { key: 'graphEdgeAi', label: 'Graph AI links' },
];

function AppearanceSection() {
  const theme = useUiStore((s) => s.theme);
  const themeFile = useUiStore((s) => s.themeFile);
  const accent = useUiStore((s) => s.accent);
  const setTheme = useUiStore((s) => s.setTheme);
  const setThemeFile = useUiStore((s) => s.setThemeFile);
  const updateThemeToken = useUiStore((s) => s.updateThemeToken);
  const setAccent = useUiStore((s) => s.setAccent);
  const density = useUiStore((s) => s.density);
  const setDensity = useUiStore((s) => s.setDensity);
  const [snippets, setSnippets] = useState<{ name: string; enabled: boolean }[]>([]);
  const [snippetError, setSnippetError] = useState<string | null>(null);
  const bumpSnippetsRevision = useUiStore((s) => s.bumpSnippetsRevision);
  const fileInput = useRef<HTMLInputElement>(null);
  const activeTheme = themeFile ?? (theme === 'dark' ? BUNDLED_THEMES[1] : BUNDLED_THEMES[0]);

  useEffect(() => {
    let cancelled = false;
    void appSupportRoot()
      .then((root) => new SnippetStore(createAppSupportIO(tauriStorage, root)).load())
      .then((loaded) => {
        if (!cancelled) setSnippets(loaded.map((snippet) => ({ name: snippet.name, enabled: snippet.enabled })));
      })
      .catch(() => {
        if (!cancelled) setSnippetError('Snippets are available in the desktop app after a vault is opened.');
      });
    return () => { cancelled = true; };
  }, []);

  function exportTheme(): void {
    const blob = new Blob([serializeThemeFile(activeTheme)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${activeTheme.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'denote-theme'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function importTheme(file: File | undefined): void {
    if (!file) return;
    void file.text().then((raw) => {
      setThemeFile(parseThemeFile(raw));
    }).catch(() => {
      window.alert('That theme file is invalid.');
    });
  }

  return (
    <div className="flex flex-col gap-5">
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
      <div>
        <div className="mb-1 text-xs uppercase" style={{ color: 'var(--fg-muted)' }}>Theme file</div>
        <div className="mb-2 flex items-center gap-2">
          <select
            value={themeFile?.name ?? ''}
            onChange={(event) => {
              const selected = BUNDLED_THEMES.find((candidate) => candidate.name === event.target.value);
              if (selected) setThemeFile(selected);
              else setTheme('system');
            }}
            className="min-w-0 flex-1 rounded px-2 py-1.5 text-sm"
            style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg)', color: 'var(--fg)' }}
          >
            <option value="">Base theme ({theme})</option>
            {BUNDLED_THEMES.map((candidate) => <option key={candidate.name} value={candidate.name}>{candidate.name}</option>)}
          </select>
          <button type="button" className="rounded px-2 py-1.5 text-xs" style={{ border: '1px solid var(--border)' }} onClick={exportTheme}>Export JSON</button>
          <button type="button" className="rounded px-2 py-1.5 text-xs" style={{ border: '1px solid var(--border)' }} onClick={() => fileInput.current?.click()}>Import JSON</button>
          <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={(event) => { importTheme(event.target.files?.[0]); event.currentTarget.value = ''; }} />
        </div>
        <div className="mb-2 text-xs" style={{ color: 'var(--fg-muted)' }}>
          {themeFile ? `${themeFile.name} is live. Edit a token below to create or update a custom theme.` : 'Pick a bundled theme or import a JSON theme to edit its tokens live.'}
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {THEME_COLOR_TOKENS.map(({ key, label }) => {
            const value = activeTheme.tokens[key];
            if (typeof value !== 'string') return null;
            return (
              <label key={key} className="flex items-center justify-between gap-2 text-xs">
                <span>{label}</span>
                <span className="flex items-center gap-1">
                  <input type="color" aria-label={label} value={value} onChange={(event) => updateThemeToken(key, event.target.value)} className="h-5 w-7" />
                  <code style={{ color: 'var(--fg-muted)' }}>{value}</code>
                </span>
              </label>
            );
          })}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {activeTheme.tokens.graphPalette.map((color, index) => (
            <label key={`palette-${index}`} className="flex items-center justify-between text-xs">
              Hull {index + 1}
              <input type="color" aria-label={`Graph hull ${index + 1}`} value={color} onChange={(event) => {
                const palette = [...activeTheme.tokens.graphPalette];
                palette[index] = event.target.value;
                updateThemeToken('graphPalette', palette);
              }} className="h-5 w-7" />
            </label>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs uppercase" style={{ color: 'var(--fg-muted)' }}>Interface density</div>
        <div className="flex gap-2">
          {(['comfortable', 'compact'] as UiDensity[]).map((value) => (
            <button key={value} type="button" className="rounded px-3 py-1.5 text-sm capitalize" style={{ border: '1px solid var(--border)', backgroundColor: density === value ? 'var(--bg-panel)' : 'transparent' }} onClick={() => setDensity(value)}>{value}</button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs uppercase" style={{ color: 'var(--fg-muted)' }}>CSS snippets</div>
        <p className="mb-2 text-xs" style={{ color: 'var(--fg-muted)' }}>Files in the app support snippets folder are scoped to the main surface and reload as soon as you toggle them.</p>
        {snippetError ? <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>{snippetError}</p> : snippets.length === 0 ? <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>No `.css` snippets found.</p> : (
          <div className="flex flex-col gap-1">
            {snippets.map((snippet) => (
              <label key={snippet.name} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={snippet.enabled} onChange={(event) => {
                  void appSupportRoot().then((root) => new SnippetStore(createAppSupportIO(tauriStorage, root)).setEnabled(snippet.name, event.target.checked)).then(() => {
                    setSnippets((current) => current.map((item) => item.name === snippet.name ? { ...item, enabled: event.target.checked } : item));
                    bumpSnippetsRevision();
                  });
                }} />
                <span>{snippet.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EditorSection() {
  const editorFont = useUiStore((s) => s.editorFont);
  const editorFontSize = useUiStore((s) => s.editorFontSize);
  const editorLineWidth = useUiStore((s) => s.editorLineWidth);
  const setEditorFont = useUiStore((s) => s.setEditorFont);
  const setEditorFontSize = useUiStore((s) => s.setEditorFontSize);
  const setEditorLineWidth = useUiStore((s) => s.setEditorLineWidth);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="mb-1 text-xs uppercase" style={{ color: 'var(--fg-muted)' }}>Editor font</div>
        <select value={editorFont} onChange={(event) => setEditorFont(event.target.value)} className="w-full rounded px-2 py-1.5 text-sm" style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg)', color: 'var(--fg)' }}>
          <option value="SF Mono, ui-monospace, Menlo, monospace">SF Mono</option>
          <option value="ui-monospace, Menlo, monospace">System monospace</option>
          <option value="-apple-system, BlinkMacSystemFont, sans-serif">System sans</option>
          <option value="Georgia, serif">Serif</option>
        </select>
      </div>
      <label className="flex items-center gap-3 text-sm"><span className="w-28">Font size</span><input type="range" min={12} max={20} value={editorFontSize} onChange={(event) => setEditorFontSize(Number(event.target.value))} className="flex-1" /><span className="w-10 text-right tabular-nums" style={{ color: 'var(--fg-muted)' }}>{editorFontSize}px</span></label>
      <label className="flex items-center gap-3 text-sm"><span className="w-28">Line width</span><input type="range" min={560} max={1200} step={20} value={editorLineWidth} onChange={(event) => setEditorLineWidth(Number(event.target.value))} className="flex-1" /><span className="w-12 text-right tabular-nums" style={{ color: 'var(--fg-muted)' }}>{editorLineWidth}px</span></label>
    </div>
  );
}

function GraphSection() {
  const hullsEnabled = useGraphStore((s) => s.hullsEnabled);
  const toggleHulls = useGraphStore((s) => s.toggleHulls);
  const resetView = useGraphStore((s) => s.resetView);
  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hullsEnabled} onChange={toggleHulls} /> Show topic/folder hulls</label>
      <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>Graph node, edge, and hull colors are edited in Appearance so the map and the rest of the app share one theme.</p>
      <button type="button" className="self-start rounded px-3 py-1.5 text-sm" style={{ border: '1px solid var(--border)' }} onClick={resetView}>Reset graph filters</button>
    </div>
  );
}

const AI_TASKS: { id: string; label: string }[] = [
  { id: 'summarize', label: 'Summarize' },
  { id: 'enrich', label: 'Suggest tags & links' },
  { id: 'label-similarity', label: 'Judge similarity' },
  { id: 'deep-organize', label: 'Deep organize' },
];

// Per-note tasks route only to the free/local backends. The paid Anthropic backend is deliberately
// NOT a per-task routing option: its only paths are the CAPPED deep-organize + insights flows, so
// there is no uncapped path to the paid tier (S27). It stays registered in the router so D18 still
// blocks it for localOnly vaults if ever routed (proven in tests).
const AI_BACKENDS: { id: string; label: string; enabled: boolean; note?: string }[] = [
  { id: 'mock', label: 'Mock', enabled: true },
  { id: 'apple', label: 'Apple (on-device)', enabled: true },
  { id: 'anthropic', label: 'Anthropic (cloud)', enabled: false, note: 'deep-organize only' },
];

function CloudSection() {
  const present = useVaultStore((s) => s.anthropicKeyPresent);
  const setKey = useVaultStore((s) => s.setAnthropicApiKey);
  const clearKey = useVaultStore((s) => s.clearAnthropicApiKey);
  const testKey = useVaultStore((s) => s.testAnthropicKey);
  const setSpendCap = useVaultStore((s) => s.setSpendCap);
  const revision = useVaultStore((s) => s.revision);
  const [draft, setDraft] = useState('');
  const [test, setTest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cap = useMemo(() => {
    void revision;
    return useVaultStore.getState().spendCap();
  }, [revision]);
  const remaining = useMemo(() => {
    void revision;
    return useVaultStore.getState().spendRemaining();
  }, [revision]);
  const runs = useMemo(() => {
    void revision;
    return useVaultStore.getState().spendRuns();
  }, [revision]);

  useMemo(() => {
    void useVaultStore.getState().refreshAnthropicKeyPresence();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-1 text-xs uppercase" style={{ color: 'var(--fg-muted)' }}>
          Anthropic API key (cloud tier)
        </div>
        <p className="mb-2 text-xs" style={{ color: 'var(--fg-muted)' }}>
          Stored in the macOS Keychain only — never written to a file (D13). Deep-organize and topic
          Analysis run on the cloud under a hard monthly budget cap.
        </p>
        <div className="flex items-center gap-2 text-sm">
          <span style={{ color: present ? 'var(--fg)' : 'var(--fg-muted)' }}>
            {present ? '● Key present' : '○ No key set'}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="password"
            placeholder="sk-ant-..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="flex-1 rounded px-2 py-1 text-sm"
            style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg)', color: 'var(--fg)' }}
          />
          <button
            className="rounded px-3 py-1 text-sm"
            style={{ border: '1px solid var(--border)' }}
            disabled={!draft.trim() || busy}
            onClick={() => {
              setBusy(true);
              void setKey(draft.trim()).finally(() => {
                setDraft('');
                setBusy(false);
              });
            }}
          >
            Save
          </button>
        </div>
        <div className="mt-2 flex items-center gap-3 text-xs">
          <button
            disabled={!present || busy}
            style={{ color: 'var(--fg-muted)' }}
            onClick={() => {
              setBusy(true);
              setTest('Testing…');
              void testKey()
                .then((r) => setTest(r.ok ? '✓ Key works' : `✗ ${r.detail ?? 'failed'}`))
                .finally(() => setBusy(false));
            }}
          >
            Test key
          </button>
          <button disabled={!present} style={{ color: 'var(--danger)' }} onClick={() => void clearKey()}>
            Remove key
          </button>
          {test && <span style={{ color: 'var(--fg-muted)' }}>{test}</span>}
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs uppercase" style={{ color: 'var(--fg-muted)' }}>
          Monthly budget cap
        </div>
        <p className="mb-2 text-xs" style={{ color: 'var(--fg-muted)' }}>
          A hard cap (S27): the cloud submission path is physically unable to exceed it. Remaining
          this month: <strong>${remaining.toFixed(2)}</strong>.
        </p>
        <div className="flex items-center gap-2 text-sm">
          <span>$</span>
          <input
            type="number"
            min={0}
            step={1}
            defaultValue={cap}
            key={cap}
            className="w-24 rounded px-2 py-1 text-sm"
            style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg)', color: 'var(--fg)' }}
            onBlur={(e) => void setSpendCap(Number(e.target.value))}
          />
          <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>/ month</span>
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs uppercase" style={{ color: 'var(--fg-muted)' }}>
          Run a cloud job
        </div>
        <p className="mb-2 text-xs" style={{ color: 'var(--fg-muted)' }}>
          Deep organize sends your notes (never local-only vaults) to the cloud to find themes
          across folders. You see the cost estimate and confirm before anything runs.
        </p>
        <button
          className="rounded px-3 py-1 text-sm"
          style={{ border: '1px solid var(--border)' }}
          disabled={!present}
          title={present ? undefined : 'Add your API key above first'}
          onClick={() => {
            useUiStore.getState().setSettingsOpen(false);
            useUiStore.getState().setDeepOrganizeOpen(true);
          }}
        >
          Deep organize…
        </button>
      </div>

      <div>
        <div className="mb-1 text-xs uppercase" style={{ color: 'var(--fg-muted)' }}>
          Spend history
        </div>
        {runs.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
            No cloud runs yet.
          </p>
        ) : (
          <div className="flex flex-col gap-1 text-xs">
            {[...runs]
              .slice()
              .reverse()
              .slice(0, 12)
              .map((r) => (
                <div key={r.id} className="flex items-center justify-between">
                  <span>
                    {r.at.slice(0, 10)} · {r.kind} · {r.model.replace('claude-', '')}
                  </span>
                  <span style={{ color: r.status === 'lost' ? 'var(--danger)' : 'var(--fg-muted)' }}>
                    ${r.costUsd.toFixed(3)} {r.status === 'lost' ? '(lost)' : r.status === 'estimated' ? '(pending)' : ''}
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

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
      <CloudSection />

      <div>
        <div className="mb-1 text-xs uppercase" style={{ color: 'var(--fg-muted)' }}>
          Task routing
        </div>
        <p className="mb-2 text-xs" style={{ color: 'var(--fg-muted)' }}>
          Per-note tasks run on-device (Apple, free & offline) or the Mock backend. The paid
          Anthropic tier is reached only through the capped “Deep organize” job and topic Analysis,
          never per keystroke — so cloud spend always passes the monthly budget gate.
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
  const globalCaptureError = useUiStore((s) => s.globalCaptureError);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function rebind(id: string, event: KeyboardEvent<HTMLButtonElement>): void {
    event.preventDefault();
    const combo = comboFromEvent(event.nativeEvent);
    if (!combo) {
      setMessage('Use a Command-key shortcut.');
      return;
    }
    try {
      appKeymap.rebind(id, combo);
      persistKeymap(appKeymap);
      setEditing(null);
      setVersion((value) => value + 1);
      if (id === 'global-capture') {
        void setGlobalCaptureHotkey(combo).then(() => setMessage(`Global capture is now ${formatCombo(combo)}.`)).catch((err) => setMessage(err instanceof Error ? err.message : String(err)));
      } else {
        setMessage(`${appKeymap.all().find((binding) => binding.id === id)?.description ?? 'Shortcut'} is now ${formatCombo(combo)}.`);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  function reset(id: string): void {
    const original = DEFAULT_BINDINGS.find((binding) => binding.id === id);
    if (!original) return;
    try {
      appKeymap.rebind(id, original.combo);
      persistKeymap(appKeymap);
      setVersion((value) => value + 1);
      if (id === 'global-capture') void setGlobalCaptureHotkey(original.combo).catch(() => {});
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  void version;
  return (
    <div className="flex flex-col gap-1 text-sm">
      {appKeymap.all().map((b) => (
        <div key={b.id} className="flex items-center justify-between gap-3">
          <span>{b.description}</span>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label={`Change ${b.description} shortcut`}
              title={editing === b.id ? 'Press a Command-key shortcut' : 'Change shortcut'}
              onClick={() => { setEditing(b.id); setMessage(null); }}
              onKeyDown={(event) => { if (editing === b.id) rebind(b.id, event); }}
              className="rounded px-2 py-0.5"
              style={{ backgroundColor: 'var(--bg-panel)', fontFamily: 'var(--font-editor)', border: editing === b.id ? '1px solid var(--accent)' : '1px solid transparent' }}
            >
              {editing === b.id ? 'Press keys…' : formatCombo(b.combo)}
            </button>
            {b.combo !== DEFAULT_BINDINGS.find((defaultBinding) => defaultBinding.id === b.id)?.combo && <button type="button" aria-label={`Reset ${b.description} shortcut`} onClick={() => reset(b.id)} style={{ color: 'var(--fg-muted)' }}>Reset</button>}
          </div>
        </div>
      ))}
      {globalCaptureError && <p className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>Global capture is unavailable: {globalCaptureError}. Choose another shortcut or grant Accessibility permission.</p>}
      {message && <p className="mt-2 text-xs" style={{ color: 'var(--fg-muted)' }}>{message}</p>}
    </div>
  );
}

function DataSection() {
  const root = useVaultStore((s) => s.root);
  const repo = useVaultStore((s) => s.repo);
  const activeNotePath = useVaultStore((s) => s.activeNotePath);
  const revision = useVaultStore((s) => s.revision);
  const [message, setMessage] = useState<string | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatusInfo | null>(null);
  const [remote, setRemote] = useState('');
  const [token, setToken] = useState('');
  const [tokenPresent, setTokenPresent] = useState(false);
  const [importReview, setImportReview] = useState<ImportPlanItem[]>([]);
  const autoSyncMinutes = useUiStore((s) => s.autoSyncMinutes);
  const setAutoSyncMinutes = useUiStore((s) => s.setAutoSyncMinutes);
  const activeVaultId = useVaultStore((s) => s.vaultId);
  const activeLocalOnly = useVaultStore((s) => s.registry.find((v) => v.id === activeVaultId)?.localOnly ?? false);

  const snapshots = useMemo(() => {
    void revision;
    return activeNotePath && repo ? repo.listSnapshotVersions(activeNotePath) : Promise.resolve([]);
  }, [activeNotePath, repo, revision]);

  useEffect(() => {
    if (!root) return;
    let cancelled = false;
    void gitHistoryStatus(root)
      .then((s) => {
        if (cancelled) return;
        setGitStatus(s);
        setRemote(s.remoteUrl ?? '');
      })
      .catch(() => {
        if (!cancelled) setGitStatus(null);
      });
    void hasGitHubToken().then((present) => {
      if (!cancelled) setTokenPresent(present);
    });
    return () => {
      cancelled = true;
    };
  }, [root, revision]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-1 text-xs uppercase" style={{ color: 'var(--fg-muted)' }}>
          Derived data
        </div>
        <p className="mb-2 text-xs" style={{ color: 'var(--fg-muted)' }}>
          Indexes and cache files are rebuildable from Markdown source files.
        </p>
        <button
          className="rounded px-3 py-1.5 text-sm"
          style={{ border: '1px solid var(--border)' }}
          disabled={!repo}
          onClick={() => {
            void repo?.rebuildDerivedCaches().then(() => setMessage('Rebuilt derived indexes from note files.'));
          }}
        >
          Rebuild indexes
        </button>
      </div>

      <div>
        <div className="mb-1 text-xs uppercase" style={{ color: 'var(--fg-muted)' }}>
          Import
        </div>
        <p className="mb-2 text-xs" style={{ color: 'var(--fg-muted)' }}>
          Import a Markdown/text folder or Obsidian vault. Exact duplicates are skipped; near
          duplicates are held for review and never silently dropped.
        </p>
        <button
          className="rounded px-3 py-1.5 text-sm"
          style={{ border: '1px solid var(--border)' }}
          disabled={!repo}
          onClick={() => {
            if (!repo) return;
            void pickFolder('Import Markdown folder').then(async (folder) => {
              if (!folder) return;
              const plan = await planFolderImport(repo, folder);
              let imported = 0;
              const reviewItems = plan.items.filter((item) => item.decision === 'review-near' || item.decision === 'warn-ai-key');
              for (const item of plan.items) {
                if (item.decision === 'skip-exact' || item.decision === 'review-near' || item.decision === 'warn-ai-key') continue;
                try {
                  await useVaultStore.getState().createNote(item.incoming.relPath, item.incoming.content);
                  imported += 1;
                } catch {
                  /* collision or invalid path: leave it in the report rather than overwriting */
                }
              }
              setImportReview(reviewItems);
              setMessage(`Imported ${imported}; skipped ${plan.exactSkipped} exact duplicates; ${reviewItems.length} incoming file${reviewItems.length === 1 ? '' : 's'} need review.`);
              void repo.rebuildDerivedCaches();
            }).catch((err) => setMessage(err instanceof Error ? err.message : String(err)));
          }}
        >
          Import folder...
        </button>
        {importReview.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {importReview.map((item) => (
              <div
                key={`${item.incoming.relPath}:${item.duplicateOf ?? ''}`}
                className="rounded p-2 text-xs"
                style={{ border: '1px solid var(--border)' }}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{item.incoming.relPath}</span>
                  <span style={{ color: 'var(--fg-muted)' }}>
                    {item.decision === 'review-near' ? `${Math.round((item.similarity ?? 0) * 100)}% similar` : 'reserved metadata'}
                  </span>
                </div>
                <div className="mb-2 truncate" style={{ color: 'var(--fg-muted)' }}>
                  {item.decision === 'review-near' ? `Matches ${item.duplicateOf ?? 'an existing note'}` : item.reason}
                </div>
                <div className="flex gap-2">
                  <button
                    className="rounded px-2 py-1"
                    style={{ border: '1px solid var(--border)' }}
                    onClick={() => {
                      void useVaultStore.getState().createNote(item.incoming.relPath, item.incoming.content)
                        .then(() => {
                          setImportReview((items) => items.filter((i) => i !== item));
                          setMessage(`Imported ${item.incoming.relPath}.`);
                          void repo?.rebuildDerivedCaches();
                        })
                        .catch((err) => setMessage(err instanceof Error ? err.message : String(err)));
                    }}
                  >
                    Import anyway
                  </button>
                  <button
                    style={{ color: 'var(--fg-muted)' }}
                    onClick={() => {
                      setImportReview((items) => items.filter((i) => i !== item));
                      setMessage(`Skipped ${item.incoming.relPath}.`);
                    }}
                  >
                    Skip
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 text-xs uppercase" style={{ color: 'var(--fg-muted)' }}>
          Vault history
        </div>
        <p className="mb-2 text-xs" style={{ color: 'var(--fg-muted)' }}>
          History is opt-in per vault. DeNote ignores machine-local `.denote` data except portable
          metadata and topics.
        </p>
        <div className="flex gap-2">
          <button
            className="rounded px-3 py-1.5 text-sm"
            style={{ border: '1px solid var(--border)' }}
            disabled={!root}
            onClick={() => {
              if (!root) return;
              void gitHistoryEnable(root)
                .then((s) => {
                  setGitStatus(s);
                  setMessage('History enabled for this vault.');
                })
                .catch((err) => setMessage(err instanceof Error ? err.message : String(err)));
            }}
          >
            Enable history
          </button>
          <button
            className="rounded px-3 py-1.5 text-sm"
            style={{ border: '1px solid var(--border)' }}
            disabled={!root || !repo}
            onClick={() => {
              if (!root || !repo) return;
              void gitCommitAll(root, `Edited ${repo.listNotePaths().length} notes`)
                .then((c) => setMessage(c ? `Recorded commit ${c.oid.slice(0, 8)}.` : 'No note changes to commit.'))
                .catch((err) => setMessage(err instanceof Error ? err.message : String(err)));
            }}
          >
            Record checkpoint
          </button>
        </div>
        {gitStatus && (
          <p className="mt-2 text-xs" style={{ color: 'var(--fg-muted)' }}>
            {gitStatus.enabled ? 'Enabled' : 'Not enabled'} · {gitStatus.dirty ? 'uncommitted changes' : 'clean'}
            {gitStatus.head ? ` · ${gitStatus.head.slice(0, 8)}` : ''}
          </p>
        )}
      </div>

      <div>
        <div className="mb-1 text-xs uppercase" style={{ color: 'var(--fg-muted)' }}>
          GitHub sync
        </div>
        <p className="mb-2 text-xs" style={{ color: 'var(--fg-muted)' }}>
          Pushes are manual unless you explicitly run them. New GitHub repositories should be
          private; paste only a token you created for this app.
        </p>
        {activeLocalOnly && remote.trim() && <p className="mb-2 rounded p-2 text-xs" style={{ border: '1px solid var(--danger)', color: 'var(--danger)' }}>This vault is marked local-only. GitHub sync is separate from AI privacy, but uploading these notes still leaves the device.</p>}
        <div className="mb-2 flex gap-2">
          <input
            className="min-w-0 flex-1 rounded px-2 py-1 text-sm"
            style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg)', color: 'var(--fg)' }}
            placeholder="https://github.com/you/private-vault.git"
            value={remote}
            onChange={(e) => setRemote(e.target.value)}
          />
          <button
            className="rounded px-3 py-1 text-sm"
            style={{ border: '1px solid var(--border)' }}
            disabled={!root || !remote.trim()}
            onClick={() => {
              if (!root) return;
              void gitSetRemote(root, remote.trim())
                .then((s) => {
                  setGitStatus(s);
                  setMessage('Remote saved.');
                })
                .catch((err) => setMessage(err instanceof Error ? err.message : String(err)));
            }}
          >
            Save remote
          </button>
        </div>
        <div className="mb-2 flex gap-2">
          <input
            className="min-w-0 flex-1 rounded px-2 py-1 text-sm"
            style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg)', color: 'var(--fg)' }}
            type="password"
            placeholder={tokenPresent ? 'GitHub token stored in Keychain' : 'GitHub token'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button
            className="rounded px-3 py-1 text-sm"
            style={{ border: '1px solid var(--border)' }}
            disabled={!token.trim()}
            onClick={() => {
              void setGitHubToken(token.trim()).then(() => {
                setToken('');
                setTokenPresent(true);
                setMessage('GitHub token stored in Keychain.');
              });
            }}
          >
            Save token
          </button>
          <button
            className="rounded px-3 py-1 text-sm"
            style={{ color: 'var(--danger)' }}
            disabled={!tokenPresent}
            onClick={() => void clearGitHubToken().then(() => setTokenPresent(false))}
          >
            Remove
          </button>
        </div>
        <div className="flex gap-2">
          <button
            className="rounded px-3 py-1.5 text-sm"
            style={{ border: '1px solid var(--border)' }}
            disabled={!root || !gitStatus?.remoteUrl}
            onClick={() => {
              if (!root) return;
              void (async () => {
                // First-push gate (checkpoint E / pass-11 brief): before a vault's first-ever
                // push, show the remote's visibility and require explicit confirmation — a
                // private-notes vault silently pushed to a public repo is unrecoverable.
                const pushedKey = `denote:git:pushed:${root}`;
                if (!localStorage.getItem(pushedKey)) {
                  const url = gitStatus?.remoteUrl ?? '';
                  setMessage('Checking remote visibility…');
                  const vis = await githubRepoVisibility(url);
                  const visText =
                    vis === 'private'
                      ? 'a PRIVATE repository'
                      : vis === 'public'
                        ? 'a PUBLIC repository — anyone can read it'
                        : 'a repository of UNKNOWN visibility (could not verify)';
                  const ok = window.confirm(
                    `First push of this vault.\n\nRemote: ${url}\nThis is ${visText}.\n\nYour notes will be uploaded. Continue?`,
                  );
                  if (!ok) {
                    setMessage('Push cancelled.');
                    return;
                  }
                }
                try {
                  await gitPushOrigin(root);
                  localStorage.setItem(pushedKey, new Date().toISOString());
                  setMessage('Pushed to origin.');
                } catch (err) {
                  setMessage(err instanceof Error ? err.message : String(err));
                }
              })();
            }}
          >
            Push
          </button>
          <button
            className="rounded px-3 py-1.5 text-sm"
            style={{ border: '1px solid var(--border)' }}
            disabled={!root || !gitStatus?.remoteUrl}
            onClick={() => {
              if (!root) return;
              void gitPullFastForward(root)
                .then((result) => {
                  setGitStatus(result.status);
                  void repo?.rebuildDerivedCaches();
                  setMessage(result.conflicts.length > 0
                    ? `Remote changes were written as ${result.conflicts.length} conflict note${result.conflicts.length === 1 ? '' : 's'}; local notes were left untouched.`
                    : 'Pulled from origin.');
                })
                .catch((err) => setMessage(err instanceof Error ? err.message : String(err)));
            }}
          >
            Pull
          </button>
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs" style={{ color: 'var(--fg-muted)' }}>
          <span>Automatic sync</span>
          <select value={autoSyncMinutes} onChange={(event) => setAutoSyncMinutes(Number(event.target.value))} className="rounded px-2 py-1 text-xs" style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg)', color: 'var(--fg)' }}>
            <option value={0}>Off</option>
            <option value={5}>Every 5 minutes</option>
            <option value={15}>Every 15 minutes</option>
            <option value={30}>Every 30 minutes</option>
          </select>
        </label>
      </div>

      {activeNotePath && (
        <div>
          <div className="mb-1 text-xs uppercase" style={{ color: 'var(--fg-muted)' }}>
            Active note history
          </div>
          <VersionTimeline snapshots={snapshots} root={root} relPath={activeNotePath} />
        </div>
      )}

      {message && <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>{message}</p>}
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
          className="denote-modal-settings fixed left-1/2 top-1/2 z-50 flex h-[520px] w-[720px] max-h-[calc(100dvh-24px)] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2"
          style={{
            backgroundColor: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
          }}
        >
          <Dialog.Title className="sr-only">Settings</Dialog.Title>
          <Dialog.Close asChild>
            <button
              type="button"
              aria-label="Close settings"
              title="Close settings"
              className="absolute right-2 top-2 z-10 rounded px-1.5 py-0.5 text-lg leading-none"
              style={{ color: 'var(--fg-muted)' }}
            >
              ×
            </button>
          </Dialog.Close>
          <nav
            className="denote-modal-settings-nav flex w-40 shrink-0 flex-col gap-0.5 overflow-auto p-2"
            style={{ borderRight: '1px solid var(--border)' }}
          >
            {SECTIONS.map((s) => (
              <button
                type="button"
                key={s.id}
                className="rounded px-2 py-1.5 text-left text-sm"
                style={{ backgroundColor: section === s.id ? 'var(--bg-panel)' : 'transparent' }}
                aria-pressed={section === s.id}
                onClick={() => setSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>
          <div className="min-w-0 flex-1 overflow-auto p-4">
            {section === 'vaults' && <VaultsSection />}
            {section === 'editor' && <EditorSection />}
            {section === 'appearance' && <AppearanceSection />}
            {section === 'ai' && <AiSection />}
            {section === 'graph' && <GraphSection />}
            {section === 'hotkeys' && <HotkeysSection />}
            {section === 'data' && <DataSection />}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
