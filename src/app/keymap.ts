// src/app/keymap.ts — the ONE keymap registry (S21). Every keyboard shortcut in the app is
// declared here, once, as a {id, combo, description}; features attach a handler to an id at
// runtime instead of listening for raw key combos themselves. Registering two bindings on the
// same combo is a programming error and throws immediately (build-time-ish: caught by the unit
// test over DEFAULT_BINDINGS, and by any future rebind going through `KeymapRegistry.bind`).
//
// Mac-only combos (D1): `cmd` = the Meta key. The registry owns rebinding so buttons, in-app
// keydown handling, and the native capture bridge all read the same live definition.

export type ComboString = string; // normalized, e.g. "cmd-n", "cmd-shift-f", "cmd-,"

export interface BindingDef {
  id: string;
  combo: ComboString;
  description: string;
}

/** S21 defaults. Every id is registered here once; Shell attaches the feature handlers at boot. */
export const DEFAULT_BINDINGS: readonly BindingDef[] = [
  { id: 'new-note', combo: 'cmd-n', description: 'New note' },
  { id: 'quick-switcher', combo: 'cmd-o', description: 'Quick switcher' },
  { id: 'command-palette', combo: 'cmd-p', description: 'Command palette' },
  { id: 'reading-view', combo: 'cmd-e', description: 'Toggle reading view' },
  { id: 'search', combo: 'cmd-shift-f', description: 'Search' },
  { id: 'find-in-note', combo: 'cmd-f', description: 'Find in note' },
  { id: 'replace-in-note', combo: 'cmd-alt-f', description: 'Replace in note' },
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

  /** Change one binding without losing its handler. Throws on unknown ids or collisions. */
  rebind(id: string, combo: ComboString): void {
    const current = this.byId.get(id);
    if (!current) throw new Error(`keymap: unknown binding id "${id}"`);
    if (current.combo === combo) return;
    const collision = this.byCombo.get(combo);
    if (collision && collision.id !== id) {
      throw new Error(`keymap: combo "${combo}" is already bound to "${collision.id}"`);
    }
    this.byCombo.delete(current.combo);
    const next: BindingDef = { ...current, combo };
    this.byCombo.set(combo, next);
    this.byId.set(id, next);
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

/** Human-readable Mac glyph form of a combo string, e.g. "cmd-shift-f" → "⌘⇧F". Used for
 *  tooltips on the visible affordance buttons (post-06 manual-testing fix: hotkey-only UX
 *  failed discoverability). */
export function formatCombo(combo: ComboString): string {
  const glyphs: Record<string, string> = { cmd: '⌘', shift: '⇧', alt: '⌥' };
  return combo
    .split('-')
    .map((part) => glyphs[part] ?? (part.length === 1 ? part.toUpperCase() : part))
    .join('');
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

/** The app's one keymap instance. Tests should construct their own registry. */
export const appKeymap = new KeymapRegistry();

const KEYMAP_STORAGE_KEY = 'denote:keymap';

export function restoreSavedKeymap(registry: KeymapRegistry): void {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEYMAP_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    for (const binding of registry.all()) {
      const combo = parsed[binding.id];
      if (typeof combo !== 'string' || combo === binding.combo) continue;
      try {
        registry.rebind(binding.id, combo);
      } catch {
        // Invalid or colliding saved definitions are ignored; defaults remain usable.
      }
    }
  } catch {
    // A malformed preference must never prevent the app from starting.
  }
}

export function persistKeymap(registry: KeymapRegistry): void {
  localStorage.setItem(KEYMAP_STORAGE_KEY, JSON.stringify(Object.fromEntries(registry.all().map((b) => [b.id, b.combo]))));
}

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
