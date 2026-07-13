// src/features/editor/theme.ts — editor CHROME styling only, on D16 CSS-variable tokens (never
// a hardcoded color) so light/dark/accent switches apply live with zero CM reconfiguration.
// Decoration typography (headings/links/tags/embeds) lives in editor.css instead, deliberately
// NOT here: EditorView.theme() scopes its rules to the editor's own DOM, so anything the reading
// view also needs to render (same classNames, plain React markup) has to be plain global CSS.

import { EditorView } from '@codemirror/view';

export const denoteEditorTheme = EditorView.theme(
  {
    '&': {
      color: 'var(--fg)',
      backgroundColor: 'var(--bg)',
      fontFamily: 'var(--font-editor)',
      fontSize: 'var(--editor-font-size)',
      height: '100%',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-content': { caretColor: 'var(--accent)', padding: '16px 20px', maxWidth: 'var(--editor-line-width)' },
    '.cm-gutters': { display: 'none' },
    '.cm-scroller': { fontFamily: 'var(--font-editor)', overflow: 'auto' },
    '.cm-line': { lineHeight: '1.6' },
  },
  { dark: false },
);
