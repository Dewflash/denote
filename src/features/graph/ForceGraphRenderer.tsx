// src/features/graph/ForceGraphRenderer.tsx — first concrete implementation of the GraphView
// contract (D25): react-force-graph, canvas 2D, custom paint for hulls. Swapping renderers
// later means writing a new component against `GraphViewProps` (types.ts) — nothing else in the
// app (GraphPage, NodeInspector, LayerControls, graphStore) touches this file's internals.
//
// Visual language (all token-driven, pass-4 brief): notes = circles sized by degree; ghosts =
// hollow dashed circles; tags = small squares; topics = larger tinted circles. Edges: user/parser
// = solid; ai = dashed + lower opacity, width by weight, hover shows `reason`.

import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from 'react-force-graph-2d';
import type { GraphEdge, GraphNode } from '../../domain';
import type { GraphViewProps } from './types';
import type { PositionedNode } from './liveGraph';
import { paletteColor } from './layout';
import { withAlpha } from './colorUtils';
import { buildFolderHulls, hullOutline, noteRelPath, type FolderNote } from './hulls';

const NOTE_BASE_R = 6;
const NOTE_DEGREE_SCALE = 1.4;
const GHOST_R = 5;
const TAG_HALF = 2.5;
const TOPIC_R = 8;
const HULL_PAD = 24;
const FIT_PADDING = 72;
const LAYOUT_TICKS = 120;
const LAYOUT_MAX_MS = 1800;

function useContainerSize(): [React.RefObject<HTMLDivElement | null>, { width: number; height: number }] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setSize({ width: Math.max(1, box.width), height: Math.max(1, box.height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

// `nodes` isn't part of this renderer's own props: GraphPage already reconciled it into
// `positioned` (liveGraph.ts) before handing it here — the raw pre-position node list is a
// GraphView-CONTRACT concept (D25), not something this concrete renderer needs a second copy of.
export function ForceGraphRenderer(props: Omit<GraphViewProps, 'nodes'> & { positioned: PositionedNode[] }) {
  const { positioned, edges, groupings, styleTokens, vaultColors, nodeColors, nodeRings, selectedId, onNodeClick, onBackgroundClick, onNodeDragEnd } = props;
  const [containerRef, size] = useContainerSize();
  const fgRef = useRef<ForceGraphMethods<PositionedNode, GraphEdge> | undefined>(undefined);
  const fittedGraphKeyRef = useRef<string | null>(null);
  const cameraDirtyRef = useRef(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Never hand our domain edge objects to the renderer: force-graph mutates `source`/`target`
  // (here aliased to `from`/`to`) into live node references once the simulation starts, which
  // would corrupt the plain-string from/to that the rest of the app (NodeInspector, provenance)
  // expects to read from the SAME buildGraph() output.
  const renderEdges = useMemo(() => edges.map((e) => ({ ...e })), [edges]);

  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const e of edges) {
      d.set(e.from, (d.get(e.from) ?? 0) + 1);
      d.set(e.to, (d.get(e.to) ?? 0) + 1);
    }
    return d;
  }, [edges]);

  // Keep the original large-graph hairball guard, but soften its cliff and make the selected or
  // hovered node self-identifying even when the map is zoomed far out.
  const noteCount = positioned.filter((node) => node.type === 'note').length;
  const labelScaleGate = positioned.length < 100 ? 0.3 : positioned.length < 300 ? 1.2 : 2.2;
  const graphKey = useMemo(
    () => `${positioned.map((node) => node.id).join('\u0000')}\u0001${edges.map((edge) => edge.id).join('\u0000')}`,
    [positioned, edges],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const markCameraDirty = () => {
      cameraDirtyRef.current = true;
    };
    el.addEventListener('pointerdown', markCameraDirty);
    el.addEventListener('wheel', markCameraDirty, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', markCameraDirty);
      el.removeEventListener('wheel', markCameraDirty);
    };
  }, [containerRef]);

  useEffect(() => {
    if (positioned.length === 0) {
      fittedGraphKeyRef.current = null;
      return;
    }
    cameraDirtyRef.current = false;
    fittedGraphKeyRef.current = null;
    const frame = requestAnimationFrame(() => {
      const graph = fgRef.current;
      graph?.zoomToFit(400, FIT_PADDING);
    });
    return () => cancelAnimationFrame(frame);
  }, [graphKey, positioned.length]);

  useEffect(() => {
    if (positioned.length === 0 || cameraDirtyRef.current) return;
    const frame = requestAnimationFrame(() => {
      if (!cameraDirtyRef.current) fgRef.current?.zoomToFit(250, FIT_PADDING);
    });
    return () => cancelAnimationFrame(frame);
  }, [positioned.length, size.width, size.height]);

  return (
    <div
      ref={containerRef}
      data-testid="graph-canvas"
      data-node-count={positioned.length}
      data-note-count={noteCount}
      className="h-full w-full"
      style={{ backgroundColor: styleTokens.bg }}
    >
      <ForceGraph2D<PositionedNode, GraphEdge>
        ref={fgRef}
        width={size.width}
        height={size.height}
        graphData={{ nodes: positioned, links: renderEdges }}
        nodeId="id"
        linkSource="from"
        linkTarget="to"
        backgroundColor={styleTokens.bg}
        nodeLabel={(n) => n.label ?? String(n.id)}
        linkLabel={(e) => (e.reason ? `${e.reason}${e.confidence !== undefined ? ` (${Math.round(e.confidence * 100)}% confidence)` : ''}` : '')}
        linkColor={(e) => (e.source === 'ai' ? withAlpha(styleTokens.edgeAi, 0.6) : styleTokens.edgeSolid)}
        linkLineDash={(e) => (e.source === 'ai' ? [3, 2] : null)}
        linkWidth={(e) => Math.max(0.5, Math.min(4, e.weight))}
        enableNodeDrag
        onNodeDragEnd={(node) => {
          node.fx = node.x;
          node.fy = node.y;
          if (node.x !== undefined && node.y !== undefined) onNodeDragEnd?.(node as GraphNode, node.x, node.y);
        }}
        onNodeClick={(node, event) => onNodeClick?.(node as GraphNode, { metaKey: event.metaKey })}
        onNodeHover={(node) => setHoveredId(node ? String(node.id) : null)}
        onBackgroundClick={() => onBackgroundClick?.()}
        cooldownTicks={LAYOUT_TICKS}
        cooldownTime={LAYOUT_MAX_MS}
        onEngineStop={() => {
          // Seeded positions live in a 800px world, while the graph viewport is usually much
          // smaller. Fit once per node set after the force simulation settles so isolated notes
          // cannot end up outside the initial camera, and do not steal the user's zoom on drag.
          if (positioned.length === 0 || cameraDirtyRef.current || fittedGraphKeyRef.current === graphKey) return;
          fittedGraphKeyRef.current = graphKey;
          fgRef.current?.zoomToFit(300, FIT_PADDING);
        }}
        onRenderFramePre={(ctx, globalScale) => {
          if (!groupings?.hullsEnabled) return;
          // Computed FRESH every frame from the live node objects (same references the
          // simulation/drag mutate in place) — hull geometry is a per-frame rendering concern,
          // not something to precompute once per data change (it would lag during drag/settle).
          const folderNotes: FolderNote[] = [];
          for (const n of positioned) {
            if (n.type !== 'note' || !n.vaultId) continue;
            const relPath = noteRelPath(String(n.id), n.vaultId);
            if (relPath === null) continue;
            folderNotes.push({ nodeId: String(n.id), vaultId: n.vaultId, relPath, x: n.x, y: n.y });
          }
          // Per-vault registered accent color wins over the hashed palette (pass-05 brief:
          // "per-vault accent color used on ... hulls"); a hull id is `${vaultId}::${folderPath}`
          // (hulls.ts), so every depth of a vault's hull tree shares its color, not just the
          // vault-root one. Falls back to the hash for any vault with no registered color yet
          // (or none at all), so single-vault output is byte-identical to before this pass.
          const hullColorFor = (id: string, palette: readonly string[]): string =>
            vaultColors?.[id.split('::')[0]] ?? paletteColor(id, palette);
          const hulls = buildFolderHulls(folderNotes, styleTokens.hullPalette, hullColorFor);
          if (hulls.length === 0) return;
          // Shallower (vault-level) hulls first, deeper folder hulls painted on top — since a
          // child's points are a subset of its parent's, this reads as true nesting.
          const sorted = [...hulls].sort((a, b) => a.depth - b.depth);
          for (const hull of sorted) {
            const outline = hullOutline(hull, HULL_PAD / globalScale);
            const alpha = Math.max(0.05, 0.16 - hull.depth * 0.025);
            ctx.beginPath();
            if (outline.kind === 'polygon') {
              outline.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
              ctx.closePath();
            } else {
              ctx.arc(outline.cx, outline.cy, outline.r, 0, Math.PI * 2);
            }
            ctx.fillStyle = withAlpha(hull.color, alpha);
            ctx.fill();
            ctx.strokeStyle = withAlpha(hull.color, Math.min(1, alpha * 3));
            ctx.lineWidth = 1 / globalScale;
            ctx.stroke();
            if (globalScale > 0.4) {
              const label = hull.folderPath.split('/').pop() || hull.vaultId;
              const top = outline.kind === 'polygon' ? outline.points.reduce((a, p) => (p.y < a.y ? p : a)) : { x: outline.cx, y: outline.cy - outline.r };
              ctx.font = `${11 / globalScale}px var(--font-ui, sans-serif)`;
              ctx.fillStyle = withAlpha(styleTokens.fgMuted, 0.9);
              ctx.textAlign = 'center';
              ctx.fillText(label, top.x, top.y - 4 / globalScale);
            }
          }
        }}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const x = node.x ?? 0;
          const y = node.y ?? 0;
          const selected = node.id === selectedId;
          ctx.save();
          switch (node.type) {
            case 'note': {
              const r = NOTE_BASE_R + Math.sqrt(degree.get(String(node.id)) ?? 0) * NOTE_DEGREE_SCALE;
              // Mixed-membership ring segments (pass-8): a ring of arc segments in each strong
              // topic's color, drawn just outside the node, before the fill.
              const rings = nodeRings?.[String(node.id)];
              if (rings && rings.length >= 2) {
                const seg = (Math.PI * 2) / rings.length;
                ctx.lineWidth = 1.5 / globalScale;
                for (let i = 0; i < rings.length; i++) {
                  ctx.beginPath();
                  ctx.arc(x, y, r + 1.5 / globalScale, i * seg, (i + 1) * seg);
                  ctx.strokeStyle = rings[i];
                  ctx.stroke();
                }
              }
              ctx.beginPath();
              ctx.arc(x, y, r, 0, Math.PI * 2);
              // Semantic clustering: dominant-topic color (D7 default view) or the flat note fill.
              ctx.fillStyle = nodeColors?.[String(node.id)] ?? styleTokens.noteFill;
              ctx.fill();
              if (selected) {
                ctx.lineWidth = 1.5 / globalScale;
                ctx.strokeStyle = styleTokens.accent;
                ctx.stroke();
              }
              break;
            }
            case 'ghost': {
              ctx.beginPath();
              ctx.setLineDash([2 / globalScale, 2 / globalScale]);
              ctx.arc(x, y, GHOST_R, 0, Math.PI * 2);
              ctx.lineWidth = (selected ? 2 : 1) / globalScale;
              ctx.strokeStyle = selected ? styleTokens.accent : styleTokens.ghostStroke;
              ctx.stroke();
              ctx.setLineDash([]);
              break;
            }
            case 'tag': {
              ctx.fillStyle = styleTokens.tagFill;
              ctx.fillRect(x - TAG_HALF, y - TAG_HALF, TAG_HALF * 2, TAG_HALF * 2);
              if (selected) {
                ctx.lineWidth = 1.5 / globalScale;
                ctx.strokeStyle = styleTokens.accent;
                ctx.strokeRect(x - TAG_HALF - 1, y - TAG_HALF - 1, TAG_HALF * 2 + 2, TAG_HALF * 2 + 2);
              }
              break;
            }
            case 'topic':
            case 'topicmerge': {
              const color = paletteColor(String(node.id), styleTokens.hullPalette);
              ctx.beginPath();
              ctx.arc(x, y, TOPIC_R, 0, Math.PI * 2);
              ctx.fillStyle = withAlpha(color, 0.55);
              ctx.fill();
              ctx.lineWidth = (selected ? 2 : 1) / globalScale;
              ctx.strokeStyle = selected ? styleTokens.accent : color;
              ctx.stroke();
              break;
            }
          }
          const emphasized = node.id === selectedId || node.id === hoveredId;
          if ((emphasized || globalScale > labelScaleGate) && node.label) {
            ctx.font = `${10 / globalScale}px var(--font-ui, sans-serif)`;
            ctx.fillStyle = styleTokens.fg;
            ctx.textAlign = 'center';
            ctx.fillText(node.label, x, y + TOPIC_R + 8 / globalScale);
          }
          ctx.restore();
        }}
        nodePointerAreaPaint={(node, color, ctx) => {
          const x = node.x ?? 0;
          const y = node.y ?? 0;
          const r = node.type === 'topic' || node.type === 'topicmerge' ? TOPIC_R : node.type === 'note' ? NOTE_BASE_R + Math.sqrt(degree.get(String(node.id)) ?? 0) * NOTE_DEGREE_SCALE : GHOST_R;
          ctx.fillStyle = color;
          ctx.beginPath();
          // Architect fix: enforce a minimum hit radius — low-degree notes render as tiny dots
          // and were nearly unclickable in real vaults (manual-testing finding).
          ctx.arc(x, y, Math.max(r + 2, 9), 0, Math.PI * 2);
          ctx.fill();
        }}
      />
    </div>
  );
}

// Re-exported so callers don't need to import react-force-graph-2d's type directly.
export type { NodeObject };
