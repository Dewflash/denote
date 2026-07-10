// src/state/uiStore.ts — UI-only state: theme/accent (D16 tokens), view mode, panel/dialog
// visibility. Nothing here is vault data; that all lives in vaultStore. Theme/accent are the
// only settings persisted this pass (Appearance is the one functional Settings section).

import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ViewMode = 'editor' | 'reading';
export type RightPanelTab = 'backlinks' | 'outgoing' | 'suggestions';

const THEME_KEY = 'denote:theme';
const ACCENT_KEY = 'denote:accent';
const AI_THRESHOLD_KEY = 'denote:aiTakeoverThreshold';
const SIM_TOPK_KEY = 'denote:similarityTopK';
const SIM_MINCOS_KEY = 'denote:similarityMinCos';

function loadThreshold(): number {
  const v = Number(localStorage.getItem(AI_THRESHOLD_KEY));
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.75; // S10 default
}

function loadTopK(): number {
  const v = Number(localStorage.getItem(SIM_TOPK_KEY));
  return Number.isInteger(v) && v >= 1 && v <= 10 ? v : 3; // S15 default k=3 (range 1–10)
}

function loadMinCos(): number {
  const v = Number(localStorage.getItem(SIM_MINCOS_KEY));
  return Number.isFinite(v) && v >= 0.4 && v <= 0.9 ? v : 0.62; // S15 default cos≥0.62 (0.4–0.9)
}

function loadTheme(): ThemeMode {
  const v = localStorage.getItem(THEME_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

function loadAccent(): string | null {
  return localStorage.getItem(ACCENT_KEY);
}

/** `system` = defer to the `prefers-color-scheme` rules already in tokens.css; anything else is
 *  the explicit `[data-theme]` override tokens.css already defines. */
function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
}

function applyAccent(accent: string | null): void {
  const root = document.documentElement;
  if (accent) root.style.setProperty('--accent', accent);
  else root.style.removeProperty('--accent');
}

interface UiState {
  theme: ThemeMode;
  accent: string | null;
  /** Takeover confidence floor (S10). AI setting; persisted (Settings → AI & Models). */
  aiTakeoverThreshold: number;
  /** ai-similar retrieval params (S15): topK neighbors + cosine floor. Persisted. */
  similarityTopK: number;
  similarityMinCos: number;
  viewMode: ViewMode;
  todayViewOpen: boolean;
  graphViewOpen: boolean;
  rightPanelTab: RightPanelTab;
  commandPaletteOpen: boolean;
  settingsOpen: boolean;
  searchOpen: boolean;
  quickSwitcherOpen: boolean;
  /** The folder cmd-N / paste-capture files a new note into when nothing more specific is
   *  selected in the tree (brief: "untitled note in Inbox/ unless a folder is selected"). */
  selectedFolder: string | null;
  /** Pending paste-capture review (pass 7, D27): large pastes open a review modal that shows
   *  on-device title/summary/tag suggestions before filing. `null` when closed. */
  captureText: string | null;

  setTheme: (mode: ThemeMode) => void;
  setAccent: (accent: string | null) => void;
  setAiTakeoverThreshold: (v: number) => void;
  setSimilarityTopK: (v: number) => void;
  setSimilarityMinCos: (v: number) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
  setTodayViewOpen: (open: boolean) => void;
  toggleTodayView: () => void;
  setGraphViewOpen: (open: boolean) => void;
  toggleGraphView: () => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  toggleSearch: () => void;
  setQuickSwitcherOpen: (open: boolean) => void;
  toggleQuickSwitcher: () => void;
  setSelectedFolder: (folder: string | null) => void;
  openCapture: (text: string) => void;
  closeCapture: () => void;
}

export const useUiStore = create<UiState>((set) => {
  const theme = loadTheme();
  const accent = loadAccent();
  applyTheme(theme);
  applyAccent(accent);

  return {
    theme,
    accent,
    aiTakeoverThreshold: loadThreshold(),
    similarityTopK: loadTopK(),
    similarityMinCos: loadMinCos(),
    viewMode: 'editor',
    todayViewOpen: false,
    graphViewOpen: false,
    rightPanelTab: 'backlinks',
    commandPaletteOpen: false,
    settingsOpen: false,
    searchOpen: false,
    quickSwitcherOpen: false,
    selectedFolder: null,
    captureText: null,

    setTheme(mode) {
      localStorage.setItem(THEME_KEY, mode);
      applyTheme(mode);
      set({ theme: mode });
    },
    setAccent(accent) {
      if (accent) localStorage.setItem(ACCENT_KEY, accent);
      else localStorage.removeItem(ACCENT_KEY);
      applyAccent(accent);
      set({ accent });
    },
    setAiTakeoverThreshold(v) {
      const clamped = Math.max(0, Math.min(1, v));
      localStorage.setItem(AI_THRESHOLD_KEY, String(clamped));
      set({ aiTakeoverThreshold: clamped });
    },
    setSimilarityTopK(v) {
      const clamped = Math.max(1, Math.min(10, Math.round(v)));
      localStorage.setItem(SIM_TOPK_KEY, String(clamped));
      set({ similarityTopK: clamped });
    },
    setSimilarityMinCos(v) {
      const clamped = Math.max(0.4, Math.min(0.9, v));
      localStorage.setItem(SIM_MINCOS_KEY, String(clamped));
      set({ similarityMinCos: clamped });
    },
    setViewMode(mode) {
      set({ viewMode: mode });
    },
    toggleViewMode() {
      set((s) => ({ viewMode: s.viewMode === 'editor' ? 'reading' : 'editor' }));
    },
    setTodayViewOpen(open) {
      set({ todayViewOpen: open });
    },
    toggleTodayView() {
      set((s) => ({ todayViewOpen: !s.todayViewOpen }));
    },
    setGraphViewOpen(open) {
      set({ graphViewOpen: open });
    },
    toggleGraphView() {
      set((s) => ({ graphViewOpen: !s.graphViewOpen }));
    },
    setRightPanelTab(tab) {
      set({ rightPanelTab: tab });
    },
    setCommandPaletteOpen(open) {
      set({ commandPaletteOpen: open });
    },
    setSettingsOpen(open) {
      set({ settingsOpen: open });
    },
    setSearchOpen(open) {
      set({ searchOpen: open });
    },
    toggleSearch() {
      set((s) => ({ searchOpen: !s.searchOpen }));
    },
    setQuickSwitcherOpen(open) {
      set({ quickSwitcherOpen: open });
    },
    toggleQuickSwitcher() {
      set((s) => ({ quickSwitcherOpen: !s.quickSwitcherOpen }));
    },
    setSelectedFolder(folder) {
      set({ selectedFolder: folder });
    },
    openCapture(text) {
      set({ captureText: text });
    },
    closeCapture() {
      set({ captureText: null });
    },
  };
});
