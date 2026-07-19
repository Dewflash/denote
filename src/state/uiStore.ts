// src/state/uiStore.ts — UI-only state: theme/accent (D16 tokens), view mode, panel/dialog
// visibility. Nothing here is vault data; that all lives in vaultStore. Theme/accent are the
// only settings persisted this pass (Appearance is the one functional Settings section).

import { create } from 'zustand';
import {
  applyThemeTokens,
  BUNDLED_THEMES,
  clearThemeTokens,
  parseThemeFile,
  type ThemeFile,
} from '../services/themeSettings';
import type { ImportPlanItem } from '../services/importer';

export type ThemeMode = 'light' | 'dark' | 'system' | 'custom';
export type ViewMode = 'editor' | 'reading';
export type RightPanelTab = 'backlinks' | 'outgoing' | 'suggestions';
export type UiDensity = 'comfortable' | 'compact';

export interface CaptureDraft {
  text: string;
  sourceUrl?: string;
  sourceApp?: string;
  sourceTitle?: string;
  warning?: string;
  capturedAt: string;
}

export interface ImportReviewDraft {
  sourceLabel: string;
  items: ImportPlanItem[];
  exactSkipped: number;
  warnings: string[];
}

const THEME_KEY = 'denote:theme';
const CUSTOM_THEME_KEY = 'denote:themeFile';
const ACCENT_KEY = 'denote:accent';
const EDITOR_FONT_KEY = 'denote:editorFont';
const EDITOR_SIZE_KEY = 'denote:editorSize';
const EDITOR_WIDTH_KEY = 'denote:editorWidth';
const DENSITY_KEY = 'denote:density';
const AUTO_SYNC_KEY = 'denote:autoSyncMinutes';
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
  return v === 'light' || v === 'dark' || v === 'system' || v === 'custom' ? v : 'system';
}

function loadAccent(): string | null {
  return localStorage.getItem(ACCENT_KEY);
}

function loadCustomTheme(): ThemeFile | null {
  const raw = localStorage.getItem(CUSTOM_THEME_KEY);
  if (!raw) return null;
  try {
    return parseThemeFile(raw);
  } catch {
    localStorage.removeItem(CUSTOM_THEME_KEY);
    return null;
  }
}

function loadEditorFont(): string {
  const value = localStorage.getItem(EDITOR_FONT_KEY);
  return value && value.length < 160 ? value : 'SF Mono, ui-monospace, Menlo, monospace';
}

function loadEditorSize(): number {
  const value = Number(localStorage.getItem(EDITOR_SIZE_KEY));
  return Number.isFinite(value) ? Math.max(12, Math.min(20, Math.round(value))) : 14;
}

function loadEditorWidth(): number {
  const value = Number(localStorage.getItem(EDITOR_WIDTH_KEY));
  return Number.isFinite(value) ? Math.max(560, Math.min(1200, Math.round(value))) : 860;
}

function loadDensity(): UiDensity {
  return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable';
}

function loadAutoSyncMinutes(): number {
  const value = Number(localStorage.getItem(AUTO_SYNC_KEY));
  return value === 5 || value === 15 || value === 30 ? value : 0;
}

/** `system` = defer to the `prefers-color-scheme` rules already in tokens.css; anything else is
 *  the explicit `[data-theme]` override tokens.css already defines. */
function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'system' || mode === 'custom') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
}

function applyAccent(accent: string | null): void {
  const root = document.documentElement;
  if (accent) root.style.setProperty('--accent', accent);
  else root.style.removeProperty('--accent');
}

function applyEditorPreferences(font: string, size: number, width: number, density: UiDensity): void {
  const root = document.documentElement;
  root.style.setProperty('--font-editor', font);
  root.style.setProperty('--editor-font-size', `${size}px`);
  root.style.setProperty('--editor-line-width', `${width}px`);
  root.setAttribute('data-density', density);
}

interface UiState {
  theme: ThemeMode;
  themeFile: ThemeFile | null;
  accent: string | null;
  editorFont: string;
  editorFontSize: number;
  editorLineWidth: number;
  density: UiDensity;
  autoSyncMinutes: number;
  snippetsRevision: number;
  globalCaptureError: string | null;
  importReview: ImportReviewDraft | null;
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
  organizeVaultOpen: boolean;
  /** Deep-organize (cloud) modal — pass 9 (D13). */
  deepOrganizeOpen: boolean;
  /** The R-1 live AI status panel (anchored to the StatusBar ⚡ item). Promoted here from
   *  StatusBar-local state so other surfaces — the graph's zero-edge/sparse hints (R-4) — can
   *  open it as the "is the AI dead?" diagnostic. */
  aiStatusOpen: boolean;
  searchOpen: boolean;
  quickSwitcherOpen: boolean;
  /** The folder cmd-N / paste-capture files a new note into when nothing more specific is
   *  selected in the tree (brief: "untitled note in Inbox/ unless a folder is selected"). */
  selectedFolder: string | null;
  /** Pending paste-capture review (pass 7, D27): large pastes open a review modal that shows
   *  on-device title/summary/tag suggestions before filing. `null` when closed. */
  captureDraft: CaptureDraft | null;

  setTheme: (mode: ThemeMode) => void;
  setThemeFile: (theme: ThemeFile | null) => void;
  updateThemeToken: (token: keyof ThemeFile['tokens'], value: string | string[]) => void;
  setAccent: (accent: string | null) => void;
  setEditorFont: (font: string) => void;
  setEditorFontSize: (size: number) => void;
  setEditorLineWidth: (width: number) => void;
  setDensity: (density: UiDensity) => void;
  setAutoSyncMinutes: (minutes: number) => void;
  bumpSnippetsRevision: () => void;
  setGlobalCaptureError: (message: string | null) => void;
  openImportReview: (draft: ImportReviewDraft) => void;
  closeImportReview: () => void;
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
  setOrganizeVaultOpen: (open: boolean) => void;
  setDeepOrganizeOpen: (open: boolean) => void;
  setAiStatusOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  toggleSearch: () => void;
  setQuickSwitcherOpen: (open: boolean) => void;
  toggleQuickSwitcher: () => void;
  setSelectedFolder: (folder: string | null) => void;
  openCapture: (text: string, provenance?: Partial<Omit<CaptureDraft, 'text'>>) => void;
  closeCapture: () => void;
}

export const useUiStore = create<UiState>((set, get) => {
  const theme = loadTheme();
  const themeFile = loadCustomTheme();
  const accent = loadAccent();
  applyTheme(theme);
  if (themeFile) applyThemeTokens(themeFile);
  if (accent) applyAccent(accent);
  else if (!themeFile) applyAccent(null);
  const editorFont = loadEditorFont();
  const editorFontSize = loadEditorSize();
  const editorLineWidth = loadEditorWidth();
  const density = loadDensity();
  applyEditorPreferences(editorFont, editorFontSize, editorLineWidth, density);

  return {
    theme,
    themeFile,
    accent,
    editorFont,
    editorFontSize,
    editorLineWidth,
    density,
    autoSyncMinutes: loadAutoSyncMinutes(),
    snippetsRevision: 0,
    globalCaptureError: null,
    importReview: null,
    aiTakeoverThreshold: loadThreshold(),
    similarityTopK: loadTopK(),
    similarityMinCos: loadMinCos(),
    viewMode: 'editor',
    todayViewOpen: false,
    graphViewOpen: false,
    rightPanelTab: 'backlinks',
    commandPaletteOpen: false,
    settingsOpen: false,
    organizeVaultOpen: false,
    deepOrganizeOpen: false,
    aiStatusOpen: false,
    searchOpen: false,
    quickSwitcherOpen: false,
    selectedFolder: null,
    captureDraft: null,

    setTheme(mode) {
      localStorage.setItem(THEME_KEY, mode);
      applyTheme(mode);
      if (mode !== 'custom') {
        localStorage.removeItem(CUSTOM_THEME_KEY);
        clearThemeTokens();
        set({ themeFile: null });
      }
      if (mode !== 'custom') applyAccent(get().accent);
      set({ theme: mode });
    },
    setThemeFile(themeFile) {
      if (themeFile) {
        const validated = parseThemeFile(JSON.stringify(themeFile));
        localStorage.setItem(CUSTOM_THEME_KEY, JSON.stringify(validated));
        localStorage.setItem(THEME_KEY, 'custom');
        applyTheme('custom');
        applyThemeTokens(validated);
        if (get().accent) applyAccent(get().accent);
        set({ theme: 'custom', themeFile: validated });
        return;
      }
      localStorage.removeItem(CUSTOM_THEME_KEY);
      const nextMode = get().theme === 'custom' ? 'system' : get().theme;
      localStorage.setItem(THEME_KEY, nextMode);
      clearThemeTokens();
      applyTheme(nextMode);
      applyAccent(get().accent);
      set({ theme: nextMode, themeFile: null });
    },
    updateThemeToken(token, value) {
      const current = get().themeFile ?? BUNDLED_THEMES[0];
      const next: ThemeFile = {
        ...current,
        name: get().themeFile?.name ?? 'Custom',
        tokens: { ...current.tokens, [token]: value },
      };
      get().setThemeFile(next);
    },
    setAccent(accent) {
      if (accent) localStorage.setItem(ACCENT_KEY, accent);
      else localStorage.removeItem(ACCENT_KEY);
      if (accent) applyAccent(accent);
      else if (get().themeFile) applyThemeTokens(get().themeFile!);
      else applyAccent(null);
      set({ accent });
    },
    setEditorFont(font) {
      const clean = font.trim().slice(0, 160) || 'SF Mono, ui-monospace, Menlo, monospace';
      localStorage.setItem(EDITOR_FONT_KEY, clean);
      applyEditorPreferences(clean, get().editorFontSize, get().editorLineWidth, get().density);
      set({ editorFont: clean });
    },
    setEditorFontSize(size) {
      const clamped = Math.max(12, Math.min(20, Math.round(size)));
      localStorage.setItem(EDITOR_SIZE_KEY, String(clamped));
      applyEditorPreferences(get().editorFont, clamped, get().editorLineWidth, get().density);
      set({ editorFontSize: clamped });
    },
    setEditorLineWidth(width) {
      const clamped = Math.max(560, Math.min(1200, Math.round(width)));
      localStorage.setItem(EDITOR_WIDTH_KEY, String(clamped));
      applyEditorPreferences(get().editorFont, get().editorFontSize, clamped, get().density);
      set({ editorLineWidth: clamped });
    },
    setDensity(density) {
      localStorage.setItem(DENSITY_KEY, density);
      applyEditorPreferences(get().editorFont, get().editorFontSize, get().editorLineWidth, density);
      set({ density });
    },
    setAutoSyncMinutes(minutes) {
      const value = minutes === 5 || minutes === 15 || minutes === 30 ? minutes : 0;
      if (value === 0) localStorage.removeItem(AUTO_SYNC_KEY);
      else localStorage.setItem(AUTO_SYNC_KEY, String(value));
      set({ autoSyncMinutes: value });
    },
    bumpSnippetsRevision() {
      set((state) => ({ snippetsRevision: state.snippetsRevision + 1 }));
    },
    setGlobalCaptureError(message) {
      set({ globalCaptureError: message });
    },
    openImportReview(draft) {
      set({ importReview: draft });
    },
    closeImportReview() {
      set({ importReview: null });
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
    setOrganizeVaultOpen(open) {
      set({ organizeVaultOpen: open });
    },
    setDeepOrganizeOpen(open) {
      set({ deepOrganizeOpen: open });
    },
    setAiStatusOpen(open) {
      set({ aiStatusOpen: open });
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
    openCapture(text, provenance) {
      set({
        captureDraft: {
          text,
          sourceUrl: provenance?.sourceUrl,
          sourceApp: provenance?.sourceApp,
          sourceTitle: provenance?.sourceTitle,
          warning: provenance?.warning,
          capturedAt: provenance?.capturedAt ?? new Date().toISOString(),
        },
      });
    },
    closeCapture() {
      set({ captureDraft: null });
    },
  };
});
