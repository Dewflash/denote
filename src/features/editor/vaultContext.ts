// src/features/editor/vaultContext.ts — carries the vault-derived data the live-preview
// decorations and autocomplete need (note titles for link resolution, known tags, the current
// note's folder for ghost creation) into the CodeMirror state. Pushed in from React via a
// StateEffect whenever the vault's revision changes; nothing here reaches into Zustand or
// Tauri directly, keeping this module framework-agnostic like the rest of CodeMirror config.

import { StateEffect, StateField } from '@codemirror/state';

export interface NoteTitleEntry {
  relPath: string;
  title: string;
}

export interface EditorVaultContext {
  vaultId: string;
  root: string;
  notes: NoteTitleEntry[];
  assets: string[]; // relPaths of non-.md files (S26 embed resolution, steps 1-2 only)
  knownTags: string[];
  currentDir: string;
  onNavigate: (relPath: string) => void;
  onCreateGhost: (target: string) => void;
}

const EMPTY_CONTEXT: EditorVaultContext = {
  vaultId: '',
  root: '',
  notes: [],
  assets: [],
  knownTags: [],
  currentDir: '',
  onNavigate: () => {},
  onCreateGhost: () => {},
};

export const setVaultContext = StateEffect.define<EditorVaultContext>();

export const vaultContextField = StateField.define<EditorVaultContext>({
  create: () => EMPTY_CONTEXT,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setVaultContext)) value = e.value;
    return value;
  },
});
