#!/usr/bin/env node
// scripts/gen-fixture-vault.mjs — pass-4 DoD: "Fixture vault (~200 notes, script-generated into
// a temp vault) renders." This is a SCALE/PERF fixture, not a semantic one — unlike
// tests/fixtures/vision-vault (the architect-authored corpus, never touch), this script
// generates a throwaway vault for manually exercising the graph view's performance budget
// (2,000 nodes / 6,000 edges target, pass-4 brief) and nested-folder hull rendering.
//
// Usage:
//   node scripts/gen-fixture-vault.mjs [outDir] [--notes=200]
// Then in the app: "Create vault" (or "Open vault" if outDir already has a vault) → pick outDir.
// outDir defaults to a fresh directory under the OS temp dir.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('--')) ?? join(tmpdir(), `denote-fixture-${Date.now()}`);
const noteCountArg = args.find((a) => a.startsWith('--notes='));
const NOTE_COUNT = noteCountArg ? Number(noteCountArg.split('=')[1]) : 200;

const FOLDERS = [
  'Finance',
  'Finance/Banking',
  'Finance/Markets',
  'Tech',
  'Tech/AI',
  'Tech/Web',
  'Japan',
  'Japan/Economics',
  'Journal',
  '', // vault root
];

const TAGS = ['finance', 'banking', 'japan', 'tech', 'ai', 'web', 'journal', 'markets', 'macro'];

// Deterministic PRNG (mulberry32) so repeated runs with the same seed are reproducible.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260710);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

function noteTitle(i) {
  return `Fixture Note ${String(i).padStart(4, '0')}`;
}

function relPathFor(i, folder) {
  const title = noteTitle(i);
  return folder ? `${folder}/${title}.md` : `${title}.md`;
}

const assignments = Array.from({ length: NOTE_COUNT }, (_, i) => ({
  i,
  folder: pick(FOLDERS),
}));
const relPaths = assignments.map((a) => relPathFor(a.i, a.folder));

for (const dir of new Set(FOLDERS.filter(Boolean))) {
  mkdirSync(join(outDir, dir), { recursive: true });
}
mkdirSync(outDir, { recursive: true });

for (const { i, folder } of assignments) {
  const title = noteTitle(i);
  // ~6 outbound links per note (targets biased toward already-created notes for realistic
  // backlink density) → roughly NOTE_COUNT * 6 wikilink edges, well past the 6,000-edge budget
  // once tag edges are added too.
  const linkCount = 3 + Math.floor(rand() * 6);
  const links = Array.from({ length: linkCount }, () => noteTitle(Math.floor(rand() * NOTE_COUNT))).filter(
    (t) => t !== title,
  );
  const tagCount = 1 + Math.floor(rand() * 3);
  const tags = Array.from({ length: tagCount }, () => pick(TAGS));

  const body = [
    `# ${title}`,
    '',
    `Generated fixture note in \`${folder || '(root)'}\` for graph-view scale testing (pass 4).`,
    '',
    `Tags: ${tags.map((t) => `#${t}`).join(' ')}`,
    '',
    'Related:',
    ...new Set(links.map((t) => `- [[${t}]]`)),
    '',
  ].join('\n');

  writeFileSync(join(outDir, relPathFor(i, folder)), body, 'utf8');
}

void relPaths; // computed for the summary below only

console.log(`Generated ${NOTE_COUNT} notes across ${new Set(FOLDERS).size} folders at:\n  ${outDir}`);
console.log('Open (or create) this folder as a vault in DeNote to manually check graph-view scale/perf.');
