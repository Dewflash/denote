// src/app/keymap.ts — the ONE keymap registry (S21). Every keyboard shortcut in the app is
// declared here, once, as a {id, combo, description}; features attach a handler to an id at
// runtime instead of listening for raw key combos themselves. Registering two bindings on the
// same combo is a programming error and throws immediately (build-time-ish: caught by the unit
// test over DEFAULT_BINDINGS, and by any future rebind going through `KeymapRegistry.bind`).
//
// Mac-only combos (D1): `cmd` = the Meta key. Rebinding in Settings → Hotkeys is future scope
// (S21 says "all rebindable"); this pass ships the registry + the read-only Hotkeys listing.

export type ComboString = string; // normalized, e.g. "cmd-n", "cmd-shift-f", "cmd-,"

export interface BindingDef {
  id: string;
  combo: ComboString;
  description: string;
}

/** S21 defaults. Some ids have no handler wired yet in this pass (later passes own them):
 *  `quick-switcher` (pass 5), `search` (pass 5), `global-capture` (pass 10), `graph-view`
 *  (pass 4). They are still registered so their combos can never collide with anything else. */
export const DEFAULT_BINDINGS: readonly BindingDef[] = [
  { id: 'new-note', combo: 'cmd-n', description: 'New note' },
  { id: 'quick-switcher', combo: 'cmd-o', description: 'Quick switcher' },
  { id: 'command-palette', combo: 'cmd-p', description: 'Command palette' },
  { id: 'reading-view', combo: 'cmd-e', description: 'Toggle reading view' },
  { id: 'today-view', combo: 'cmd-t', description: 'Today view' },
  { id: 'search', combo: 'cmd-shift-f', description: 'Search' },
  // Architect fix (post-checkpoint-B manual testing): cmd-F aliases global search until an
  // in-note find exists (pass 10 may rebind cmd-F to in-note find per S21).
  { id: 'search-alias', combo: 'cmd-f', description: 'Search (alias)' },
  { id: 'settings', combo: 'cmd-,', description: 'Settings' },
  { id: 'global-capture', combo: 'cmd-shift-n', description: 'Global capture (system-wide)' },
  { id: 'graph-view', combo: 'cmd-g', description: 'Graph view' },
  {
    id: 'undo',
    combo: 'cmd-z',
    description: 'Undo (repository op-log; the editor uses its own history while focused)',
  },
] as const;

export class KeymapRegistry {
  private readonly byCombo = new Map<ComboString, BindingDef>();
  private readonly byId = new Map<string, BindingDef>();
  private readonly handlers = new Map<string, () => void>();

  constructor(defaults: readonly BindingDef[] = DEFAULT_BINDINGS) {
    for (const b of defaults) this.registerBinding(b.id, b.combo, b.description);
  }

  /** Register a new binding. Throws if the combo (or id) is already taken. */
  registerBinding(id: string, combo: ComboString, description: string): void {
    if (this.byCombo.has(combo)) {
      throw new Error(`keymap: combo "${combo}" is already bound to "${this.byCombo.get(combo)!.id}"`);
    }
    if (this.byId.has(id)) {
      throw new Error(`keymap: id "${id}" is already registered`);
    }
    const def: BindingDef = { id, combo, description };
    this.byCombo.set(combo, def);
    this.byId.set(id, def);
  }

  /** Attach (or replace) the runtime handler for a registered id. */
  setHandler(id: string, handler: () => void): void {
    if (!this.byId.has(id)) throw new Error(`keymap: unknown binding id "${id}"`);
    this.handlers.set(id, handler);
  }

  clearHandler(id: string): void {
    this.handlers.delete(id);
  }

  lookupByCombo(combo: ComboString): BindingDef | undefined {
    return this.byCombo.get(combo);
  }

  hasHandler(id: string): boolean {
    return this.handlers.has(id);
  }

  all(): readonly BindingDef[] {
    return [...this.byId.values()];
  }

  /** Run the handler for `id` if one is attached. Returns whether it ran. */
  invoke(id: string): boolean {
    const fn = this.handlers.get(id);
    if (!fn) return false;
    fn();
    return true;
  }
}

/** The minimal shape `comboFromEvent` needs — a real `KeyboardEvent` satisfies this structurally,
 *  which keeps this module (and its unit tests) independent of a DOM environment. */
export interface KeyChord {
  key: string;
  metaKey: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/** Normalize a key chord into a combo string, or null if it isn't a `cmd`-chord (D1: Mac-first). */
export function comboFromEvent(e: KeyChord): ComboString | null {
  if (!e.metaKey) return null;
  const parts = ['cmd'];
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  parts.push(e.key.toLowerCase());
  return parts.join('-');
}

/** The attribute marking the CodeMirror editor's DOM root (S23: `cmd-z` inside the editor is
 *  CM's own typing history, not the repository op-log). */
export const EDITOR_ROOT_ATTR = 'data-denote-editor-root';

function isInsideEditor(target: EventTarget | null): boolean {
  return target instanceof Element ? target.closest(`[${EDITOR_ROOT_ATTR}]`) !== null : false;
}

/** The app's one keymap instance (App.tsx wires handlers into it; Settings → Hotkeys lists it
 *  read-only). Tests should construct their own `KeymapRegistry` rather than sharing this. */
export const appKeymap = new KeymapRegistry();

/** Install the single global keydown listener. Returns a teardown function. */
export function installGlobalKeymap(registry: KeymapRegistry): () => void {
  const onKeyDown = (e: KeyboardEvent): void => {
    const combo = comboFromEvent(e);
    if (!combo) return;
    const binding = registry.lookupByCombo(combo);
    if (!binding) return;
    if (binding.id === 'undo' && isInsideEditor(e.target)) return; // CM history owns this chord
    if (!registry.hasHandler(binding.id)) return;
    e.preventDefault();
    registry.invoke(binding.id);
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
