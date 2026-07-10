// src/features/explorer/ExplorerPanel.tsx — left sidebar: an affordance toolbar + Recent notes
// + collapsible tree. Paste-to-capture v1 (pass-03 brief): pasting here with nothing focused
// creates a note from the clipboard.
//
// The toolbar (post-06 manual-testing fix #1: hotkey-only UX failed discoverability) exposes the
// three most-used actions as visible buttons with hotkey tooltips. It reuses the ONE keymap
// registry (S21) via `appKeymap.invoke(id)`, so a button and its shortcut always do the identical
// thing and can never drift apart. Tokens only, no new deps.

import type { ReactNode } from 'react';
import { RecentNotes } from './RecentNotes';
import { FileTree } from './FileTree';
import { captureFromClipboard, isPasteCaptureTarget } from '../capture';
import { appKeymap, formatCombo } from '../../app/keymap';

function comboFor(id: string): string {
  const binding = appKeymap.all().find((b) => b.id === id);
  return binding ? formatCombo(binding.combo) : '';
}

function ToolbarButton({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const combo = comboFor(id);
  return (
    <button
      type="button"
      title={combo ? `${label} (${combo})` : label}
      aria-label={label}
      onClick={() => appKeymap.invoke(id)}
      className="flex items-center justify-center rounded"
      style={{ width: 26, height: 26, color: 'var(--fg-muted)', border: '1px solid transparent' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--bg)';
        e.currentTarget.style.borderColor = 'var(--border)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
        e.currentTarget.style.borderColor = 'transparent';
      }}
    >
      {children}
    </button>
  );
}

const ICON_PROPS = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function ExplorerPanel() {
  return (
    <div
      className="flex h-full flex-col overflow-auto"
      tabIndex={0}
      onPaste={(e) => {
        if (!isPasteCaptureTarget(e.target)) return;
        const text = e.clipboardData.getData('text/plain');
        if (!text) return;
        e.preventDefault();
        void captureFromClipboard(text);
      }}
    >
      <div
        className="flex items-center gap-1 px-2 py-1.5"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <ToolbarButton id="new-note" label="New note">
          <svg {...ICON_PROPS}>
            <path d="M12 5v14M5 12h14" />
          </svg>
        </ToolbarButton>
        <ToolbarButton id="search" label="Search">
          <svg {...ICON_PROPS}>
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </ToolbarButton>
        <ToolbarButton id="graph-view" label="Graph view">
          <svg {...ICON_PROPS}>
            <circle cx="5" cy="18" r="2.5" />
            <circle cx="19" cy="16" r="2.5" />
            <circle cx="13" cy="6" r="2.5" />
            <path d="m7 16.5 4-8M15 8l2.5 6" />
          </svg>
        </ToolbarButton>
      </div>
      <div className="flex flex-col gap-2 p-2">
        <RecentNotes />
        <FileTree />
      </div>
    </div>
  );
}
