// src/features/graph/useGraphStyleTokens.ts — reads the D16 CSS-variable tokens into resolved
// color strings. Canvas 2D can't resolve `var(--x)` itself (unlike DOM/CSS), so this is the one
// place graph code bridges token → literal color; everything downstream stays token-driven in
// the sense that it never hardcodes a color, it reads tokens.css. Re-reads on theme/accent
// change (the only two live-swappable settings per uiStore).

import { useMemo } from 'react';
import { useUiStore } from '../../state/uiStore';
import type { GraphStyleTokens } from './types';

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function readTokens(): GraphStyleTokens {
  return {
    fontUi: cssVar('--font-ui'),
    noteFill: cssVar('--graph-node-note'),
    ghostStroke: cssVar('--graph-node-ghost'),
    tagFill: cssVar('--graph-node-tag'),
    topicFill: cssVar('--graph-node-topic'),
    edgeSolid: cssVar('--graph-edge-solid'),
    edgeAi: cssVar('--graph-edge-ai'),
    hullPalette: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => cssVar(`--graph-hull-${i}`)),
    bg: cssVar('--bg'),
    fg: cssVar('--fg'),
    fgMuted: cssVar('--fg-muted'),
    accent: cssVar('--accent'),
  };
}

const FALLBACK_TOKENS: GraphStyleTokens = {
  fontUi: '-apple-system, BlinkMacSystemFont, "Inter", "Helvetica Neue", Arial, sans-serif',
  noteFill: '#5b7cae',
  ghostStroke: '#9a9a94',
  tagFill: '#b07aa1',
  topicFill: '#f28e2b',
  edgeSolid: '#9a9a94',
  edgeAi: '#b5533c',
  hullPalette: ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#edc948', '#b07aa1', '#ff9da7', '#9c755f'],
  bg: '#ffffff',
  fg: '#1c1c1a',
  fgMuted: '#6b6b66',
  accent: '#3b6fd6',
};

export function useGraphStyleTokens(): GraphStyleTokens {
  // theme/accent are the only two settings that mutate CSS vars at runtime (uiStore) — reading
  // the DOM during render is a pure, side-effect-free query (no mutation), so this is computed
  // directly rather than via an effect+state round trip.
  const theme = useUiStore((s) => s.theme);
  const accent = useUiStore((s) => s.accent);
  return useMemo(
    () => (typeof document === 'undefined' ? FALLBACK_TOKENS : readTokens()),
    // theme/accent aren't read directly — they're the trigger for re-reading the DOM, same
    // "revision is the deliberate re-derive signal" pattern as vaultStore consumers elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, accent],
  );
}
