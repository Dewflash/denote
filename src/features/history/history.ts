export type VersionEntry =
  | { id: string; kind: 'snapshot'; label: string; at: number; size: number; name: string }
  | { id: string; kind: 'git'; label: string; at: number; oid: string; summary: string };

export function lineDiff(current: string, older: string): string {
  if (current === older) return 'No textual differences.';
  const a = current.split(/\r?\n/);
  const b = older.split(/\r?\n/);
  const max = Math.max(a.length, b.length);
  const out: string[] = [];
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) out.push(`- ${a[i]}`);
    if (b[i] !== undefined) out.push(`+ ${b[i]}`);
    if (out.length > 120) {
      out.push('...');
      break;
    }
  }
  return out.join('\n');
}
