import { useMemo, useState } from 'react';

interface SmokeNote {
  title: string;
  body: string;
  tags: string[];
  sourceUrl?: string;
}

const initialNotes: SmokeNote[] = [
  {
    title: 'Japan',
    body: 'Japan watches the [[Bank of Japan]] while yen policy shifts.',
    tags: ['finance'],
  },
];

export function E2ESmoke() {
  const [vaultOpen, setVaultOpen] = useState(false);
  const [notes, setNotes] = useState<SmokeNote[]>(initialNotes);
  const [active, setActive] = useState('Japan');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [graphOpen, setGraphOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hostileSnippet, setHostileSnippet] = useState(false);

  const activeNote = notes.find((n) => n.title === active) ?? notes[0];
  const backlinks = useMemo(() => {
    const token = `[[${activeNote.title}]]`;
    return notes.filter((n) => n.title !== activeNote.title && n.body.includes(token));
  }, [activeNote.title, notes]);
  const searchHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return notes.filter((n) => `${n.title}\n${n.body}\n${n.tags.join(' ')}`.toLowerCase().includes(q));
  }, [notes, query]);

  function createLinkedNote() {
    setNotes((current) => {
      if (current.some((n) => n.title === 'Bank of Japan')) return current;
      return [
        ...current,
        {
          title: 'Bank of Japan',
          body: 'Central bank note linked from [[Japan]].',
          tags: ['finance', 'banking'],
        },
      ];
    });
    setActive('Bank of Japan');
  }

  function fileCapture() {
    setNotes((current) => [
      ...current,
      {
        title: 'Captured Safari Note',
        body: 'Selected Safari text from a finance article.',
        tags: ['capture'],
        sourceUrl: 'https://example.com/boj',
      },
    ]);
    setCaptureOpen(false);
  }

  if (!vaultOpen) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4" style={{ backgroundColor: 'var(--bg)', color: 'var(--fg)' }}>
        <h1 className="text-xl font-semibold">DeNote e2e smoke</h1>
        <button
          data-testid="open-vault"
          className="rounded px-4 py-2 text-sm"
          style={{ border: '1px solid var(--border)' }}
          onClick={() => setVaultOpen(true)}
        >
          Open fixture vault
        </button>
      </div>
    );
  }

  return (
    <>
      {hostileSnippet && <style data-testid="hostile-snippet">{'.snippet-scope * { display: none !important; }'}</style>}
      <div className="snippet-scope grid h-screen" style={{ gridTemplateColumns: '220px 1fr 280px', gridTemplateRows: '1fr 28px', backgroundColor: 'var(--bg)', color: 'var(--fg)' }}>
        <aside className="p-3" style={{ borderRight: '1px solid var(--border)', backgroundColor: 'var(--bg-panel)' }}>
          <div className="mb-2 text-xs uppercase" style={{ color: 'var(--fg-muted)' }}>Fixture Vault</div>
          {notes.map((note) => (
            <button
              key={note.title}
              data-testid={`note-${note.title}`}
              className="mb-1 block w-full rounded px-2 py-1 text-left text-sm"
              style={{ backgroundColor: note.title === active ? 'var(--bg)' : 'transparent' }}
              onClick={() => {
                setActive(note.title);
                setGraphOpen(false);
              }}
            >
              {note.title}
            </button>
          ))}
          <button data-testid="create-linked-note" className="mt-3 rounded px-2 py-1 text-sm" style={{ border: '1px solid var(--border)' }} onClick={createLinkedNote}>
            Create linked note
          </button>
        </aside>

        <main className="min-w-0 p-4">
          {graphOpen ? (
            <section data-testid="graph-view" className="h-full">
              <h2 className="mb-3 text-lg font-semibold">Graph</h2>
              <div className="relative h-72 rounded" style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg-panel)' }}>
                {notes.map((note, index) => (
                  <div
                    key={note.title}
                    data-testid={`graph-node-${note.title}`}
                    className="absolute rounded-full px-3 py-1 text-xs"
                    style={{
                      left: 24 + index * 130,
                      top: index % 2 === 0 ? 64 : 154,
                      backgroundColor: 'var(--accent)',
                      color: '#fff',
                    }}
                  >
                    {note.title}
                  </div>
                ))}
                <div data-testid="graph-edge" className="absolute left-24 top-28 h-px w-44 rotate-12" style={{ backgroundColor: 'var(--graph-edge-solid)' }} />
              </div>
            </section>
          ) : (
            <article data-testid="editor-note" className="prose prose-sm max-w-none">
              <h1>{activeNote.title}</h1>
              <p>{activeNote.body}</p>
              {activeNote.sourceUrl && (
                <p data-testid="capture-provenance" style={{ color: 'var(--fg-muted)' }}>
                  source_url: {activeNote.sourceUrl}
                </p>
              )}
            </article>
          )}
        </main>

        <aside className="p-3" style={{ borderLeft: '1px solid var(--border)', backgroundColor: 'var(--bg-panel)' }}>
          <h2 className="mb-2 text-sm font-semibold">Backlinks</h2>
          <div data-testid="backlinks-panel" className="mb-4 text-sm">
            {backlinks.length === 0 ? 'No backlinks' : backlinks.map((n) => <div key={n.title}>{n.title}</div>)}
          </div>
          <button data-testid="open-graph" className="mb-2 block rounded px-2 py-1 text-sm" style={{ border: '1px solid var(--border)' }} onClick={() => setGraphOpen(true)}>
            Open graph
          </button>
          <button data-testid="open-search" className="mb-2 block rounded px-2 py-1 text-sm" style={{ border: '1px solid var(--border)' }} onClick={() => setSearchOpen(true)}>
            Search
          </button>
          <button data-testid="simulate-capture" className="mb-2 block rounded px-2 py-1 text-sm" style={{ border: '1px solid var(--border)' }} onClick={() => setCaptureOpen(true)}>
            Capture simulation
          </button>
          <button data-testid="inject-hostile-snippet" className="block rounded px-2 py-1 text-sm" style={{ border: '1px solid var(--border)' }} onClick={() => setHostileSnippet(true)}>
            Inject hostile snippet
          </button>
        </aside>

        <footer className="px-3 py-1 text-xs" style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border)', color: 'var(--fg-muted)' }}>
          {notes.length} notes
        </footer>
      </div>

      <button
        data-testid="open-settings"
        className="fixed bottom-10 right-4 z-50 rounded px-3 py-1.5 text-sm"
        style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--fg)' }}
        onClick={() => setSettingsOpen(true)}
      >
        Settings
      </button>

      {searchOpen && (
        <div data-testid="search-dialog" className="fixed left-1/2 top-16 z-50 w-[520px] -translate-x-1/2 rounded p-3" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--fg)' }}>
          <input
            data-testid="search-input"
            className="mb-2 w-full rounded px-2 py-1"
            style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg-panel)' }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes"
          />
          {searchHits.map((note) => (
            <button
              key={note.title}
              data-testid={`search-hit-${note.title}`}
              className="block w-full rounded px-2 py-1 text-left text-sm"
              onClick={() => {
                setActive(note.title);
                setSearchOpen(false);
                setGraphOpen(false);
              }}
            >
              {note.title}
            </button>
          ))}
        </div>
      )}

      {captureOpen && (
        <div data-testid="capture-dialog" className="fixed left-1/2 top-24 z-50 w-[460px] -translate-x-1/2 rounded p-4" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--fg)' }}>
          <h2 className="mb-2 font-semibold">Capture note</h2>
          <p className="mb-3 text-sm" style={{ color: 'var(--fg-muted)' }}>Source: Safari · https://example.com/boj</p>
          <button data-testid="file-capture" className="rounded px-3 py-1.5 text-sm" style={{ backgroundColor: 'var(--accent)', color: '#fff' }} onClick={fileCapture}>
            Create note
          </button>
        </div>
      )}

      {settingsOpen && (
        <div data-testid="settings-dialog" className="fixed left-1/2 top-1/2 z-50 w-[520px] -translate-x-1/2 -translate-y-1/2 rounded p-5" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--fg)' }}>
          <h2 className="mb-2 text-lg font-semibold">Settings</h2>
          <p data-testid="settings-visible" className="text-sm">Settings remains outside the snippet scope.</p>
          <button className="mt-3 rounded px-2 py-1 text-sm" style={{ border: '1px solid var(--border)' }} onClick={() => setSettingsOpen(false)}>
            Close
          </button>
        </div>
      )}
    </>
  );
}
