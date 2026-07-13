import "./app/main.css";
import { useEffect, useState } from "react";
import { useVaultStore } from "./state/vaultStore";
import { useUiStore } from "./state/uiStore";
import { VaultRail } from "./app/VaultRail";
import { RightPanel } from "./app/RightPanel";
import { StatusBar } from "./app/StatusBar";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { CommandPalette } from "./app/CommandPalette";
import { ExplorerPanel, TodayView } from "./features/explorer";
import { Editor, ReadingView } from "./features/editor";
import { GraphPage } from "./features/graph";
import { SettingsModal } from "./features/settings";
import { SearchPanel, QuickSwitcher } from "./features/search";
import { ImportReviewModal } from "./features/import";
import { AiProvisionalBar, AiConsentModal, OrganizeVaultModal, DeepOrganizeModal } from "./features/ai";
import { createUntitledNote, CaptureModal, globalCaptureFromClipboard } from "./features/capture";
import { appKeymap, installGlobalKeymap, restoreSavedKeymap } from "./app/keymap";
import { pickFolder } from "./services/dialogs";
import { appSupportRoot } from "./services/appSupport";
import { createAppSupportIO } from "./services/appSupportStore";
import { SnippetStore } from "./services/snippets";
import { setGlobalCaptureHotkey, installNativeCaptureListener } from "./services/nativeCapture";
import { tauriStorage } from "./services/tauriStorage";
import { gitHistoryStatus, gitPullFastForward, gitPushOrigin } from "./services/nativeGit";
import { E2ESmoke } from "./e2e/E2ESmoke";
import { useGraphStore } from "./state/graphStore";

function ConflictBar() {
  const conflict = useVaultStore((s) => s.conflict);
  const keepMine = useVaultStore((s) => s.resolveConflictKeepMine);
  const takeDisk = useVaultStore((s) => s.resolveConflictTakeDisk);
  const viewBoth = useVaultStore((s) => s.resolveConflictViewBoth);

  if (!conflict) return null;
  return (
    <div
      className="denote-conflict-bar flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm"
      style={{ backgroundColor: "var(--bg-panel)", borderBottom: "1px solid var(--border)" }}
    >
      <span className="min-w-0 flex-1">
        External changes detected in <strong>{conflict.relPath}</strong> while you had unsaved
        edits.
      </span>
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded px-2 py-1"
          style={{ border: "1px solid var(--border)" }}
          onClick={() => keepMine()}
        >
          Keep mine
        </button>
        <button
          className="rounded px-2 py-1"
          style={{ border: "1px solid var(--border)" }}
          onClick={() => takeDisk()}
        >
          Take disk
        </button>
        <button
          className="rounded px-2 py-1"
          style={{ border: "1px solid var(--border)" }}
          onClick={() => void viewBoth()}
        >
          View both
        </button>
      </div>
    </div>
  );
}

function Welcome() {
  const openVaultAt = useVaultStore((s) => s.openVaultAt);
  const createVaultAt = useVaultStore((s) => s.createVaultAt);
  const error = useVaultStore((s) => s.error);

  return (
    <div
      className="flex h-screen flex-col items-center justify-center gap-4 px-4 text-center"
      style={{ backgroundColor: "var(--bg)", color: "var(--fg)" }}
    >
      <h1 className="text-xl font-semibold">DeNote</h1>
      <p className="max-w-md" style={{ color: "var(--fg-muted)" }}>
        Open an existing vault or create a new one to get started.
      </p>
      <div className="flex gap-3">
        <button
          className="rounded px-4 py-2 text-sm"
          style={{ border: "1px solid var(--border)" }}
          onClick={() =>
            void pickFolder("Open vault").then((p) => {
              if (p) void openVaultAt(p);
            })
          }
        >
          Open vault
        </button>
        <button
          className="rounded px-4 py-2 text-sm"
          style={{ backgroundColor: "var(--accent)", color: "#fff" }}
          onClick={() =>
            void pickFolder("Create vault").then((p) => {
              if (p) void createVaultAt(p);
            })
          }
        >
          Create vault
        </button>
      </div>
      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function CenterPane() {
  const todayViewOpen = useUiStore((s) => s.todayViewOpen);
  const graphViewOpen = useUiStore((s) => s.graphViewOpen);
  const viewMode = useUiStore((s) => s.viewMode);
  const buffer = useVaultStore((s) => s.buffer);
  const repo = useVaultStore((s) => s.repo);

  if (graphViewOpen) return <GraphPage />;
  if (todayViewOpen) return <TodayView />;

  if (!buffer && repo && repo.listNotePaths().length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6" style={{ color: 'var(--fg)' }}>
        <div className="w-full max-w-lg rounded p-5" style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg-panel)' }}>
          <h2 className="mb-4 text-base font-semibold">Start your vault</h2>
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--accent)', color: '#fff' }}>1</span>
              <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => appKeymap.invoke('new-note')}>Create your first note</button>
            </div>
            <div className="flex items-start gap-3" style={{ color: 'var(--fg-muted)' }}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ border: '1px solid var(--border)' }}>2</span>
              <span>Type [[ inside a note to link to another one — links are what build your graph</span>
            </div>
            <div className="flex items-start gap-3" style={{ color: 'var(--fg-muted)' }}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ border: '1px solid var(--border)' }}>3</span>
              <span>Press the graph icon (or ⌘G) once you have a few linked notes</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!buffer) {
    return (
      <div className="flex h-full items-center justify-center" style={{ color: "var(--fg-muted)" }}>
        <p>Click a note in the left sidebar, or press ⌘N to create a new one.</p>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <AiProvisionalBar />
      <div style={{ flex: 1, minHeight: 0 }}>
        {viewMode === "reading" ? <ReadingView /> : <Editor />}
      </div>
    </div>
  );
}

function ShellPanelToggles({
  explorerOpen,
  inspectorOpen,
  onToggleExplorer,
  onToggleInspector,
}: {
  explorerOpen: boolean;
  inspectorOpen: boolean;
  onToggleExplorer: () => void;
  onToggleInspector: () => void;
}) {
  return (
    <div className="denote-desktop-panel-toggles" aria-label="Desktop panel controls">
      <button
        type="button"
        data-testid="toggle-explorer-panel"
        className="denote-panel-toggle"
        aria-label={explorerOpen ? 'Hide file explorer' : 'Show file explorer'}
        aria-expanded={explorerOpen}
        title={explorerOpen ? 'Hide file explorer' : 'Show file explorer'}
        onClick={onToggleExplorer}
      >
        <svg viewBox="0 0 24 24" aria-hidden><path d={explorerOpen ? 'm15 6-6 6 6 6' : 'm9 6 6 6-6 6'} /></svg>
      </button>
      <button
        type="button"
        data-testid="toggle-inspector-panel"
        className="denote-panel-toggle"
        aria-label={inspectorOpen ? 'Hide links panel' : 'Show links panel'}
        aria-expanded={inspectorOpen}
        title={inspectorOpen ? 'Hide links panel' : 'Show links panel'}
        onClick={onToggleInspector}
      >
        <svg viewBox="0 0 24 24" aria-hidden><path d={inspectorOpen ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'} /></svg>
      </button>
    </div>
  );
}

function Shell() {
  const graphViewOpen = useUiStore((s) => s.graphViewOpen);
  const [desktopExplorerOpen, setDesktopExplorerOpen] = useState(true);
  const [desktopInspectorOpen, setDesktopInspectorOpen] = useState(true);
  const [mobileExplorerOpen, setMobileExplorerOpen] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);

  useEffect(() => {
    restoreSavedKeymap(appKeymap);
    const unlisten = installNativeCaptureListener();
    const capture = appKeymap.all().find((binding) => binding.id === "global-capture");
    if (capture) void setGlobalCaptureHotkey(capture.combo).catch(() => {});
    return unlisten;
  }, []);

  useEffect(() => {
    appKeymap.setHandler("new-note", () => {
      useUiStore.getState().setTodayViewOpen(false);
      void createUntitledNote(useUiStore.getState().selectedFolder);
    });
    appKeymap.setHandler("command-palette", () => {
      const ui = useUiStore.getState();
      ui.setCommandPaletteOpen(!ui.commandPaletteOpen);
    });
    appKeymap.setHandler("reading-view", () => useUiStore.getState().toggleViewMode());
    appKeymap.setHandler("today-view", () => useUiStore.getState().toggleTodayView());
    appKeymap.setHandler("graph-view", () => {
      // The toolbar/shortcut opens the full map. Local graph is an explicit editor action and
      // must not leak into the next normal graph visit after the map is closed.
      useGraphStore.getState().exitLocalView();
      useUiStore.getState().toggleGraphView();
    });
    appKeymap.setHandler("settings", () => {
      const ui = useUiStore.getState();
      ui.setSettingsOpen(!ui.settingsOpen);
    });
    appKeymap.setHandler("search", () => useUiStore.getState().toggleSearch());
    appKeymap.setHandler("search-alias", () => useUiStore.getState().toggleSearch());
    appKeymap.setHandler("quick-switcher", () => useUiStore.getState().toggleQuickSwitcher());
    appKeymap.setHandler("global-capture", () => void globalCaptureFromClipboard());
    appKeymap.setHandler("undo", () => void useVaultStore.getState().opLog.undo());
    return installGlobalKeymap(appKeymap);
  }, []);

  return (
    <>
    <div
      className={`snippet-scope denote-shell grid h-screen${graphViewOpen ? " denote-shell-graph" : ""}${!desktopExplorerOpen ? " denote-shell-explorer-collapsed" : ""}${!desktopInspectorOpen ? " denote-shell-inspector-collapsed" : ""}${mobileExplorerOpen ? " denote-shell-explorer-open" : ""}${mobileInspectorOpen ? " denote-shell-inspector-open" : ""}`}
      style={{
        gridTemplateRows: "1fr 24px",
        backgroundColor: "var(--bg)",
      }}
    >
      <div className="denote-shell-rail" style={{ gridRow: "1 / 2" }}>
        <ErrorBoundary surface="Vault rail"><VaultRail /></ErrorBoundary>
      </div>
      {(mobileExplorerOpen || mobileInspectorOpen) && !graphViewOpen && (
        <button
          type="button"
          aria-label="Close side panel"
          className="denote-mobile-backdrop"
          onClick={() => { setMobileExplorerOpen(false); setMobileInspectorOpen(false); }}
        />
      )}
      <aside
        className="denote-shell-explorer"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('[data-denote-note-row]')) setMobileExplorerOpen(false);
        }}
        style={{
          gridRow: "1 / 2",
          borderRight: "1px solid var(--border)",
          backgroundColor: "var(--bg-panel)",
        }}
      >
        <ErrorBoundary surface="Explorer"><ExplorerPanel /></ErrorBoundary>
      </aside>
      <main className="denote-shell-main" style={{ gridRow: "1 / 2", display: "flex", flexDirection: "column", minWidth: 0 }}>
        <ShellPanelToggles
          explorerOpen={desktopExplorerOpen}
          inspectorOpen={desktopInspectorOpen}
          onToggleExplorer={() => setDesktopExplorerOpen((open) => !open)}
          onToggleInspector={() => setDesktopInspectorOpen((open) => !open)}
        />
        <div className="denote-mobile-toolbar" aria-label="Panel controls">
          <button
            type="button"
            aria-label="Show note list"
            title="Show note list"
            className="denote-mobile-toolbar-button"
            onClick={() => { setMobileExplorerOpen((open) => !open); setMobileInspectorOpen(false); }}
          >
            <svg viewBox="0 0 24 24" aria-hidden><path d="M4 6h16M4 12h16M4 18h10" /></svg>
          </button>
          <button
            type="button"
            aria-label="Show note details"
            title="Show note details"
            className="denote-mobile-toolbar-button"
            onClick={() => { setMobileInspectorOpen((open) => !open); setMobileExplorerOpen(false); }}
          >
            <svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7h.01" /></svg>
          </button>
        </div>
        <ErrorBoundary surface="Editor"><ConflictBar /></ErrorBoundary>
        <div style={{ flex: 1, minHeight: 0 }}>
          <ErrorBoundary surface="Editor"><CenterPane /></ErrorBoundary>
        </div>
      </main>
      <aside
        className="denote-shell-inspector"
        style={{
          gridRow: "1 / 2",
          borderLeft: "1px solid var(--border)",
          backgroundColor: "var(--bg-panel)",
        }}
      >
        <ErrorBoundary surface="Inspector"><RightPanel /></ErrorBoundary>
      </aside>
      <div className="denote-shell-status" style={{ gridColumn: "1 / -1", gridRow: "2 / 3" }}>
        <ErrorBoundary surface="Status bar"><StatusBar /></ErrorBoundary>
      </div>
      <CommandPalette />
      <SearchPanel />
      <QuickSwitcher />
      <AiConsentModal />
      <OrganizeVaultModal />
      <DeepOrganizeModal />
      <CaptureModal />
      <SnippetStyleInjector />
      <AutoSync />
    </div>
    <ErrorBoundary surface="Settings"><SettingsModal /></ErrorBoundary>
    <ImportReviewModal />
    </>
  );
}

function AutoSync() {
  const root = useVaultStore((s) => s.root);
  const minutes = useUiStore((s) => s.autoSyncMinutes);

  useEffect(() => {
    if (!root || minutes === 0) return undefined;
    let cancelled = false;
    const sync = async (): Promise<void> => {
      try {
        const status = await gitHistoryStatus(root);
        if (!status.enabled || !status.remoteUrl) return;
        const pulled = await gitPullFastForward(root);
        if (!cancelled && pulled.conflicts.length === 0) await gitPushOrigin(root);
      } catch {
        // Automatic sync is best-effort; the manual Data surface remains authoritative.
      }
    };
    const timer = window.setInterval(() => { void sync(); }, minutes * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [root, minutes]);
  return null;
}

function SnippetStyleInjector() {
  const [css, setCss] = useState('');
  const snippetsRevision = useUiStore((s) => s.snippetsRevision);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const root = await appSupportRoot();
        const store = new SnippetStore(createAppSupportIO(tauriStorage, root));
        const next = await store.enabledCss();
        if (!cancelled) setCss(next);
      } catch {
        if (!cancelled) setCss('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [snippetsRevision]);
  return <style data-denote-snippets>{css}</style>;
}

/** Dev-only escape hatch (never reachable in a production build — the `import.meta.env.DEV`
 *  check is statically eliminated by Vite): lets a plain browser preview (no Tauri, no open
 *  vault) exercise GraphPage's mock-data path (mockFixture.ts) to sanity-check the visual
 *  language pass 7/8 will rely on, without needing the Rust fs bridge this environment can't
 *  reach (same limitation noted in pass 3's PROGRESS entry). */
function DevGraphPreview() {
  return (
    <div className="h-screen" style={{ backgroundColor: 'var(--bg)' }}>
      <GraphPage />
    </div>
  );
}

function App() {
  const root = useVaultStore((s) => s.root);
  if (import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('e2eSmoke') === '1') {
    return <E2ESmoke />;
  }
  if (import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('graphMock') === '1') {
    return <DevGraphPreview />;
  }
  return root ? <Shell /> : <Welcome />;
}

export default App;
