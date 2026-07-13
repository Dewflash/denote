import { isImportableTextFile } from '../../services/importer';
import { planIncomingImport } from '../../services/nativeImport';
import type { Repository } from '../../state/repository';
import type { ImportPlanItem } from '../../services/importer';

export interface DropImportResult {
  imported: number;
  exactSkipped: number;
  reviewItems: ImportPlanItem[];
  warnings: string[];
}

export async function importDroppedFiles(
  files: FileList | null,
  repo: Repository,
  createNote: (relPath: string, body?: string) => Promise<void>,
): Promise<DropImportResult> {
  const incoming = await Promise.all(
    [...(files ?? [])]
      .filter((file) => isImportableTextFile(file.name))
      .map(async (file) => ({ relPath: file.name, content: await file.text() })),
  );
  if (incoming.length === 0) throw new Error('Drop Markdown or text files onto the vault rail.');

  const plan = await planIncomingImport(repo, incoming);
  let imported = 0;
  for (const item of plan.items) {
    if (item.decision !== 'import') continue;
    await createNote(item.incoming.relPath, item.incoming.content);
    imported += 1;
  }
  return {
    imported,
    exactSkipped: plan.exactSkipped,
    reviewItems: plan.items.filter((item) => item.decision === 'review-near' || item.decision === 'warn-ai-key'),
    warnings: plan.warnings,
  };
}
