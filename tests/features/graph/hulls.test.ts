import { describe, expect, it } from 'vitest';
import { buildFolderHulls, convexHull, folderOf, hullOutline, noteRelPath, type FolderNote } from '../../../src/features/graph/hulls';
import { paletteColor } from '../../../src/features/graph/layout';

describe('convexHull', () => {
  it('returns empty for fewer than 3 distinct points', () => {
    expect(convexHull([])).toEqual([]);
    expect(convexHull([{ x: 0, y: 0 }])).toEqual([]);
    expect(convexHull([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual([]);
  });

  it('wraps a square exactly', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const hull = convexHull(square);
    expect(hull).toHaveLength(4);
    for (const p of square) expect(hull).toContainEqual(p);
  });

  it('excludes interior points', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 }, // interior — must not appear in the hull
    ];
    const hull = convexHull(pts);
    expect(hull).not.toContainEqual({ x: 5, y: 5 });
    expect(hull).toHaveLength(4);
  });
});

describe('folderOf', () => {
  it('returns "" for root-level notes', () => {
    expect(folderOf('Note.md')).toBe('');
  });
  it('returns the dirname for nested notes', () => {
    expect(folderOf('Japan/Economics/Interest Rates.md')).toBe('Japan/Economics');
  });
});

const colorFor = (id: string, palette: readonly string[]) => paletteColor(id, palette);
const palette = ['#4e79a7', '#f28e2b', '#59a14f'];

describe('buildFolderHulls — vault→folder nesting', () => {
  const notes: FolderNote[] = [
    { nodeId: 'v/Japan/Japan.md', vaultId: 'v', relPath: 'Japan/Japan.md', x: 0, y: 0 },
    { nodeId: 'v/Japan/Yen.md', vaultId: 'v', relPath: 'Japan/Yen.md', x: 10, y: 0 },
    { nodeId: 'v/Japan/Sub/Deep.md', vaultId: 'v', relPath: 'Japan/Sub/Deep.md', x: 5, y: 10 },
    { nodeId: 'v/Tech/Local.md', vaultId: 'v', relPath: 'Tech/Local.md', x: -10, y: -10 },
  ];

  it('produces a hull group per folder level, including the vault root', () => {
    const groups = buildFolderHulls(notes, palette, colorFor);
    const ids = groups.map((g) => g.id);
    expect(ids).toContain('v::'); // vault root
    expect(ids).toContain('v::Japan');
    expect(ids).toContain('v::Japan/Sub');
    expect(ids).toContain('v::Tech');
  });

  it('a child folder point set is a subset of its parent (true nesting)', () => {
    const groups = buildFolderHulls(notes, palette, colorFor);
    const byId = new Map(groups.map((g) => [g.id, g]));
    const root = byId.get('v::')!;
    const japan = byId.get('v::Japan')!;
    const sub = byId.get('v::Japan/Sub')!;

    for (const p of sub.memberPoints) expect(japan.memberPoints).toContainEqual(p);
    for (const p of japan.memberPoints) expect(root.memberPoints).toContainEqual(p);
    expect(root.memberPoints.length).toBe(notes.length);
  });

  it('depth increases from vault root downward', () => {
    const groups = buildFolderHulls(notes, palette, colorFor);
    const byId = new Map(groups.map((g) => [g.id, g]));
    expect(byId.get('v::')!.depth).toBe(0);
    expect(byId.get('v::Japan')!.depth).toBe(1);
    expect(byId.get('v::Japan/Sub')!.depth).toBe(2);
  });

  it('does not create hull groups for empty intermediate folders beyond what notes touch', () => {
    const groups = buildFolderHulls(notes, palette, colorFor);
    expect(groups.every((g) => g.memberPoints.length > 0)).toBe(true);
  });

  it('is deterministic across calls (sorted output)', () => {
    const a = buildFolderHulls(notes, palette, colorFor);
    const b = buildFolderHulls(notes, palette, colorFor);
    expect(a.map((g) => g.id)).toEqual(b.map((g) => g.id));
  });
});

describe('hullOutline', () => {
  it('inflates a polygon outward from its centroid', () => {
    const group = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], memberPoints: [] };
    const outline = hullOutline(group, 5);
    expect(outline.kind).toBe('polygon');
    if (outline.kind === 'polygon') {
      // every inflated point should be farther from the centroid (5,5) than the original
      for (const p of outline.points) {
        expect(Math.hypot(p.x - 5, p.y - 5)).toBeGreaterThan(Math.hypot(5, 5) - 0.01);
      }
    }
  });

  it('falls back to a padded circle for a single-point group', () => {
    const group = { points: [], memberPoints: [{ x: 3, y: 4 }] };
    const outline = hullOutline(group, 10);
    expect(outline).toEqual({ kind: 'circle', cx: 3, cy: 4, r: 10 });
  });

  it('falls back to a padded circle covering both points for a 2-point group', () => {
    const group = { points: [], memberPoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }] };
    const outline = hullOutline(group, 2);
    expect(outline.kind).toBe('circle');
    if (outline.kind === 'circle') {
      expect(outline.cx).toBe(5);
      expect(outline.r).toBeCloseTo(7, 5);
    }
  });
});

describe('noteRelPath', () => {
  it('strips the vaultId prefix', () => {
    expect(noteRelPath('v/Japan/Japan.md', 'v')).toBe('Japan/Japan.md');
  });
  it('returns null when the id does not belong to the given vault', () => {
    expect(noteRelPath('other/Japan.md', 'v')).toBeNull();
  });
});
