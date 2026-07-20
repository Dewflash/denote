// src/features/graph/LayerControls.tsx — core graph layer toggles (wikilinks/tags),
// Core graph layers and the vault selector. AI graph controls live behind the separate AI surface.
// ("Graph vault selector: checkbox set of open vaults → combined graph", D17) — shown only once
// there's more than one open vault to choose among, so single-vault sessions see no new UI.

import { useGraphStore } from '../../state/graphStore';
import { useUiStore } from '../../state/uiStore';
import { useVaultStore } from '../../state/vaultStore';
import type { LayerToggles } from './filter';

const LAYER_LABELS: { key: keyof LayerToggles; label: string }[] = [
  { key: 'wikilinks', label: 'Links' },
  { key: 'tags', label: 'Tags' },
];

const LAYER_TOOLTIPS: Record<keyof LayerToggles, string> = {
  wikilinks: '[[links]] written inside notes',
  tags: 'Notes that use the same #tag connect through it',
  topics: 'AI topics are available from the separate AI surface',
  aiSimilar: 'AI links are available from the separate AI surface',
};

export function LayerControls({ notesIndexOpen, onToggleNotesIndex }: { notesIndexOpen: boolean; onToggleNotesIndex: () => void }) {
  const layers = useGraphStore((s) => s.layers);
  const toggleLayer = useGraphStore((s) => s.toggleLayer);
  const resetView = useGraphStore((s) => s.resetView);
  const localView = useGraphStore((s) => s.localView);
  const exitLocalView = useGraphStore((s) => s.exitLocalView);
  const selectedGraphVaultIds = useGraphStore((s) => s.selectedGraphVaultIds);
  const toggleGraphVault = useGraphStore((s) => s.toggleGraphVault);

  const openVaultIds = useVaultStore((s) => s.openVaultIds);
  const registry = useVaultStore((s) => s.registry);
  const openVaults = openVaultIds
    .map((id) => registry.find((v) => v.id === id))
    .filter((v): v is NonNullable<typeof v> => v != null);

  return (
    <div
      className="graph-layer-controls flex flex-wrap items-center gap-4 px-3 py-2 text-xs"
      style={{ borderBottom: '1px solid var(--border)', backgroundColor: 'var(--bg-panel)', color: 'var(--fg-muted)' }}
    >
      {LAYER_LABELS.map(({ key, label }) => (
        <label key={key} className="graph-layer-toggle flex items-center gap-1.5" title={LAYER_TOOLTIPS[key]}>
          <input type="checkbox" checked={layers[key]} onChange={() => toggleLayer(key)} />
          {label}
        </label>
      ))}

      {openVaults.length > 1 && (
        <div className="graph-vault-filter flex items-center gap-2" style={{ borderLeft: '1px solid var(--border)', paddingLeft: 12 }}>
          {openVaults.map((v) => (
            <label key={v.id} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={selectedGraphVaultIds.includes(v.id)}
                onChange={() => toggleGraphVault(v.id)}
              />
              <span
                aria-hidden
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  backgroundColor: v.color,
                }}
              />
              {v.name}
            </label>
          ))}
        </div>
      )}

      <button
        className="graph-toolbar-button rounded px-2 py-0.5"
        style={{ border: '1px solid var(--border)' }}
        onClick={resetView}
        title="Turn the core graph layers back on"
      >
        Reset view
      </button>

      <button
        className="graph-toolbar-button rounded px-2 py-0.5"
        style={{ border: '1px solid var(--border)' }}
        onClick={onToggleNotesIndex}
        title={notesIndexOpen ? 'Hide the note list to give the map more room' : 'Show the note list'}
      >
        {notesIndexOpen ? 'Hide note list' : 'Show note list'}
      </button>

      {localView.enabled && (
        <button
          className="graph-toolbar-button rounded px-2 py-0.5"
          style={{ border: '1px solid var(--border)' }}
          onClick={exitLocalView}
          title="Leave the focused map and show every note"
        >
          Show all notes
        </button>
      )}

      <span className="graph-click-hint" style={{ marginLeft: 'auto' }}>Select a dot to inspect it.</span>
      <button
        className="graph-toolbar-button rounded px-2 py-0.5"
        style={{ border: '1px solid var(--border)' }}
        onClick={() => {
          exitLocalView();
          useUiStore.getState().setGraphViewOpen(false);
        }}
        title="Back to your notes (⌘G)"
      >
        ✕ Close graph
      </button>
    </div>
  );
}
