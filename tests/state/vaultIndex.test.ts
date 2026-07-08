import { describe, expect, it } from 'vitest';
import { VaultIndex } from '../../src/state/vaultIndex';
import { parseNote } from '../../src/domain/parser';

const note = (relPath: string, body = '# T\n') => parseNote(relPath, body);

describe('VaultIndex btime (S26 note-dates precedence)', () => {
  it('seeds btime from the first setNote call', () => {
    const idx = new VaultIndex('v1');
    idx.setNote(note('a.md'), 'h1', 1000, { btime: 500 });
    expect(idx.getBtime('a.md')).toBe(500);
  });

  it('falls back to mtime when no btime is given', () => {
    const idx = new VaultIndex('v1');
    idx.setNote(note('a.md'), 'h1', 1000);
    expect(idx.getBtime('a.md')).toBe(1000);
  });

  it('preserves the original btime across subsequent edits', () => {
    const idx = new VaultIndex('v1');
    idx.setNote(note('a.md'), 'h1', 1000, { btime: 500 });
    idx.setNote(note('a.md', '# T2\n'), 'h2', 2000, { btime: 1999 });
    expect(idx.getBtime('a.md')).toBe(500);
    expect(idx.mtimes.get('a.md')).toBe(2000);
  });

  it('clears btime when the note is removed', () => {
    const idx = new VaultIndex('v1');
    idx.setNote(note('a.md'), 'h1', 1000, { btime: 500 });
    idx.removeNote('a.md');
    expect(idx.getBtime('a.md')).toBeUndefined();
  });
});
