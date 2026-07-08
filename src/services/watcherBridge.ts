// src/services/watcherBridge.ts — subscribes to the Rust `notify` watcher and forwards
// debounced events to a handler (the Repository). macOS delivers fs events coalesced and out
// of order, so we debounce per path (300ms, S7) and collapse a create+modify burst into the
// latest event kind before dispatching. The Rust side has already dropped ignored paths (S22).
//
// Kept in its own module (imports `@tauri-apps/api/event`) so the Repository and its tests
// never pull a Tauri runtime.

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { RawWatcherEvent, WatcherEventKind } from './storage';

/** Event name emitted by the Rust watcher (src-tauri/src/watcher.rs). */
export const FS_EVENT = 'denote://fs-event';

export const WATCH_DEBOUNCE_MS = 300;

interface WatcherPayload {
  root: string;
  relPath: string;
  kind: WatcherEventKind;
}

/**
 * Start forwarding watcher events for `root` to `onEvent`, debounced per path. Returns a
 * function that stops the subscription and clears pending timers.
 */
export async function startWatcherBridge(
  root: string,
  onEvent: (evt: RawWatcherEvent) => void,
  debounceMs = WATCH_DEBOUNCE_MS,
): Promise<() => void> {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pendingKind = new Map<string, WatcherEventKind>();

  const flush = (relPath: string): void => {
    timers.delete(relPath);
    const kind = pendingKind.get(relPath);
    pendingKind.delete(relPath);
    if (kind) onEvent({ relPath, kind });
  };

  const unlisten: UnlistenFn = await listen<WatcherPayload>(FS_EVENT, (e) => {
    const p = e.payload;
    if (p.root !== root) return;
    // A delete supersedes a pending create/modify for the same path; otherwise keep the
    // latest kind (create then modify collapses to modify — both re-index the same way).
    pendingKind.set(p.relPath, p.kind);
    const existing = timers.get(p.relPath);
    if (existing) clearTimeout(existing);
    timers.set(
      p.relPath,
      setTimeout(() => flush(p.relPath), debounceMs),
    );
  });

  return () => {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    pendingKind.clear();
    unlisten();
  };
}
