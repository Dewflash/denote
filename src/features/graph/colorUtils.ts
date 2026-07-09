// src/features/graph/colorUtils.ts — PURE. Canvas fillStyle needs literal rgba(); tokens.css
// gives us hex (or already-resolved) color strings, so this bridges the two for translucent
// paint (hulls, dashed/low-opacity AI edges — pass-4 brief's visual language).

function parseColor(color: string): [number, number, number] {
  const c = color.trim();
  if (c.startsWith('#')) {
    const hex = c.slice(1);
    const full = hex.length === 3 ? hex.split('').map((ch) => ch + ch).join('') : hex;
    const n = parseInt(full.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return [128, 128, 128]; // unparseable — neutral gray rather than throwing mid-paint
}

export function withAlpha(color: string, alpha: number): string {
  const [r, g, b] = parseColor(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
