// src/services — storage, watcher bridge, annotationStore, aiClient/{mock,apple,anthropic},
// embeddings bridge, searchIndex, keychain bridge. Orchestrates domain logic against Tauri/OS APIs.

export * from './storage';
export * from './errors';
export * from './snapshots';
export * from './themeSettings';
export * from './snippets';
export * from './migrations';
export * from './importer';
export * from './nativeCapture';
export * from './nativeGit';
export * from './nativeImport';
export * from './vaultRegistry';
export { tauriStorage } from './tauriStorage';
export { startWatcherBridge, FS_EVENT, WATCH_DEBOUNCE_MS } from './watcherBridge';
export { pickFolder } from './dialogs';
export { guessImageMime, loadAssetObjectUrl } from './assets';
export { appSupportRoot } from './appSupport';
export * from './searchIndex';
export * from './aiClient';
export * from './annotationStore';
export * from './appSupportStore';
export * from './spendLedger';
export * from './batchStore';
export * from './crossVaultStore';
export * from './keychain';
