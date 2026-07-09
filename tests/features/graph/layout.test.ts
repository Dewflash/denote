import { describe, expect, it } from 'vitest';
import { fnv1a, paletteColor, seedPosition } from '../../../src/features/graph/layout';

describe('graph layout — deterministic seeding', () => {
  it('fnv1a is deterministic and varies with input', () => {
    expect(fnv1a('a')).toBe(fnv1a('a'));
    expect(fnv1a('a')).not.toBe(fnv1a('b'));
  });

  it('seedPosition is deterministic for the same id', () => {
    const a = seedPosition('daily/Japan/Japan.md');
    const b = seedPosition('daily/Japan/Japan.md');
    expect(a).toEqual(b);
  });

  it('seedPosition differs across ids (no collapse to origin)', () => {
    const a = seedPosition('note-a');
    const b = seedPosition('note-b');
    expect(a).not.toEqual(b);
  });

  it('seedPosition stays within the requested radius', () => {
    for (const id of ['x', 'y', 'a-long-relpath/with/nesting.md', '']) {
      const { x, y } = seedPosition(id, 100);
      expect(Math.hypot(x, y)).toBeLessThanOrEqual(100 + 1e-9);
    }
  });

  it('paletteColor picks a stable, in-range entry', () => {
    const palette = ['#111', '#222', '#333'];
    const c1 = paletteColor('topic:finance', palette);
    const c2 = paletteColor('topic:finance', palette);
    expect(c1).toBe(c2);
    expect(palette).toContain(c1);
  });

  it('paletteColor handles an empty palette without throwing', () => {
    expect(paletteColor('x', [])).toBe('#888888');
  });
});
