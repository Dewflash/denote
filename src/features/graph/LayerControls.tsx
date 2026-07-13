// src/features/graph/LayerControls.tsx — layer toggles (wikilinks/tags/topics/ai-similar),
// AI-edge confidence slider, and the structural-hulls toggle (D7: default OFF). All persisted
// via graphStore (localStorage), per the pass-4 brief. Pass-05 adds the vault checkbox selector
// ("Graph vault selector: checkbox set of open vaults → combined graph", D17) — shown only once
// there's more than one open vault to choose among, so single-vault sessions see no new UI.

import { useGraphStore } from '../../state/graphStore';
import { useUiStore } from '../../state/uiStore';
import { useVaultStore } from '../../state/vaultStore';
import type { LayerToggles } from './filter';

const LAYER_LABELS: { key: keyof LayerToggles; label: string }[] = [
  { key: 'wikilinks', label: 'Wikilinks' },
  { key: 'tags', label: 'Tags' },
  { key: 'topics', label: 'Topics' },
  { key: 'aiSimilar', label: 'AI-similar' },
];

export function LayerControls() {
  const layers = useGraphStore((s) => s.layers);
  const toggleLayer = useGraphStore((s) => s.toggleLayer);
  const minConfidence = useGraphStore((s) => s.minConfidence);
  const setMinConfidence = useGraphStore((s) => s.setMinConfidence);
  const hullsEnabled = useGraphStore((s) => s.hullsEnabled);
  const toggleHulls = useGraphStore((s) => s.toggleHulls);
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
      className="flex flex-wrap items-center gap-4 px-3 py-2 text-xs"
      style={{ borderBottom: '1px solid var(--border)', backgroundColor: 'var(--bg-panel)', color: 'var(--fg-muted)' }}
    >
      {LAYER_LABELS.map(({ key, label }) => (
        <label key={key} className="flex items-center gap-1.5">
          <input type="checkbox" checked={layers[key]} onChange={() => toggleLayer(key)} />
          {label}
        </label>
      ))}

      {openVaults.length > 1 && (
        <div className="flex items-center gap-2" style={{ borderLeft: '1px solid var(--border)', paddingLeft: 12 }}>
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

      <label className="flex items-center gap-1.5">
        AI confidence ≥ {minConfidence.toFixed(2)}
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={minConfidence}
          onChange={(e) => setMinConfidence(Number(e.target.value))}
        />
      </label>

      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={hullsEnabled} onChange={toggleHulls} />
        Structural hulls
      </label>

      <button
        className="rounded px-2 py-0.5"
        style={{ border: '1px solid var(--border)' }}
        onClick={resetView}
        title="Restore all edge layers and a low confidence floor"
      >
        Reset view
      </button>

      {localView.enabled && (
        <button
          className="rounded px-2 py-0.5"
          style={{ border: '1px solid var(--border)' }}
          onClick={exitLocalView}
        >
          Exit local view ({localView.hops}-hop)
        </button>
      )}

      <span style={{ marginLeft: 'auto' }}>Click a dot to open that note.</span>
      <button
        className="rounded px-2 py-0.5"
        style={{ border: '1px solid var(--border)' }}
        onClick={() => useUiStore.getState().setGraphViewOpen(false)}
        title="Back to your notes (⌘G)"
      >
        ✕ Close graph
      </button>
    </div>
  );
}
