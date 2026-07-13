import { describe, expect, it } from 'vitest';
import { applyThemeTokens, clearThemeTokens, parseThemeFile } from '../../src/services/themeSettings';

function fakeRoot(): { root: HTMLElement; values: Map<string, string> } {
  const values = new Map<string, string>();
  const root = {
    style: {
      setProperty: (key: string, value: string) => values.set(key, value),
      removeProperty: (key: string) => values.delete(key),
    },
  } as unknown as HTMLElement;
  return { root, values };
}

describe('theme token application', () => {
  it('applies a short graph palette across all hull slots', () => {
    const { root, values } = fakeRoot();
    const theme = parseThemeFile(JSON.stringify({
      version: 1,
      name: 'Short palette',
      tokens: { graphPalette: ['#111111', '#222222'] },
    }));

    applyThemeTokens(theme, root);

    expect(values.get('--graph-hull-0')).toBe('#111111');
    expect(values.get('--graph-hull-1')).toBe('#222222');
    expect(values.get('--graph-hull-7')).toBe('#222222');
  });

  it('clears custom inline variables so the stylesheet can take over', () => {
    const { root, values } = fakeRoot();
    const theme = parseThemeFile(JSON.stringify({ version: 1, name: 'Custom', tokens: {} }));
    applyThemeTokens(theme, root);
    expect(values.has('--bg')).toBe(true);
    expect(values.has('--graph-hull-7')).toBe(true);

    clearThemeTokens(root);

    expect(values.size).toBe(0);
  });
});
