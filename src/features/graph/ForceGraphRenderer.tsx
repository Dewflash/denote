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

const NOTE_BASE_R = 3;
const NOTE_DEGREE_SCALE = 1.1;
const GHOST_R = 4;
const TAG_HALF = 2.5;
const TOPIC_R = 8;
const HULL_PAD = 24;

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
  const { positioned, edges, groupings, styleTokens, selectedId, onNodeClick, onBackgroundClick, onNodeDragEnd } = props;
  const [containerRef, size] = useContainerSize();
  const fgRef = useRef<ForceGraphMethods<PositionedNode, GraphEdge> | undefined>(undefined);

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

  return (
    <div ref={containerRef} className="h-full w-full" style={{ backgroundColor: styleTokens.bg }}>
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
        onBackgroundClick={() => onBackgroundClick?.()}
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
          const hulls = buildFolderHulls(folderNotes, styleTokens.hullPalette, paletteColor);
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
              ctx.beginPath();
              ctx.arc(x, y, r, 0, Math.PI * 2);
              ctx.fillStyle = styleTokens.noteFill;
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
          if (globalScale > 2.2 && node.label) {
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
          ctx.arc(x, y, r + 2, 0, Math.PI * 2);
          ctx.fill();
        }}
        cooldownTicks={200}
      />
    </div>
  );
}

// Re-exported so callers don't need to import react-force-graph-2d's type directly.
export type { NodeObject };
