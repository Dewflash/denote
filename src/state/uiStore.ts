// src/state/uiStore.ts — UI-only state: theme/accent (D16 tokens), view mode, panel/dialog
// visibility. Nothing here is vault data; that all lives in vaultStore. Theme/accent are the
// only settings persisted this pass (Appearance is the one functional Settings section).

import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ViewMode = 'editor' | 'reading';
export type RightPanelTab = 'backlinks' | 'outgoing';

const THEME_KEY = 'denote:theme';
const ACCENT_KEY = 'denote:accent';

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
  viewMode: ViewMode;
  todayViewOpen: boolean;
  graphViewOpen: boolean;
  rightPanelTab: RightPanelTab;
  commandPaletteOpen: boolean;
  settingsOpen: boolean;
  /** The folder cmd-N / paste-capture files a new note into when nothing more specific is
   *  selected in the tree (brief: "untitled note in Inbox/ unless a folder is selected"). */
  selectedFolder: string | null;

  setTheme: (mode: ThemeMode) => void;
  setAccent: (accent: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
  setTodayViewOpen: (open: boolean) => void;
  toggleTodayView: () => void;
  setGraphViewOpen: (open: boolean) => void;
  toggleGraphView: () => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setSelectedFolder: (folder: string | null) => void;
}

export const useUiStore = create<UiState>((set) => {
  const theme = loadTheme();
  const accent = loadAccent();
  applyTheme(theme);
  applyAccent(accent);

  return {
    theme,
    accent,
    viewMode: 'editor',
    todayViewOpen: false,
    graphViewOpen: false,
    rightPanelTab: 'backlinks',
    commandPaletteOpen: false,
    settingsOpen: false,
    selectedFolder: null,

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
    setSelectedFolder(folder) {
      set({ selectedFolder: folder });
    },
  };
});
