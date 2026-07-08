import "./app/main.css";

// Placeholder three-pane shell: explorer / editor / graph-or-inspector.
// Real panes arrive in pass 03 (shell UI) and pass 04 (graph view).
function App() {
  return (
    <div className="grid h-screen grid-cols-[240px_1fr_320px]" style={{ backgroundColor: "var(--bg)" }}>
      <aside
        className="border-r p-3"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-panel)" }}
      >
        <p style={{ color: "var(--fg-muted)" }}>Explorer</p>
      </aside>
      <main className="p-3">
        <p style={{ color: "var(--fg-muted)" }}>Editor</p>
      </main>
      <aside
        className="border-l p-3"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-panel)" }}
      >
        <p style={{ color: "var(--fg-muted)" }}>Graph / Inspector</p>
      </aside>
    </div>
  );
}

export default App;
