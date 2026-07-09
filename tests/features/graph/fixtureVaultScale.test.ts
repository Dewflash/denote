// tests/features/graph/fixtureVaultScale.test.ts — pass-4 DoD: "Fixture vault (~200 notes,
// script-generated into a temp vault) renders." This can't literally drive the Tauri webview
// (same tooling gap as pass 3 — see PROGRESS.md), so it's the automated proxy: run the real
// generator script, parse every file with the real domain parser, and run the real graph
// pipeline (buildGraph + buildFolderHulls) over the result, asserting it completes cleanly and
// at a size in the right ballpark for the pass's perf-budget discussion.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNote } from '../../../src/domain/parser';
import { buildGraph } from '../../../src/domain/graphBuilder';
import { buildFolderHulls, type FolderNote } from '../../../src/features/graph/hulls';
import { seedPosition } from '../../../src/features/graph/layout';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

function walk(dir: string, root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      out.push(...walk(abs, root));
      continue;
    }
    if (entry.endsWith('.md')) out.push(abs.slice(root.length + 1).split('\\').join('/'));
  }
  return out;
}

describe('fixture vault generator — scale/perf proxy (pass 4)', () => {
  it('generates ~200 parseable, interlinked notes that build a graph without throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'denote-fixture-test-'));
    try {
      execFileSync('node', [join(repoRoot, 'scripts/gen-fixture-vault.mjs'), dir], { stdio: 'pipe' });

      const relPaths = walk(dir, dir);
      expect(relPaths.length).toBe(200);

      const notes = relPaths.map((relPath) => parseNote(relPath, readFileSync(join(dir, relPath), 'utf8')));
      expect(notes.every((n) => n.warnings.length === 0)).toBe(true);
      expect(notes.every((n) => n.title.startsWith('Fixture Note'))).toBe(true);

      const start = performance.now();
      const graph = buildGraph({ vaults: [{ vaultId: 'perf', notes }] });
      const elapsedMs = performance.now() - start;

      const noteNodes = graph.nodes.filter((n) => n.type === 'note');
      expect(noteNodes).toHaveLength(200);
      // Wikilinks are randomly generated (mulberry32-seeded) so exact counts vary by RNG output,
      // not by hand-tuning here — just assert the fixture is meaningfully interlinked.
      const wikilinkEdges = graph.edges.filter((e) => e.type === 'wikilink');
      expect(wikilinkEdges.length).toBeGreaterThan(400);
      const tagEdges = graph.edges.filter((e) => e.type === 'note-tag');
      expect(tagEdges.length).toBeGreaterThan(100);

      // Generous bound — this is a smoke check against a pathological O(n^2) regression, not a
      // benchmark (CI machines vary); the real perf question (60fps canvas interaction) needs
      // the owner's manual pass per PROGRESS.md.
      expect(elapsedMs).toBeLessThan(5000);

      // Folder hulls (structural overlay) must handle the full fixture without throwing, and
      // nested folders (Finance/Banking under Finance) must actually nest.
      const folderNotes: FolderNote[] = noteNodes.map((n) => {
        const relPath = String(n.id).slice('perf/'.length);
        const { x, y } = seedPosition(String(n.id));
        return { nodeId: String(n.id), vaultId: 'perf', relPath, x, y };
      });
      const hulls = buildFolderHulls(folderNotes, ['#4e79a7'], () => '#4e79a7');
      const byId = new Map(hulls.map((h) => [h.id, h]));
      expect(byId.has('perf::Finance')).toBe(true);
      expect(byId.has('perf::Finance/Banking')).toBe(true);
      for (const p of byId.get('perf::Finance/Banking')!.memberPoints) {
        expect(byId.get('perf::Finance')!.memberPoints).toContainEqual(p);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);
});
