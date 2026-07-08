// src/features/editor/livePreview.ts — live-preview decorations (D19/pass-03 brief): rendered
// headings/bold/italics, wikilinks as clickable/ghost spans, tags as chips, read-only image
// embeds (S26). Built ONLY over `view.visibleRanges` (expanded to line boundaries) so cost never
// scales with document length — the pass-03 perf trap is full-document re-decoration per
// keystroke on a 10k-line note; this never walks past what's on screen.
//
// Wikilinks/tags are collapsed to a widget only when the selection doesn't overlap them, so the
// user can still edit the raw `[[...]]`/`#tag` text while their cursor is on it (Obsidian's
// live-preview behavior). Headings/bold/italic use lighter mark-styling (dim the delimiters,
// style the content) rather than full mark-hiding — a deliberate, documented scope reduction
// (see PROGRESS.md pass-03 deviations); upgrading them to cursor-aware hiding later doesn't
// require touching the wikilink/tag/embed machinery.
//
// This is a PRESENTATION-ONLY approximation of S2/S3 (regex over visible text, code-region
// masking via the CM syntax tree) — it is not the source of truth. The authoritative parse
// (domain/parser.ts) runs on save via the repository; nothing here feeds backlinks or the graph.

import { EditorView, Decoration, type DecorationSet, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { resolveLink } from '../../domain/links';
import { TAG_RE } from '../../domain/parser';
import { vaultContextField, type EditorVaultContext } from './vaultContext';
import { guessImageMime, loadAssetObjectUrl } from '../../services/assets';
import { findWikilinks, resolveAssetPath } from './wikilinkScan';

// ── widgets ──────────────────────────────────────────────────────────────────

class WikilinkWidget extends WidgetType {
  constructor(
    private readonly display: string,
    private readonly ghost: boolean,
    private readonly onActivate: () => void,
  ) {
    super();
  }

  override eq(other: WikilinkWidget): boolean {
    return other.display === this.display && other.ghost === this.ghost;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = this.ghost ? 'cm-denote-link cm-denote-link-ghost' : 'cm-denote-link';
    span.textContent = this.display;
    span.title = this.ghost ? 'Ghost link — cmd-click to create' : 'cmd-click to open';
    span.addEventListener('mousedown', (e) => {
      if (e.metaKey) {
        e.preventDefault();
        this.onActivate();
      }
    });
    return span;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

class TagWidget extends WidgetType {
  constructor(private readonly name: string) {
    super();
  }
  override eq(other: TagWidget): boolean {
    return other.name === this.name;
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-denote-tag';
    span.textContent = `#${this.name}`;
    return span;
  }
}

class ImageEmbedWidget extends WidgetType {
  constructor(
    private readonly root: string,
    private readonly relPath: string,
  ) {
    super();
  }
  override eq(other: ImageEmbedWidget): boolean {
    return other.root === this.root && other.relPath === this.relPath;
  }
  toDOM(): HTMLElement {
    const img = document.createElement('img');
    img.className = 'cm-denote-embed';
    img.alt = this.relPath;
    void loadAssetObjectUrl(this.root, this.relPath)
      .then((url) => {
        img.src = url;
      })
      .catch(() => {
        img.replaceWith(missingAssetSpan(this.relPath));
      });
    return img;
  }
}

function missingAssetSpan(relPath: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'cm-denote-embed-missing';
  span.textContent = `missing: ${relPath}`;
  return span;
}

// ── code-region masking (approximate S5, scoped to the visible slice) ────────

interface Range {
  start: number;
  end: number;
}

const CODE_NODE_NAMES = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'HTMLTag']);

function collectCodeRanges(view: EditorView, from: number, to: number): Range[] {
  const ranges: Range[] = [];
  syntaxTree(view.state).iterate({
    from,
    to,
    enter(node) {
      if (CODE_NODE_NAMES.has(node.type.name)) ranges.push({ start: node.from, end: node.to });
    },
  });
  return ranges;
}

function isMasked(pos: number, ranges: Range[]): boolean {
  return ranges.some((r) => pos >= r.start && pos < r.end);
}

// ── heading / emphasis scanning (typographic styling only, not mark-hiding) ──

const HEADING_RE = /^(#{1,6})[ \t]+\S/gm;
const STRONG_RE = /\*\*([^*\n]+)\*\*/g;
const EM_RE = /(?<!\*)\*([^*\n]+)\*(?!\*)/g;

interface Item {
  from: number;
  to: number;
  deco: Decoration;
}

function buildHeadingLineDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const items: { line: number; depth: number }[] = [];
  for (const { from, to } of view.visibleRanges) {
    const lineFrom = view.state.doc.lineAt(from).from;
    const lineTo = view.state.doc.lineAt(to).to;
    const text = view.state.doc.sliceString(lineFrom, lineTo);
    const codeRanges = collectCodeRanges(view, lineFrom, lineTo);
    for (const m of text.matchAll(HEADING_RE)) {
      const start = lineFrom + (m.index ?? 0);
      if (isMasked(start, codeRanges)) continue;
      items.push({ line: view.state.doc.lineAt(start).from, depth: m[1].length });
    }
  }
  items.sort((a, b) => a.line - b.line);
  for (const it of items) {
    builder.add(it.line, it.line, Decoration.line({ class: `cm-denote-h${it.depth}` }));
  }
  return builder.finish();
}

function buildInlineDecorations(view: EditorView): DecorationSet {
  const ctx = view.state.field(vaultContextField);
  const sel = view.state.selection.main;
  const items: Item[] = [];

  for (const { from, to } of view.visibleRanges) {
    const lineFrom = view.state.doc.lineAt(from).from;
    const lineTo = view.state.doc.lineAt(to).to;
    const text = view.state.doc.sliceString(lineFrom, lineTo);
    const codeRanges = collectCodeRanges(view, lineFrom, lineTo);

    for (const m of text.matchAll(STRONG_RE)) {
      const start = lineFrom + (m.index ?? 0);
      if (isMasked(start, codeRanges)) continue;
      items.push({ from: start, to: start + m[0].length, deco: Decoration.mark({ class: 'cm-denote-strong' }) });
    }
    for (const m of text.matchAll(EM_RE)) {
      const start = lineFrom + (m.index ?? 0);
      if (isMasked(start, codeRanges)) continue;
      items.push({ from: start, to: start + m[0].length, deco: Decoration.mark({ class: 'cm-denote-em' }) });
    }

    for (const tok of findWikilinks(text, lineFrom)) {
      if (isMasked(tok.start, codeRanges)) continue;
      const overlapsSelection = sel.from <= tok.end && sel.to >= tok.start;
      if (overlapsSelection) continue; // editing this token: show raw source

      if (tok.bang) {
        const assetRel = resolveAssetPath(tok.target, ctx.assets);
        const mime = assetRel ? guessImageMime(assetRel) : null;
        items.push({
          from: tok.start,
          to: tok.end,
          deco:
            assetRel && mime
              ? Decoration.replace({ widget: new ImageEmbedWidget(ctx.root, assetRel) })
              : Decoration.replace({ widget: missingAssetWidget(tok.target) }),
        });
        continue;
      }

      const resolution = resolveLink(tok.target, ctx.notes, ctx.vaultId);
      const isGhost = resolution.kind === 'ghost';
      const display = tok.alias ?? tok.target;
      const widget = new WikilinkWidget(display, isGhost, () => {
        if (resolution.kind === 'note') ctx.onNavigate(resolution.relPath);
        else ctx.onCreateGhost(tok.target);
      });
      items.push({ from: tok.start, to: tok.end, deco: Decoration.replace({ widget }) });
    }

    for (const m of text.matchAll(TAG_RE)) {
      const start = lineFrom + (m.index ?? 0);
      if (isMasked(start, codeRanges)) continue;
      const end = start + m[0].length;
      if (sel.from <= end && sel.to >= start) continue;
      items.push({ from: start, to: end, deco: Decoration.replace({ widget: new TagWidget(m[1]) }) });
    }
  }

  items.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  let lastEnd = -1;
  for (const it of items) {
    if (it.from < lastEnd) continue; // drop an accidental overlap rather than throw
    builder.add(it.from, it.to, it.deco);
    lastEnd = it.to;
  }
  return builder.finish();
}

class MissingAssetWidget extends WidgetType {
  constructor(private readonly target: string) {
    super();
  }
  override eq(other: MissingAssetWidget): boolean {
    return other.target === this.target;
  }
  toDOM(): HTMLElement {
    return missingAssetSpan(this.target);
  }
}
function missingAssetWidget(target: string): MissingAssetWidget {
  return new MissingAssetWidget(target);
}

const headingLinePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildHeadingLineDecorations(view);
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        this.decorations = buildHeadingLineDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

const inlineDecorationsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildInlineDecorations(view);
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        this.decorations = buildInlineDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

export function livePreviewExtensions(): Extension[] {
  return [vaultContextField, headingLinePlugin, inlineDecorationsPlugin];
}

export type { EditorVaultContext };
