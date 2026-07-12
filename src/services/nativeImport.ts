import { invoke } from '@tauri-apps/api/core';
import { parseNote } from '../domain';
import { planImport, type IncomingFile } from './importer';
import type { Repository } from '../state/repository';

export function scanImportFolder(sourceRoot: string): Promise<IncomingFile[]> {
  return invoke<IncomingFile[]>('scan_import_folder', { sourceRoot });
}

export async function planFolderImport(repo: Repository, sourceRoot: string) {
  const incoming = await scanImportFolder(sourceRoot);
  const existing = await Promise.all(
    repo.listNotePaths().map(async (relPath) => {
      const content = await repo.readNote(relPath);
      return { relPath, content, parsed: parseNote(relPath, content) };
    }),
  );
  return planImport(existing, incoming);
}
