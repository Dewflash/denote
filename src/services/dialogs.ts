// src/services/dialogs.ts — native OS dialogs (D39: @tauri-apps/plugin-dialog). Kept in its own
// module (like tauriStorage.ts) so nothing else needs to import the Tauri runtime directly.

import { open } from '@tauri-apps/plugin-dialog';

/** Ask the user to pick a folder (vault root). Returns null if cancelled. */
export async function pickFolder(title: string): Promise<string | null> {
  const result = await open({ directory: true, multiple: false, title });
  return typeof result === 'string' ? result : null;
}
