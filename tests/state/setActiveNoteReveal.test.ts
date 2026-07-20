// tests/state/setActiveNoteReveal.test.ts — owner-reported UX bug (2026-07-13): with the graph
// view open, clicking a note in the file tree updated activeNote invisibly (CenterPane still
// rendered GraphPage), so the click appeared dead. Fix: setActiveNote REVEALS the editor
// (closes the graph overlay) by default; GraphPage's cmd-click passes `reveal: false`
// because it manages graph visibility itself (pass-04 behavior: cmd-click keeps the graph open).
//
// vaultStore's module graph pulls in uiStore/graphStore, which read localStorage + document at
// import time (browser-only). Vitest runs in node, so minimal stubs are installed BEFORE the
// dynamic import — same "stub the boundary, test the real store" approach the service tests use.

import { beforeAll, describe, expect, it } from 'vitest';

type VaultStoreModule = typeof import('../../src/state/vaultStore');
type UiStoreModule = typeof import('../../src/state/uiStore');

let vaultStore: VaultStoreModule;
let uiStore: UiStoreModule;

beforeAll(async () => {
  const backing = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  };
  (globalThis as Record<string, unknown>).document = {
    documentElement: {
      setAttribute: () => {},
      removeAttribute: () => {},
      style: { setProperty: () => {}, removeProperty: () => {} },
    },
  };
  vaultStore = await import('../../src/state/vaultStore');
  uiStore = await import('../../src/state/uiStore');
});

/** The minimal Repository surface setActiveNote touches. */
function fakeRepo(notes: Record<string, string>) {
  return {
    readNote: (relPath: string) => Promise.resolve(notes[relPath] ?? ''),
    saveNote: () => Promise.resolve(),
  } as unknown as import('../../src/state/repository').Repository;
}

describe('setActiveNote reveals the editor (owner UX finding, 2026-07-13)', () => {
  it('closes the graph overlay when a note is opened', async () => {
    vaultStore.useVaultStore.setState({ repo: fakeRepo({ 'a.md': '# A' }), buffer: null });
    const ui = uiStore.useUiStore.getState();
    ui.setGraphViewOpen(true);

    await vaultStore.useVaultStore.getState().setActiveNote('a.md');

    expect(vaultStore.useVaultStore.getState().activeNotePath).toBe('a.md');
    expect(uiStore.useUiStore.getState().graphViewOpen).toBe(false);
  });

  it('reveal: false leaves the graph open (GraphPage cmd-click contract)', async () => {
    vaultStore.useVaultStore.setState({ repo: fakeRepo({ 'b.md': '# B' }), buffer: null });
    uiStore.useUiStore.getState().setGraphViewOpen(true);

    await vaultStore.useVaultStore.getState().setActiveNote('b.md', { reveal: false });

    expect(vaultStore.useVaultStore.getState().activeNotePath).toBe('b.md');
    expect(uiStore.useUiStore.getState().graphViewOpen).toBe(true);
  });

  it('closing a note (null) never touches the overlays', async () => {
    vaultStore.useVaultStore.setState({ repo: fakeRepo({}), buffer: null });
    uiStore.useUiStore.getState().setGraphViewOpen(true);

    await vaultStore.useVaultStore.getState().setActiveNote(null);

    expect(uiStore.useUiStore.getState().graphViewOpen).toBe(true);
  });
});
