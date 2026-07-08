// src/features/explorer/ExplorerPanel.tsx — left sidebar: Recent notes + collapsible tree.
// Paste-to-capture v1 (pass-03 brief): pasting here with nothing focused creates a note from
// the clipboard.

import { RecentNotes } from './RecentNotes';
import { FileTree } from './FileTree';
import { captureFromClipboard, isPasteCaptureTarget } from '../capture';

export function ExplorerPanel() {
  return (
    <div
      className="flex h-full flex-col gap-2 overflow-auto p-2"
      tabIndex={0}
      onPaste={(e) => {
        if (!isPasteCaptureTarget(e.target)) return;
        const text = e.clipboardData.getData('text/plain');
        if (!text) return;
        e.preventDefault();
        void captureFromClipboard(text);
      }}
    >
      <RecentNotes />
      <FileTree />
    </div>
  );
}
