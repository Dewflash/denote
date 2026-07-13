// src/features/editor/Editor.tsx — the CodeMirror 6 wrapper (D19). Autosave is debounced
// 800ms through the repository ONLY (vaultStore.updateBufferContent → flushAutosave); this
// component never touches storage/Tauri directly. The view is recreated when the open note
// changes (relPath) and patched in place for external content changes (S23 rule 1).

import { useEffect, useRef } from 'react';
import { EditorState, Transaction, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { denoteEditorTheme } from './theme';
import { livePreviewExtensions } from './livePreview';
import { wikilinkAndTagAutocomplete } from './autocomplete';
import { setVaultContext, type EditorVaultContext } from './vaultContext';
import { useVaultStore } from '../../state/vaultStore';
import { useUiStore } from '../../state/uiStore';
import { useGraphStore } from '../../state/graphStore';
import { EDITOR_ROOT_ATTR } from '../../app/keymap';

export function Editor() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  const buffer = useVaultStore((s) => s.buffer);
  const repo = useVaultStore((s) => s.repo);
  const root = useVaultStore((s) => s.root);
  const revision = useVaultStore((s) => s.revision);
  const activeNotePath = useVaultStore((s) => s.activeNotePath);

  // (Re)create the view whenever the OPEN NOTE changes. Infrequent — a full remount is simpler
  // and safer than trying to patch cross-note state (selection, autocomplete, etc.) in place.
  useEffect(() => {
    if (!containerRef.current || !buffer) return;
    const extensions: Extension[] = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown(),
      syntaxHighlighting(defaultHighlightStyle),
      EditorView.lineWrapping,
      denoteEditorTheme,
      wikilinkAndTagAutocomplete(),
      ...livePreviewExtensions(),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          useVaultStore.getState().updateBufferContent(u.state.doc.toString());
        }
      }),
    ];
    const view = new EditorView({
      state: EditorState.create({ doc: buffer.content, extensions }),
      parent: containerRef.current,
    });
    view.dom.setAttribute(EDITOR_ROOT_ATTR, 'true');
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only the identity of the open note should tear down + recreate the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer?.relPath]);

  // Push fresh vault context (note titles, tags, assets) whenever the live index changes.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !repo || !root) return;
    const notes = repo.listNotePaths().map((relPath) => ({
      relPath,
      title: repo.getParsed(relPath)?.title ?? relPath,
    }));
    const knownTagSet = new Set<string>();
    for (const relPath of repo.listNotePaths()) {
      for (const t of repo.getParsed(relPath)?.tags ?? []) knownTagSet.add(t);
    }
    const currentDir = activeNotePath?.includes('/')
      ? activeNotePath.slice(0, activeNotePath.lastIndexOf('/'))
      : '';
    const ctx: EditorVaultContext = {
      vaultId: repo.vaultId,
      root,
      notes,
      assets: [...repo.index.assets.keys()],
      knownTags: [...knownTagSet],
      currentDir,
      onNavigate: (relPath) => {
        void useVaultStore.getState().setActiveNote(relPath);
      },
      onCreateGhost: (target) => {
        void useVaultStore.getState().createGhostAndOpen(target);
      },
    };
    view.dispatch({ effects: setVaultContext.of(ctx) });
    // revision is the deliberate re-derive signal; repo/root/activeNotePath included so a note
    // switch or vault switch also refreshes context immediately (not just on the next write).
  }, [repo, root, revision, activeNotePath]);

  // Apply an external content change (silent reload while clean, or "take disk" conflict
  // resolution) as a remote transaction — excluded from CM's own typing history (S23 rule 1).
  // vaultStore never rewrites `.content` for a DIRTY buffer, so this never fires mid-edit.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !buffer) return;
    const current = view.state.doc.toString();
    if (current !== buffer.content) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: buffer.content },
        annotations: Transaction.addToHistory.of(false),
      });
    }
    // Intentionally content-keyed, not buffer-keyed: dirty-flag-only buffer changes must not
    // re-run this (they'd be a no-op since content already matches, but the check should only
    // ever fire on an EXTERNAL content change, not our own typing).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer?.content]);

  if (!buffer) return null;
  return (
    <div className="relative h-full">
      {activeNotePath && (
        <div className="absolute right-3 top-3 z-10 flex gap-1.5">
          <button
            title="See this note without editing marks (⌘E toggles back)"
            className="rounded px-2 py-1 text-xs"
            style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg-panel)', color: 'var(--fg-muted)' }}
            onClick={() => useUiStore.getState().toggleViewMode()}
          >
            Reading view
          </button>
          <button
            title="Show local graph (2-hop neighborhood)"
            className="rounded px-2 py-1 text-xs"
            style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg-panel)', color: 'var(--fg-muted)' }}
            onClick={() => {
              useGraphStore.getState().enterLocalView(`${repo?.vaultId}/${activeNotePath}`, 2);
              useUiStore.getState().setGraphViewOpen(true);
            }}
          >
            Local graph
          </button>
        </div>
      )}
      <div ref={containerRef} className="h-full" data-testid="denote-editor" />
    </div>
  );
}
