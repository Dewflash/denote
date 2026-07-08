// src/services — storage, watcher bridge, annotationStore, aiClient/{mock,apple,anthropic},
// embeddings bridge, searchIndex, keychain bridge. Orchestrates domain logic against Tauri/OS APIs.

export * from './storage';
export * from './errors';
export * from './snapshots';
export { tauriStorage } from './tauriStorage';
export { startWatcherBridge, FS_EVENT, WATCH_DEBOUNCE_MS } from './watcherBridge';
