/** Markdown body for a newly created note; files remain self-describing on disk. */
export function newNoteBody(relPath: string): string {
  const fileName = relPath.split('/').pop() ?? 'Untitled.md';
  const title = fileName.replace(/\.md$/i, '') || 'Untitled';
  return `# ${title}\n\n`;
}
