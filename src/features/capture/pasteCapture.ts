// src/features/capture/pasteCapture.ts — paste-to-capture v1 (pass-03 brief) + the shared
// "one-keystroke new note" helper (cmd-N). Global-hotkey capture (D27) arrives in pass 10 and
// will reuse `uniquePath`/`createUntitledNote` rather than duplicating the naming logic.

import { useVaultStore } from '../../state/vaultStore';
import { EDITOR_ROOT_ATTR } from '../../app/keymap';

const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/g;
const DEFAULT_INBOX = 'Inbox';

function sanitizeTitle(raw: string): string {
  const firstLine = raw.split(/\r?\n/, 1)[0]?.trim() ?? '';
  const cleaned = firstLine.replace(ILLEGAL_FILENAME_CHARS, ' ').replace(/\s+/g, ' ').trim();
  return (cleaned || 'Untitled').slice(0, 80);
}

/** Find a relPath under `dir` for `base` that doesn't collide with an existing note. */
function uniquePath(dir: string | null, base: string): string {
  const repo = useVaultStore.getState().repo;
  const existing = new Set(repo?.listNotePaths() ?? []);
  const prefix = dir ? `${dir}/` : '';
  let candidate = `${prefix}${base}.md`;
  let n = 1;
  while (existing.has(candidate)) {
    candidate = `${prefix}${base} ${n}.md`;
    n += 1;
  }
  return candidate;
}

/** cmd-N: untitled note in the selected folder, or `Inbox/` if none is selected. */
export async function createUntitledNote(folder: string | null): Promise<void> {
  const relPath = uniquePath(folder ?? DEFAULT_INBOX, 'Untitled');
  await useVaultStore.getState().createNote(relPath, '');
  await useVaultStore.getState().setActiveNote(relPath);
}

/** Rename target for a note being moved into a new folder while keeping its basename. */
export function renameWithinFolder(oldRelPath: string, newBase: string): string {
  const dir = oldRelPath.includes('/') ? oldRelPath.slice(0, oldRelPath.lastIndexOf('/')) : '';
  return `${dir ? `${dir}/` : ''}${newBase}.md`;
}

/** Paste with nothing focused (file tree / Today view) creates a note from the clipboard;
 *  title = first line, truncated. Always files into Inbox/ (a specific folder isn't implied by
 *  pasting into a list, unlike cmd-N which respects tree selection). */
export async function captureFromClipboard(clipboardText: string): Promise<void> {
  const text = clipboardText.trim();
  if (!text) return;
  const title = sanitizeTitle(text);
  const relPath = uniquePath(DEFAULT_INBOX, title);
  const body = text.startsWith('#') ? `${text}\n` : `# ${title}\n\n${text}\n`;
  await useVaultStore.getState().createNote(relPath, body);
  await useVaultStore.getState().setActiveNote(relPath);
}

/** True when "nothing is focused" in the paste-capture sense: not a text input and not the
 *  CodeMirror editor (which handles its own paste). */
export function isPasteCaptureTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return false;
  return target.closest(`[${EDITOR_ROOT_ATTR}]`) === null;
}
