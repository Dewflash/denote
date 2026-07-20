// src/state/graphStore.ts — graph view settings (pass-4 brief: "Layer controls (persisted per
// user)"). Same localStorage-persisted Zustand pattern as uiStore's theme/accent. Local-view
// mode (n-hop neighborhood centered on a note, "reachable from the editor") is NOT persisted —
// it's a transient navigation mode, not a preference.

import { create } from 'zustand';
import { DEFAULT_LAYERS, type LayerToggles } from '../features/graph/filter';

const LAYERS_KEY = 'denote:graph:layers';
const CONFIDENCE_KEY = 'denote:graph:minConfidence';
const HULLS_KEY = 'denote:graph:hullsEnabled';

function loadLayers(): LayerToggles {
  try {
    const raw = localStorage.getItem(LAYERS_KEY);
    if (!raw) return DEFAULT_LAYERS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_LAYERS;
    const p = parsed as Partial<LayerToggles>;
    return {
      wikilinks: p.wikilinks ?? DEFAULT_LAYERS.wikilinks,
      tags: p.tags ?? DEFAULT_LAYERS.tags,
      // AI graph layers are opt-in and stay hidden until the AI surface is engaged.
      topics: DEFAULT_LAYERS.topics,
      aiSimilar: DEFAULT_LAYERS.aiSimilar,
    };
  } catch {
    return DEFAULT_LAYERS;
  }
}

function loadNumber(key: string, fallback: number): number {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function loadBool(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key);
  return raw === null ? fallback : raw === '1';
}

export interface LocalViewState {
  enabled: boolean;
  centerId: string | null;
  hops: number;
}

interface GraphState {
  layers: LayerToggles;
  minConfidence: number;
  hullsEnabled: boolean;
  localView: LocalViewState;
  selectedNodeId: string | null;
  /** Which OPEN vaults feed the combined graph (pass-05 brief: "checkbox set of open vaults →
   *  combined graph", D17). Defaults to "every open vault" — vaultStore adds/removes ids here
   *  as vaults open/close, so a freshly-opened second vault appears in the combined view
   *  immediately rather than needing an extra click. Session-only (not persisted), same as
   *  localView: this tracks which vaults happen to be open right now, not a durable preference. */
  selectedGraphVaultIds: string[];

  toggleLayer: (key: keyof LayerToggles) => void;
  setMinConfidence: (v: number) => void;
  /** Restore DEFAULT_LAYERS + a low confidence floor (post-06 fix #2: "Reset view" escape from
   *  a confusing all-off / over-filtered graph). */
  resetView: () => void;
  toggleHulls: () => void;
  enterLocalView: (centerId: string, hops?: number) => void;
  exitLocalView: () => void;
  setSelectedNode: (id: string | null) => void;
  toggleGraphVault: (vaultId: string) => void;
  /** Called by vaultStore when a vault opens/closes — keeps the default "all open" behavior. */
  addOpenVault: (vaultId: string) => void;
  removeOpenVault: (vaultId: string) => void;
}

export const useGraphStore = create<GraphState>((set, get) => ({
  layers: loadLayers(),
  minConfidence: loadNumber(CONFIDENCE_KEY, 0),
  hullsEnabled: loadBool(HULLS_KEY, false), // default OFF (D7)
  localView: { enabled: false, centerId: null, hops: 2 },
  selectedNodeId: null,
  selectedGraphVaultIds: [],

  toggleLayer(key) {
    const layers = { ...get().layers, [key]: !get().layers[key] };
    localStorage.setItem(LAYERS_KEY, JSON.stringify(layers));
    set({ layers });
  },
  setMinConfidence(v) {
    const clamped = Math.min(1, Math.max(0, v));
    localStorage.setItem(CONFIDENCE_KEY, String(clamped));
    set({ minConfidence: clamped });
  },
  resetView() {
    localStorage.setItem(LAYERS_KEY, JSON.stringify(DEFAULT_LAYERS));
    localStorage.setItem(CONFIDENCE_KEY, '0.1');
    set({ layers: { ...DEFAULT_LAYERS }, minConfidence: 0.1 });
  },
  toggleHulls() {
    const hullsEnabled = !get().hullsEnabled;
    localStorage.setItem(HULLS_KEY, hullsEnabled ? '1' : '0');
    set({ hullsEnabled });
  },
  enterLocalView(centerId, hops = 2) {
    set({ localView: { enabled: true, centerId, hops } });
  },
  exitLocalView() {
    set({ localView: { enabled: false, centerId: null, hops: 2 } });
  },
  setSelectedNode(id) {
    set({ selectedNodeId: id });
  },
  toggleGraphVault(vaultId) {
    const cur = get().selectedGraphVaultIds;
    set({
      selectedGraphVaultIds: cur.includes(vaultId)
        ? cur.filter((id) => id !== vaultId)
        : [...cur, vaultId],
    });
  },
  addOpenVault(vaultId) {
    const cur = get().selectedGraphVaultIds;
    if (!cur.includes(vaultId)) set({ selectedGraphVaultIds: [...cur, vaultId] });
  },
  removeOpenVault(vaultId) {
    set({ selectedGraphVaultIds: get().selectedGraphVaultIds.filter((id) => id !== vaultId) });
  },
}));
