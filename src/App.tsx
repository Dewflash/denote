import "./app/main.css";
import { useEffect } from "react";
import { useVaultStore } from "./state/vaultStore";
import { useUiStore } from "./state/uiStore";
import { VaultRail } from "./app/VaultRail";
import { RightPanel } from "./app/RightPanel";
import { StatusBar } from "./app/StatusBar";
import { CommandPalette } from "./app/CommandPalette";
import { ExplorerPanel, TodayView } from "./features/explorer";
import { Editor, ReadingView } from "./features/editor";
import { GraphPage } from "./features/graph";
import { SettingsModal } from "./features/settings";
import { SearchPanel, QuickSwitcher } from "./features/search";
import { AiProvisionalBar, AiConsentModal, OrganizeVaultModal } from "./features/ai";
import { createUntitledNote, CaptureModal } from "./features/capture";
import { appKeymap, installGlobalKeymap } from "./app/keymap";
import { pickFolder } from "./services/dialogs";

function ConflictBar() {
  const conflict = useVaultStore((s) => s.conflict);
  const keepMine = useVaultStore((s) => s.resolveConflictKeepMine);
  const takeDisk = useVaultStore((s) => s.resolveConflictTakeDisk);
  const viewBoth = useVaultStore((s) => s.resolveConflictViewBoth);

  if (!conflict) return null;
  return (
    <div
      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
      style={{ backgroundColor: "var(--bg-panel)", borderBottom: "1px solid var(--border)" }}
    >
      <span>
        External changes detected in <strong>{conflict.relPath}</strong> while you had unsaved
        edits.
      </span>
      <div className="flex gap-2">
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
      className="flex h-screen flex-col items-center justify-center gap-4"
      style={{ backgroundColor: "var(--bg)", color: "var(--fg)" }}
    >
      <h1 className="text-xl font-semibold">DeNote</h1>
      <p style={{ color: "var(--fg-muted)" }}>
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
        <p className="text-sm" style={{ color: "#c0392b" }}>
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

  if (graphViewOpen) return <GraphPage />;
  if (todayViewOpen) return <TodayView />;
  if (!buffer) {
    return (
      <div className="flex h-full items-center justify-center" style={{ color: "var(--fg-muted)" }}>
        <p>Select or create a note to begin.</p>
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

function Shell() {
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
    appKeymap.setHandler("graph-view", () => useUiStore.getState().toggleGraphView());
    appKeymap.setHandler("settings", () => {
      const ui = useUiStore.getState();
      ui.setSettingsOpen(!ui.settingsOpen);
    });
    appKeymap.setHandler("search", () => useUiStore.getState().toggleSearch());
    appKeymap.setHandler("search-alias", () => useUiStore.getState().toggleSearch());
    appKeymap.setHandler("quick-switcher", () => useUiStore.getState().toggleQuickSwitcher());
    appKeymap.setHandler("undo", () => void useVaultStore.getState().opLog.undo());
    return installGlobalKeymap(appKeymap);
  }, []);

  return (
    <div
      className="grid h-screen"
      style={{
        gridTemplateColumns: "56px 260px 1fr 300px",
        gridTemplateRows: "1fr 24px",
        backgroundColor: "var(--bg)",
      }}
    >
      <div style={{ gridRow: "1 / 2" }}>
        <VaultRail />
      </div>
      <aside
        style={{
          gridRow: "1 / 2",
          borderRight: "1px solid var(--border)",
          backgroundColor: "var(--bg-panel)",
        }}
      >
        <ExplorerPanel />
      </aside>
      <main style={{ gridRow: "1 / 2", display: "flex", flexDirection: "column", minWidth: 0 }}>
        <ConflictBar />
        <div style={{ flex: 1, minHeight: 0 }}>
          <CenterPane />
        </div>
      </main>
      <aside
        style={{
          gridRow: "1 / 2",
          borderLeft: "1px solid var(--border)",
          backgroundColor: "var(--bg-panel)",
        }}
      >
        <RightPanel />
      </aside>
      <div style={{ gridColumn: "1 / -1", gridRow: "2 / 3" }}>
        <StatusBar />
      </div>
      <CommandPalette />
      <SettingsModal />
      <SearchPanel />
      <QuickSwitcher />
      <AiConsentModal />
      <OrganizeVaultModal />
      <CaptureModal />
    </div>
  );
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
  if (import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('graphMock') === '1') {
    return <DevGraphPreview />;
  }
  return root ? <Shell /> : <Welcome />;
}

export default App;
