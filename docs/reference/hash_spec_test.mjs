import { createHash } from 'node:crypto';

// ---- S1 candidate algorithm: normalization + ai:-block textual strip ----
function normalize(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);       // BOM
  text = text.replace(/\r\n?/g, '\n');                            // CRLF/CR -> LF
  return text.normalize('NFC');
}

function stripAiBlock(text) {
  const t = normalize(text);
  if (!t.startsWith('---\n')) return t;
  const lines = t.split('\n');
  // find closing delimiter: first line after 0 that is exactly '---' or '...'
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---' || lines[i] === '...') { close = i; break; }
  }
  if (close === -1) return t; // unterminated frontmatter -> treat as body
  const fm = lines.slice(1, close);
  // locate top-level `ai:` line
  let start = -1;
  for (let i = 0; i < fm.length; i++) {
    if (/^ai:(\s|$)/.test(fm[i])) { start = i; break; }
  }
  if (start === -1) return t;
  // block extends through indented lines; blank lines included only if a later
  // consecutive blank-run is followed by an indented line
  let end = start; // inclusive
  let i = start + 1;
  while (i < fm.length) {
    if (/^[ \t]/.test(fm[i])) { end = i; i++; continue; }
    if (fm[i] === '') { // lookahead across blank run
      let j = i;
      while (j < fm.length && fm[j] === '') j++;
      if (j < fm.length && /^[ \t]/.test(fm[j])) { end = j; i = j + 1; continue; }
    }
    break;
  }
  const remaining = [...fm.slice(0, start), ...fm.slice(end + 1)];
  const body = lines.slice(close + 1).join('\n');
  if (remaining.every(l => l === '')) return body;               // fm now empty -> drop delimiters
  return ['---', ...remaining, '---'].join('\n') + '\n' + body.replace(/^\n?/, m => m) ;
}

const hash = (s) => createHash('sha256').update(stripAiBlock(s), 'utf8').digest('hex');

// ---- test vectors ----
const cases = [];
const eq = (name, a, b) => cases.push([name, hash(a) === hash(b), hash(a).slice(0,12), hash(b).slice(0,12)]);
const neq = (name, a, b) => cases.push([name, hash(a) !== hash(b), hash(a).slice(0,12), hash(b).slice(0,12)]);

const body = '# Japan\n\nBanking notes.\n';

// V1: no frontmatter vs ai:-only frontmatter -> EQUAL (takeover on bare note keeps hash)
eq('V1 bare vs ai-only fm', body, `---\nai:\n  v: 1\n  tags: [finance]\n---\n${body}`);

// V2: ai block position irrelevant (first / middle / last key)
const fmA = `---\nai:\n  tags: [x]\ntitle: Japan\ndate: 2026-01-01\n---\n${body}`;
const fmB = `---\ntitle: Japan\nai:\n  tags: [x]\ndate: 2026-01-01\n---\n${body}`;
const fmC = `---\ntitle: Japan\ndate: 2026-01-01\nai:\n  tags: [x]\n---\n${body}`;
eq('V2a ai first vs middle', fmA, fmB);
eq('V2b ai middle vs last', fmB, fmC);

// V3: changing ai payload does not change hash
eq('V3 ai payload change', fmC, fmC.replace('[x]', '[x, y, z]'));

// V4: user frontmatter change DOES change hash
neq('V4 user fm change', fmC, fmC.replace('Japan', 'Nippon'));

// V5: body change DOES change hash
neq('V5 body change', fmC, fmC.replace('Banking', 'Cooking'));

// V6: CRLF vs LF -> EQUAL
eq('V6 crlf', body.replace(/\n/g, '\r\n'), body);

// V7: NFC vs NFD unicode -> EQUAL
eq('V7 nfc/nfd', '# Café\n', '# Café\n');

// V8: `ai:` inline form (ai: {tags: [x]}) stripped too
eq('V8 inline ai', body, `---\nai: {tags: [x]}\n---\n${body}`);

// V9: blank line INSIDE ai block still part of block
eq('V9 blank-in-block', `---\ntitle: T\n---\n${body}`,
   `---\ntitle: T\nai:\n  tags: [x]\n\n  links: [y]\n---\n${body}`);

// V10: user key named `aim:` or indented `  ai:` must NOT be stripped
neq('V10 aim key differs from absent', `---\naim: goals\n---\n${body}`, body);
const nested = `---\nmeta:\n  ai: userdata\n---\n${body}`;
neq('V10b nested ai kept', nested, body);

// V11: '#tag' in body unaffected (sanity: strip only touches frontmatter)
eq('V11 idempotent', stripAiBlock(fmC), stripAiBlock(stripAiBlock(fmC)));

// V12: unterminated frontmatter treated as body (no crash, no strip)
neq('V12 unterminated', `---\nai:\n  tags: [x]\n${body}`, body);

let fail = 0;
for (const [name, ok, a, b] of cases) { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${a} / ${b})`); }

// ---- S3 tag grammar quick check ----
const TAG = /(?<=^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gmu;
const tagCases = [
  ['see #finance and #nested/tag-2', ['finance', 'nested/tag-2']],
  ['#123 is not a tag', []],
  ['url http://x.com/#anchor stays', []],
  ['(#ok) punctuation', ['ok']],
  ['# heading not tag', []],
  ['end punctuation #tag.', ['tag']],
];
for (const [input, want] of tagCases) {
  const got = [...input.matchAll(TAG)].map(m => m[1]);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  tag: "${input}" -> ${JSON.stringify(got)}`);
}
console.log(fail === 0 ? '\nALL GREEN' : `\n${fail} FAILURES`);
