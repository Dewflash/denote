// src/services/themeSettings.ts — pass-10 theme JSON import/export helpers (D16).
// The UI still applies tokens as CSS variables; this module owns the portable file shape.

export interface ThemeTokens {
  bg: string;
  bgPanel: string;
  fg: string;
  fgMuted: string;
  accent: string;
  border: string;
  danger: string;
  graphNodeNote: string;
  graphNodeGhost: string;
  graphNodeTag: string;
  graphNodeTopic: string;
  graphEdgeSolid: string;
  graphEdgeAi: string;
  graphPalette: string[];
}

export interface ThemeFile {
  version: 1;
  name: string;
  tokens: ThemeTokens;
}

export const DEFAULT_LIGHT_THEME: ThemeFile = {
  version: 1,
  name: 'Default Light',
  tokens: {
    bg: '#ffffff',
    bgPanel: '#f5f5f4',
    fg: '#1c1c1a',
    fgMuted: '#6b6b66',
    accent: '#3b6fd6',
    border: '#e2e1dd',
    danger: '#c0392b',
    graphNodeNote: '#5b7cae',
    graphNodeGhost: '#9a9a94',
    graphNodeTag: '#b07aa1',
    graphNodeTopic: '#f28e2b',
    graphEdgeSolid: '#9a9a94',
    graphEdgeAi: '#b5533c',
    graphPalette: ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#edc948', '#b07aa1', '#ff9da7', '#9c755f'],
  },
};

export const DEFAULT_DARK_THEME: ThemeFile = {
  version: 1,
  name: 'Default Dark',
  tokens: {
    ...DEFAULT_LIGHT_THEME.tokens,
    bg: '#1a1a19',
    bgPanel: '#232322',
    fg: '#e8e7e3',
    fgMuted: '#93928c',
    accent: '#6f9bef',
    border: '#33332f',
    danger: '#ff7666',
    graphNodeNote: '#7fa0d4',
    graphNodeGhost: '#6f6f68',
    graphEdgeSolid: '#6f6f68',
  },
};

export const FOCUS_LIGHT_THEME: ThemeFile = {
  version: 1,
  name: 'Focus Light',
  tokens: {
    ...DEFAULT_LIGHT_THEME.tokens,
    bg: '#fbfbf8',
    bgPanel: '#eef2ef',
    fg: '#20251f',
    fgMuted: '#697068',
    accent: '#2f7a68',
    border: '#d7ded7',
    graphNodeNote: '#4d7c8a',
    graphNodeTag: '#8b6f47',
    graphNodeTopic: '#8a5f99',
    graphEdgeAi: '#b0653b',
  },
};

export const FOCUS_DARK_THEME: ThemeFile = {
  version: 1,
  name: 'Focus Dark',
  tokens: {
    ...DEFAULT_DARK_THEME.tokens,
    bg: '#171a18',
    bgPanel: '#222821',
    fg: '#e7ece5',
    fgMuted: '#96a096',
    accent: '#60b39e',
    border: '#354037',
    graphNodeNote: '#80aeb8',
    graphNodeTag: '#c59f65',
    graphNodeTopic: '#bd91cb',
    graphEdgeAi: '#d6845b',
  },
};

export const BUNDLED_THEMES = [
  DEFAULT_LIGHT_THEME,
  DEFAULT_DARK_THEME,
  FOCUS_LIGHT_THEME,
  FOCUS_DARK_THEME,
] as const;

const HEX = /^#[0-9a-f]{6}$/i;

export function parseThemeFile(json: string): ThemeFile {
  const parsed = JSON.parse(json) as Partial<ThemeFile>;
  if (parsed.version !== 1) throw new Error('unsupported theme version');
  if (typeof parsed.name !== 'string' || parsed.name.trim() === '') throw new Error('theme name is required');
  const tokens = parsed.tokens as Partial<ThemeTokens> | undefined;
  if (!tokens) throw new Error('theme tokens are required');
  const merged: ThemeTokens = { ...DEFAULT_LIGHT_THEME.tokens, ...tokens };
  for (const [key, value] of Object.entries(merged)) {
    if (key === 'graphPalette') continue;
    if (typeof value !== 'string' || !HEX.test(value)) throw new Error(`invalid color token: ${key}`);
  }
  if (!Array.isArray(merged.graphPalette) || merged.graphPalette.length < 2 || !merged.graphPalette.every((v) => HEX.test(v))) {
    throw new Error('graphPalette must contain hex colors');
  }
  return { version: 1, name: parsed.name.trim(), tokens: merged };
}

export function serializeThemeFile(theme: ThemeFile): string {
  return JSON.stringify(parseThemeFile(JSON.stringify(theme)), null, 2) + '\n';
}

const THEME_CSS_KEYS = [
  '--bg',
  '--bg-panel',
  '--fg',
  '--fg-muted',
  '--accent',
  '--border',
  '--danger',
  '--graph-node-note',
  '--graph-node-ghost',
  '--graph-node-tag',
  '--graph-node-topic',
  '--graph-edge-solid',
  '--graph-edge-ai',
  ...Array.from({ length: 8 }, (_, i) => `--graph-hull-${i}`),
] as const;

/** Remove only the inline variables owned by a custom theme so the stylesheet or explicit
 * light/dark theme can become authoritative again. */
export function clearThemeTokens(root: HTMLElement = document.documentElement): void {
  for (const key of THEME_CSS_KEYS) root.style.removeProperty(key);
}

export function applyThemeTokens(theme: ThemeFile, root: HTMLElement = document.documentElement): void {
  const t = theme.tokens;
  const pairs: Array<[string, string]> = [
    ['--bg', t.bg],
    ['--bg-panel', t.bgPanel],
    ['--fg', t.fg],
    ['--fg-muted', t.fgMuted],
    ['--accent', t.accent],
    ['--border', t.border],
    ['--danger', t.danger],
    ['--graph-node-note', t.graphNodeNote],
    ['--graph-node-ghost', t.graphNodeGhost],
    ['--graph-node-tag', t.graphNodeTag],
    ['--graph-node-topic', t.graphNodeTopic],
    ['--graph-edge-solid', t.graphEdgeSolid],
    ['--graph-edge-ai', t.graphEdgeAi],
  ];
  for (let i = 0; i < 8; i++) {
    pairs.push([`--graph-hull-${i}`, t.graphPalette[i % t.graphPalette.length]]);
  }
  for (const [key, value] of pairs) root.style.setProperty(key, value);
}
