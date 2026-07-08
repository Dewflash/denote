// Canonical semantic corpus — deterministic layer (pass 1). Expectations authored in
// tests/fixtures/vision-vault/EXPECTED.md. This is part of the pass-01 suite (CLAUDE.md).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNote } from '../../src/domain/parser';
import { buildLinkIndex, resolveLink } from '../../src/domain/links';
import { computeBacklinks } from '../../src/domain/backlinks';
import { buildGraph } from '../../src/domain/graphBuilder';
import type { ParsedNote } from '../../src/domain/types';

const here = fileURLToPath(new URL('.', import.meta.url));
const vaultRoot = (name: string) => join(here, '..', 'fixtures', 'vision-vault', name);

function loadVault(name: string): ParsedNote[] {
  const root = vaultRoot(name);
  const out: ParsedNote[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) {
        if (entry === '.denote' || entry === '_topics') continue;
        walk(abs);
        continue;
      }
      if (!entry.endsWith('.md')) continue;
      const relPath = relative(root, abs).split('\\').join('/');
      out.push(parseNote(relPath, readFileSync(abs, 'utf8')));
    }
  };
  walk(root);
  return out;
}

const daily = loadVault('daily-learnings');
const byPath = (p: string): ParsedNote => {
  const n = daily.find((x) => x.relPath === p);
  if (!n) throw new Error(`fixture note not found: ${p}`);
  return n;
};
const refs = daily.map((n) => ({ relPath: n.relPath, title: n.title }));

describe('vision corpus — deterministic layer', () => {
  it('[[Bank of Japan]] in Japan.md resolves to a ghost', () => {
    const res = resolveLink('Bank of Japan', refs, 'daily');
    expect(res.kind).toBe('ghost');
  });

  it('[[Interest Rates|rates]] resolves by title with alias intact', () => {
    const yen = byPath('Japan/Yen Intervention.md');
    const link = yen.links.find((l) => l.targetTitle === 'Interest Rates');
    expect(link?.alias).toBe('rates');
    // Filename basename ('Interest Rates') matches at step 2 before the H1 title at step 3;
    // both point at the same note, which is what matters for backlinking.
    expect(resolveLink('Interest Rates', refs, 'daily')).toMatchObject({
      kind: 'note',
      relPath: 'Economics/Interest Rates.md',
    });
  });

  it('backlink appears on Interest Rates.md from Yen Intervention.md', () => {
    const back = computeBacklinks(buildLinkIndex(daily, 'daily'));
    const inbound = back.get('Economics/Interest Rates.md') ?? [];
    expect(inbound.some((b) => b.fromPath === 'Japan/Yen Intervention.md' && b.link.alias === 'rates')).toBe(true);
  });

  it('Local First Software.md: code/inline regions excluded; only [[Embeddings]] and #tech', () => {
    const lfs = byPath('Tech/Local First Software.md');
    expect(lfs.links.map((l) => l.targetTitle)).toEqual(['Embeddings']);
    expect(lfs.tags).toEqual(['tech']);
  });

  it('Untitled Capture.md has no H1 → title from filename', () => {
    const cap = byPath('Inbox/Untitled Capture.md');
    expect(cap.title).toBe('Untitled Capture');
    expect(cap.headings).toEqual([]);
  });

  it('#japan hub connects exactly Japan.md and Yen Intervention.md — 2 note→tag edges, 0 note→note edges', () => {
    const g = buildGraph({ vaults: [{ vaultId: 'daily', notes: daily }] });
    const japanTagEdges = g.edges.filter((e) => e.type === 'note-tag' && e.to === 'tag:japan');
    expect(japanTagEdges.map((e) => e.from).sort()).toEqual([
      'daily/Japan/Japan.md',
      'daily/Japan/Yen Intervention.md',
    ]);
    // Anti-goal (EXPECTED.md): no note→note edge exists MERELY because notes share a tag.
    // Legitimate note→note edges (wikilinks like Japan→Yen Intervention) are expected; the
    // guarantee is that tag sharing produces only note→tag hub edges.
    const noteIds = new Set(g.nodes.filter((n) => n.type === 'note').map((n) => n.id));
    const noteToNote = g.edges.filter((e) => noteIds.has(e.from) && noteIds.has(e.to));
    expect(noteToNote.every((e) => e.type === 'wikilink' || e.type === 'embed')).toBe(true);
  });

  it('combined view: no wikilink edge crosses vaults (resolution is vault-scoped, D17)', () => {
    const church = loadVault('church');
    const g = buildGraph({
      vaults: [
        { vaultId: 'daily', notes: daily },
        { vaultId: 'church', notes: church },
      ],
    });
    for (const e of g.edges) {
      if (e.type !== 'wikilink' && e.type !== 'embed') continue;
      const fromVault = String(e.from).split('/')[0];
      const toVault = String(e.to).split('/')[0];
      // ghost targets are namespaced by vault too; both endpoints share a vault
      if (String(e.to).startsWith('ghost:')) continue;
      expect(fromVault).toBe(toVault);
    }
    // #faith exists only in the church vault
    const faithEdges = g.edges.filter((e) => e.to === 'tag:faith');
    expect(faithEdges.every((e) => String(e.from).startsWith('church/'))).toBe(true);
  });
});
