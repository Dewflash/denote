import { describe, expect, it } from 'vitest';
import { withAlpha } from '../../../src/features/graph/colorUtils';

describe('withAlpha', () => {
  it('converts a 6-digit hex to rgba', () => {
    expect(withAlpha('#4e79a7', 0.5)).toBe('rgba(78, 121, 167, 0.5)');
  });
  it('handles 3-digit hex', () => {
    expect(withAlpha('#fff', 1)).toBe('rgba(255, 255, 255, 1)');
  });
  it('falls back to gray for unparseable input rather than throwing', () => {
    expect(() => withAlpha('not-a-color', 0.5)).not.toThrow();
  });
});
