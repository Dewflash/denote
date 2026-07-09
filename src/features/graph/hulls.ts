// src/features/graph/hulls.ts — PURE geometry for the structural-hulls overlay (D7: toggle,
// default OFF; vault→folder NESTED hulls, "AI never redraws structure" — this only reads note
// nodes' current positions and their relPath-derived folder, never AI/topic data).
//
// Nesting is achieved for free: a folder's point set is the union of its own notes plus every
// descendant folder's point set, so a child folder's convex hull is always a subset of (and
// visually sits inside) its parent's. Only real 'note' nodes participate — ghosts have no
// on-disk location to nest into, and are intentionally excluded from structural grouping.

export interface Point {
  x: number;
  y: number;
}

export interface HullGroup {
  /** `${vaultId}::${folderPath}` — folderPath is '' for the vault root. */
  id: string;
  vaultId: string;
  folderPath: string;
  /** Nesting depth: 0 = vault-level hull, 1 = top-level folder, etc. */
  depth: number;
  /** Convex hull polygon (empty if fewer than 3 member points; renderer pads a single point). */
  points: Point[];
  /** All member points, for renderers that want to draw a padded hull instead of the raw one. */
  memberPoints: Point[];
  color: string;
}

/** Andrew's monotone chain. Returns points in CCW order, duplicates-safe. Fewer than 3 distinct
 *  points ⇒ empty array (degenerate; caller decides how to render a point/line as a "hull"). */
export function convexHull(points: readonly Point[]): Point[] {
  const pts = [...new Map(points.map((p) => [`${p.x},${p.y}`, p])).values()].sort(
    (a, b) => a.x - b.x || a.y - b.y,
  );
  if (pts.length < 3) return [];

  const cross = (o: Point, a: Point, b: Point): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const buildHalf = (seq: Point[]): Point[] => {
    const hull: Point[] = [];
    for (const p of seq) {
      while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) {
        hull.pop();
      }
      hull.push(p);
    }
    return hull;
  };

  const lower = buildHalf(pts);
  const upper = buildHalf([...pts].reverse());
  lower.pop();
  upper.pop();
  const hull = [...lower, ...upper];
  return hull.length >= 3 ? hull : [];
}

export interface FolderNote {
  nodeId: string;
  vaultId: string;
  relPath: string;
  x: number;
  y: number;
}

/** Inverse of graphBuilder's `noteId` (`${vaultId}/${relPath}`) — vaultId never contains '/'
 *  (it's a uuid, D2), so a plain prefix strip is exact. */
export function noteRelPath(nodeId: string, vaultId: string): string | null {
  return nodeId.startsWith(`${vaultId}/`) ? nodeId.slice(vaultId.length + 1) : null;
}

export function folderOf(relPath: string): string {
  const idx = relPath.lastIndexOf('/');
  return idx === -1 ? '' : relPath.slice(0, idx);
}

/** Builds vault→folder nested hulls from current note positions. Deterministic ordering
 *  (sorted by id) so callers/tests get stable output regardless of Map iteration order. */
export function buildFolderHulls(
  notes: readonly FolderNote[],
  palette: readonly string[],
  colorFor: (id: string, palette: readonly string[]) => string,
): HullGroup[] {
  // groupId -> direct member points (this folder's own notes only)
  const direct = new Map<string, Point[]>();
  // groupId -> {vaultId, folderPath, depth, parentId}
  const meta = new Map<string, { vaultId: string; folderPath: string; depth: number; parentId: string | null }>();

  const ensureLineage = (vaultId: string, folderPath: string): void => {
    const segments = folderPath === '' ? [] : folderPath.split('/');
    let parentId: string | null = null;
    for (let depth = 0; depth <= segments.length; depth++) {
      const path = segments.slice(0, depth).join('/');
      const id = `${vaultId}::${path}`;
      if (!meta.has(id)) {
        meta.set(id, { vaultId, folderPath: path, depth, parentId });
        direct.set(id, []);
      }
      parentId = id;
    }
  };

  for (const note of notes) {
    const folderPath = folderOf(note.relPath);
    ensureLineage(note.vaultId, folderPath);
    const id = `${note.vaultId}::${folderPath}`;
    direct.get(id)!.push({ x: note.x, y: note.y });
  }

  // Bottom-up accumulation: a folder's full point set = its own + every child's full set.
  const full = new Map<string, Point[]>();
  const byDepthDesc = [...meta.entries()].sort((a, b) => b[1].depth - a[1].depth);
  for (const [id] of byDepthDesc) {
    const pts = [...(direct.get(id) ?? [])];
    for (const [childId, childMeta] of meta) {
      if (childMeta.parentId === id) pts.push(...(full.get(childId) ?? []));
    }
    full.set(id, pts);
  }

  const groups: HullGroup[] = [...meta.entries()]
    .filter(([id]) => (full.get(id) ?? []).length > 0)
    .map(([id, m]) => {
      const pts = full.get(id) ?? [];
      return {
        id,
        vaultId: m.vaultId,
        folderPath: m.folderPath,
        depth: m.depth,
        points: convexHull(pts),
        memberPoints: pts,
        color: colorFor(id, palette),
      };
    });

  return groups.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Padded outline for one hull group, for the canvas painter. A proper convex polygon is
 *  inflated outward from its centroid by `pad`; 1-2 point (degenerate) groups fall back to a
 *  circle big enough to cover their members plus the same padding — still reads as "a hull
 *  around this folder" without needing a real polygon. */
export type HullOutline = { kind: 'polygon'; points: Point[] } | { kind: 'circle'; cx: number; cy: number; r: number };

export function hullOutline(group: Pick<HullGroup, 'points' | 'memberPoints'>, pad: number): HullOutline {
  const pts = group.points.length >= 3 ? group.points : group.memberPoints;
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;

  if (group.points.length >= 3) {
    return {
      kind: 'polygon',
      points: group.points.map((p) => {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const dist = Math.hypot(dx, dy) || 1;
        const scale = (dist + pad) / dist;
        return { x: cx + dx * scale, y: cy + dy * scale };
      }),
    };
  }
  const r = Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy)), 0) + pad;
  return { kind: 'circle', cx, cy, r };
}
