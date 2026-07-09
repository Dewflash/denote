// src/features/graph/LayerControls.tsx — layer toggles (wikilinks/tags/topics/ai-similar),
// AI-edge confidence slider, and the structural-hulls toggle (D7: default OFF). All persisted
// via graphStore (localStorage), per the pass-4 brief.

import { useGraphStore } from '../../state/graphStore';
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
  const localView = useGraphStore((s) => s.localView);
  const exitLocalView = useGraphStore((s) => s.exitLocalView);

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

      {localView.enabled && (
        <button
          className="rounded px-2 py-0.5"
          style={{ border: '1px solid var(--border)' }}
          onClick={exitLocalView}
        >
          Exit local view ({localView.hops}-hop)
        </button>
      )}
    </div>
  );
}
