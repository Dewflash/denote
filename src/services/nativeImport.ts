import { invoke } from '@tauri-apps/api/core';
import { parseNote } from '../domain';
import { planImport, type IncomingFile } from './importer';
import { createTauriEmbeddingsBackend, embedTextForNote } from './embeddings';
import type { Repository } from '../state/repository';

export function scanImportFolder(sourceRoot: string): Promise<IncomingFile[]> {
  return invoke<IncomingFile[]>('scan_import_folder', { sourceRoot });
}

export async function planIncomingImport(repo: Repository, incoming: IncomingFile[]) {
  const existing = await Promise.all(
    repo.listNotePaths().map(async (relPath) => {
      const content = await repo.readNote(relPath);
      return { relPath, content, parsed: parseNote(relPath, content) };
    }),
  );
  try {
    const backend = createTauriEmbeddingsBackend();
    const texts = [
      ...existing.map((note) => embedTextForNote(note.parsed ?? parseNote(note.relPath, note.content))),
      ...incoming.map((file) => embedTextForNote(parseNote(file.relPath, file.content))),
    ];
    const embedded = await backend.embed(texts);
    if (embedded.vectors.length !== texts.length) throw new Error('embedding backend returned an incomplete batch');
    const existingVectors = new Map(existing.map((note, index) => [note.relPath, embedded.vectors[index]]));
    const incomingVectors = new Map(incoming.map((file, index) => [file.relPath, embedded.vectors[existing.length + index]]));
    return planImport(existing, incoming, { existing: existingVectors, incoming: incomingVectors });
  } catch {
    const fallback = planImport(existing, incoming);
    fallback.warnings.unshift('Local embedding was unavailable; near-duplicate review used a deterministic text fallback.');
    return fallback;
  }
}

export async function planFolderImport(repo: Repository, sourceRoot: string) {
  const incoming = await scanImportFolder(sourceRoot);
  return planIncomingImport(repo, incoming);
}
