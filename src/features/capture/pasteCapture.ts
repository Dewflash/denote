// src/features/capture/pasteCapture.ts — paste-to-capture v1 (pass-03 brief) + the shared
// "one-keystroke new note" helper (cmd-N). Native global capture reuses the same repository
// filing path rather than duplicating note naming or provenance logic.

import { useVaultStore } from '../../state/vaultStore';
import { useUiStore } from '../../state/uiStore';
import { EDITOR_ROOT_ATTR } from '../../app/keymap';
import { yamlScalar } from '../../domain/frontmatterText';
import { captureCurrentContext } from '../../services/nativeCapture';
import { newNoteBody } from './newNote';

const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/g;
const DEFAULT_INBOX = 'Inbox';
/** Paste-to-capture that's at least this long opens the on-device summarize review (pass 7/D27);
 *  shorter pastes file immediately as before. */
export const CAPTURE_SUMMARIZE_MIN_CHARS = 800;

export function sanitizeCaptureTitle(raw: string): string {
  return sanitizeTitle(raw);
}

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
  await useVaultStore.getState().createNote(relPath, newNoteBody(relPath));
  await useVaultStore.getState().setActiveNote(relPath, { cursorAtEnd: true });
}

/** Rename target for a note being moved into a new folder while keeping its basename. */
export function renameWithinFolder(oldRelPath: string, newBase: string): string {
  const dir = oldRelPath.includes('/') ? oldRelPath.slice(0, oldRelPath.lastIndexOf('/')) : '';
  return `${dir ? `${dir}/` : ''}${newBase}.md`;
}

/** Paste with nothing focused (file tree / capture surface) creates a note from the clipboard;
 *  title = first line, truncated. Always files into Inbox/ (a specific folder isn't implied by
 *  pasting into a list, unlike cmd-N which respects tree selection). */
export async function captureFromClipboard(clipboardText: string): Promise<void> {
  const text = clipboardText.trim();
  if (!text) return;
  // Large pastes: open the review modal for on-device title/summary/tags (D27) instead of filing
  // blind. The modal calls `fileCapture` on confirm.
  if (text.length >= CAPTURE_SUMMARIZE_MIN_CHARS) {
    useUiStore.getState().openCapture(text);
    return;
  }
  const title = sanitizeTitle(text);
  const relPath = uniquePath(DEFAULT_INBOX, title);
  const body = text.startsWith('#') ? `${text}\n` : `# ${title}\n\n${text}\n`;
  await useVaultStore.getState().createNote(relPath, body);
  await useVaultStore.getState().setActiveNote(relPath);
}

/** File a reviewed capture (from the paste-summarize modal): build a note with the chosen title,
 *  optional summary, and selected tags, then open it. */
export async function fileCapture(opts: {
  title: string;
  body: string;
  summary?: string;
  tags?: string[];
  folder?: string;
  sourceUrl?: string;
  sourceApp?: string;
  sourceTitle?: string;
  capturedAt?: string;
  vaultId?: string;
}): Promise<void> {
  const currentVaultId = useVaultStore.getState().vaultId;
  if (opts.vaultId && opts.vaultId !== currentVaultId) {
    await useVaultStore.getState().switchVault(opts.vaultId);
  }
  const title = sanitizeTitle(opts.title || 'Untitled');
  const relPath = uniquePath(opts.folder || DEFAULT_INBOX, title);
  const frontmatter = captureFrontmatter(opts);
  const parts = [...frontmatter, `# ${title}`, ''];
  if (opts.summary?.trim()) parts.push(`> ${opts.summary.trim()}`, '');
  parts.push(opts.body.trim(), '');
  if (opts.tags && opts.tags.length > 0) parts.push(opts.tags.map((t) => `#${t}`).join(' '), '');
  await useVaultStore.getState().createNote(relPath, parts.join('\n'));
  await useVaultStore.getState().setActiveNote(relPath);
}

export async function globalCaptureFromClipboard(): Promise<void> {
  await captureCurrentContext();
}

function captureFrontmatter(opts: {
  sourceUrl?: string;
  sourceApp?: string;
  sourceTitle?: string;
  capturedAt?: string;
}): string[] {
  const lines: string[] = [];
  if (!opts.sourceUrl && !opts.sourceApp && !opts.capturedAt) return lines;
  lines.push('---');
  if (opts.sourceUrl) lines.push(`source_url: ${yamlScalar(opts.sourceUrl)}`);
  if (opts.sourceApp) lines.push(`source_app: ${yamlScalar(opts.sourceApp)}`);
  if (opts.sourceTitle) lines.push(`source_title: ${yamlScalar(opts.sourceTitle)}`);
  lines.push(`captured_at: ${yamlScalar(opts.capturedAt ?? new Date().toISOString())}`);
  lines.push('---');
  return lines;
}

/** True when "nothing is focused" in the paste-capture sense: not a text input and not the
 *  CodeMirror editor (which handles its own paste). */
export function isPasteCaptureTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return false;
  return target.closest(`[${EDITOR_ROOT_ATTR}]`) === null;
}
