// src/features/graph/layout.ts — PURE, no React/canvas. Deterministic seeding so a reload's
// force layout "looks similar" (pass-4 brief pitfall): every node gets an initial x/y derived
// from a hash of its id, so d3-force never has to fall back to Math.random() for placement and
// the same graph shape produces the same starting arrangement every time.

/** FNV-1a, 32-bit. Also used for deterministic palette assignment (mirrors S17's topic-color
 *  hash so the same hashing convention is used everywhere colors are derived from an id). */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic pseudo-random unit-interval value from a string, independent of fnv1a's own
 *  bit distribution needs (a second hash so x/y don't correlate along one axis). */
function hash2(str: string): number {
  let h = 0x2545f491;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(h ^ str.charCodeAt(i), 0x85ebca6b) + 0x27d4eb2f) | 0;
  }
  return (h >>> 0) / 0xffffffff;
}

/** Deterministic initial position on a disc of the given radius, from the node id's hash. */
export function seedPosition(id: string, radius = 400): { x: number; y: number } {
  const angle = (fnv1a(id) / 0xffffffff) * Math.PI * 2;
  const r = Math.sqrt(hash2(id)) * radius; // sqrt for uniform disc density, not center-biased
  return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
}

/** Pick a stable palette entry for an id (S17 convention: fnv1a(id) % palette.length). */
export function paletteColor(id: string, palette: readonly string[]): string {
  if (palette.length === 0) return '#888888';
  return palette[fnv1a(id) % palette.length];
}
