import { useMemo, useState } from 'react';
import type { GraphNode } from '../../domain';

interface GraphNotesIndexProps {
  notes: GraphNode[];
  selectedId: string | null;
  onOpenNote: (node: GraphNode) => void;
  onClose: () => void;
}

/** A text index for the canvas graph. The canvas is useful for relationships, but it is a poor
 * place to discover an isolated note or a label in a dense vault. This keeps every note in the
 * current graph scope addressable without changing the graph's semantic layers. */
export function GraphNotesIndex({ notes, selectedId, onOpenNote, onClose }: GraphNotesIndexProps) {
  const [query, setQuery] = useState('');
  const sortedNotes = useMemo(
    () => notes
      .filter((node) => node.type === 'note')
      .sort((a, b) => (a.label ?? a.id).localeCompare(b.label ?? b.id)),
    [notes],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const filteredNotes = normalizedQuery
    ? sortedNotes.filter((node) => `${node.label ?? ''} ${node.id}`.toLowerCase().includes(normalizedQuery))
    : sortedNotes;

  return (
    <aside
      data-testid="graph-notes-index"
      className="graph-notes-index flex h-full w-60 shrink-0 flex-col"
      style={{ borderRight: '1px solid var(--border)', backgroundColor: 'var(--bg-panel)' }}
    >
      <div className="shrink-0 px-3 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>Notes in map</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>{sortedNotes.length}</span>
            <button type="button" aria-label="Hide note list" title="Hide note list" onClick={onClose} style={{ color: 'var(--fg-muted)' }}>×</button>
          </div>
        </div>
        <input
          aria-label="Find a note in the map"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a note..."
          className="mt-2 w-full rounded px-2 py-1.5 text-xs outline-none"
          style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg)', color: 'var(--fg)' }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {filteredNotes.map((node) => (
          <button
            key={node.id}
            type="button"
            data-testid="graph-note-index-item"
            className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs"
            style={{
              backgroundColor: selectedId === node.id ? 'var(--bg)' : 'transparent',
              color: 'var(--fg)',
              borderLeft: selectedId === node.id ? '2px solid var(--accent)' : '2px solid transparent',
            }}
            onClick={() => onOpenNote(node)}
            title={`Open ${node.label ?? node.id}`}
          >
            <span
              aria-hidden
              className="mt-0.5 shrink-0 rounded-full"
              style={{ width: 8, height: 8, backgroundColor: 'var(--graph-node-note)' }}
            />
            <span className="min-w-0 truncate">{node.label ?? node.id}</span>
          </button>
        ))}
        {filteredNotes.length === 0 && (
          <p className="px-3 py-3 text-xs" style={{ color: 'var(--fg-muted)' }}>
            No notes match "{query}".
          </p>
        )}
      </div>
    </aside>
  );
}
