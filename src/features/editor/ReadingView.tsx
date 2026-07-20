// src/features/editor/ReadingView.tsx — rendered markdown (cmd-E toggle, D19/pass-03 brief).
// Reuses unified/remark-parse (D20) directly to build an mdast tree and renders it to React;
// wikilinks/tags are approximated the same way as live preview (wikilinkScan.ts) since remark
// has no notion of them. Read-only: this view never writes anything.

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import { resolveLink } from '../../domain/links';
import { TAG_RE } from '../../domain/parser';
import { findWikilinks, resolveAssetPath } from './wikilinkScan';
import { AssetImage } from './AssetImage';
import { useVaultStore } from '../../state/vaultStore';
import { useUiStore } from '../../state/uiStore';

const processor = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']);

interface MdNode {
  type: string;
  value?: string;
  depth?: number;
  ordered?: boolean;
  url?: string;
  alt?: string;
  children?: MdNode[];
}

interface RenderCtx {
  vaultId: string;
  root: string;
  notes: { relPath: string; title: string }[];
  assets: string[];
  findQuery: string;
}

function highlightText(text: string, query: string, key: string): ReactNode {
  const needle = query.trim();
  if (!needle) return text;
  const lower = text.toLocaleLowerCase();
  const target = needle.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let match = lower.indexOf(target, cursor);
  let index = 0;
  while (match >= 0) {
    if (match > cursor) parts.push(text.slice(cursor, match));
    parts.push(<mark key={`${key}-find-${index}`} className="denote-find-match">{text.slice(match, match + needle.length)}</mark>);
    cursor = match + needle.length;
    match = lower.indexOf(target, cursor);
    index += 1;
  }
  if (cursor === 0) return text;
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <Fragment key={`${key}-find-text`}>{parts}</Fragment>;
}

function renderInlineText(text: string, key: string, ctx: RenderCtx): ReactNode[] {
  interface Piece {
    start: number;
    end: number;
    node: ReactNode;
  }
  const pieces: Piece[] = [];

  for (const tok of findWikilinks(text)) {
    if (tok.bang) {
      const assetRel = resolveAssetPath(tok.target, ctx.assets);
      pieces.push({
        start: tok.start,
        end: tok.end,
        node: assetRel ? (
          <AssetImage key={`${key}-img-${tok.start}`} root={ctx.root} relPath={assetRel} alt={tok.target} />
        ) : (
          <span key={`${key}-missing-${tok.start}`} className="cm-denote-embed-missing">
            missing: {tok.target}
          </span>
        ),
      });
      continue;
    }
    const resolution = resolveLink(tok.target, ctx.notes, ctx.vaultId);
    const ghost = resolution.kind === 'ghost';
    const display = tok.alias ?? tok.target;
    pieces.push({
      start: tok.start,
      end: tok.end,
      node: (
        <button
          type="button"
          key={`${key}-link-${tok.start}`}
          className={`${ghost ? 'cm-denote-link cm-denote-link-ghost' : 'cm-denote-link'} border-0 bg-transparent p-0`}
          onClick={() => {
            if (resolution.kind === 'note') void useVaultStore.getState().setActiveNote(resolution.relPath);
            else void useVaultStore.getState().createGhostAndOpen(tok.target);
          }}
        >
          {display}
        </button>
      ),
    });
  }

  for (const m of text.matchAll(TAG_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    pieces.push({ start, end, node: <span key={`${key}-tag-${start}`} className="cm-denote-tag">#{m[1]}</span> });
  }

  pieces.sort((a, b) => a.start - b.start);

  const out: ReactNode[] = [];
  let cursor = 0;
  for (const p of pieces) {
    if (p.start < cursor) continue; // drop an accidental overlap rather than throw
    if (p.start > cursor) out.push(highlightText(text.slice(cursor, p.start), ctx.findQuery, `${key}-${cursor}`));
    out.push(p.node);
    cursor = p.end;
  }
  if (cursor < text.length) out.push(highlightText(text.slice(cursor), ctx.findQuery, `${key}-${cursor}`));
  return out;
}

function renderChildren(children: MdNode[] | undefined, ctx: RenderCtx, keyPrefix: string): ReactNode {
  return (children ?? []).map((child, i) => renderNode(child, ctx, `${keyPrefix}-${i}`));
}

function renderNode(node: MdNode, ctx: RenderCtx, key: string): ReactNode {
  switch (node.type) {
    case 'root':
      return <Fragment key={key}>{renderChildren(node.children, ctx, key)}</Fragment>;
    case 'heading': {
      const depth = Math.min(Math.max(node.depth ?? 1, 1), 6);
      const HeadingTag = `h${depth}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      return <HeadingTag key={key}>{renderChildren(node.children, ctx, key)}</HeadingTag>;
    }
    case 'paragraph':
      return <p key={key}>{renderChildren(node.children, ctx, key)}</p>;
    case 'strong':
      return <strong key={key}>{renderChildren(node.children, ctx, key)}</strong>;
    case 'emphasis':
      return <em key={key}>{renderChildren(node.children, ctx, key)}</em>;
    case 'inlineCode':
      return (
        <code key={key} className="cm-denote-inline-code">
          {node.value}
        </code>
      );
    case 'code':
      return (
        <pre key={key}>
          <code>{node.value}</code>
        </pre>
      );
    case 'blockquote':
      return <blockquote key={key}>{renderChildren(node.children, ctx, key)}</blockquote>;
    case 'list':
      return node.ordered ? (
        <ol key={key}>{renderChildren(node.children, ctx, key)}</ol>
      ) : (
        <ul key={key}>{renderChildren(node.children, ctx, key)}</ul>
      );
    case 'listItem':
      return <li key={key}>{renderChildren(node.children, ctx, key)}</li>;
    case 'thematicBreak':
      return <hr key={key} />;
    case 'break':
      return <br key={key} />;
    case 'link':
      return (
        <a key={key} href={node.url} target="_blank" rel="noreferrer">
          {renderChildren(node.children, ctx, key)}
        </a>
      );
    case 'image':
      return <img key={key} src={node.url} alt={node.alt ?? ''} />;
    case 'yaml':
      return null; // frontmatter is metadata, not body prose — not rendered here
    case 'text':
      return <Fragment key={key}>{renderInlineText(node.value ?? '', key, ctx)}</Fragment>;
    default:
      return <Fragment key={key}>{renderChildren(node.children, ctx, key)}</Fragment>;
  }
}

export function ReadingView() {
  const buffer = useVaultStore((s) => s.buffer);
  const repo = useVaultStore((s) => s.repo);
  const root = useVaultStore((s) => s.root);
  const indexRevision = useVaultStore((s) => s.indexRevision);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');

  useEffect(() => {
    const onFindInNote = (): void => setFindOpen(true);
    window.addEventListener('denote:find-in-note', onFindInNote);
    return () => window.removeEventListener('denote:find-in-note', onFindInNote);
  }, []);

  const ctx: RenderCtx | null = useMemo(() => {
    if (!repo || !root) return null;
    return {
      vaultId: repo.vaultId,
      root,
      notes: repo.listNotePaths().map((relPath) => ({
        relPath,
        title: repo.getParsed(relPath)?.title ?? relPath,
      })),
      assets: [...repo.index.assets.keys()],
      findQuery,
    };
    // revision is the deliberate re-derive signal for the live index.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, root, indexRevision, findQuery]);

  const tree = useMemo(() => {
    if (!buffer) return null;
    try {
      return processor.parse(buffer.content) as unknown as MdNode;
    } catch {
      return null;
    }
  }, [buffer]);

  if (!buffer || !ctx || !tree) return null;
  return (
    <div className="relative h-full">
      {findOpen && (
        <div className="denote-reading-find absolute left-3 right-3 top-3 z-10 flex items-center gap-2 rounded p-2 text-xs" style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
          <label className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0" style={{ color: 'var(--fg-muted)' }}>Find</span>
            <input
              autoFocus
              value={findQuery}
              onChange={(event) => setFindQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setFindOpen(false);
              }}
              aria-label="Find in note"
              className="min-w-0 flex-1 rounded px-2 py-1"
              style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--fg)' }}
            />
          </label>
          <span style={{ color: 'var(--fg-muted)' }}>
            {findQuery.trim() ? `${(buffer.content.toLocaleLowerCase().split(findQuery.trim().toLocaleLowerCase()).length - 1)} matches` : ''}
          </span>
          <button type="button" aria-label="Close find in note" onClick={() => setFindOpen(false)} style={{ color: 'var(--fg-muted)' }}>×</button>
        </div>
      )}
      <button
        title="Back to editing (⌘E)"
        className="absolute right-3 top-3 z-10 rounded px-2 py-1 text-xs"
        style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg-panel)', color: 'var(--fg-muted)', ...(findOpen ? { top: 58 } : {}) }}
        onClick={() => useUiStore.getState().toggleViewMode()}
      >
        Edit
      </button>
      <div className="denote-reading-view h-full overflow-auto" style={{ padding: '16px 20px', width: '100%', maxWidth: 'var(--editor-line-width)', marginInline: 'auto', boxSizing: 'border-box' }}>
        {renderNode(tree, ctx, 'root')}
      </div>
    </div>
  );
}
