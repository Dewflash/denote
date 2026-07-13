// src/domain/types.ts — canonical shapes (MASTERPLAN §5). PURE TypeScript.
// Where SPECS/DECISIONS supersede the MASTERPLAN summary the change is noted inline
// (e.g. WikiLink.heading per S2; ParsedNote.warnings per the pass-01 brief).

export type VaultId = string; // uuid, stored in .denote/meta.json (D2)
export type NoteId = `${VaultId}/${string}`; // vaultId + vault-relative path (D4)

export interface NoteFile {
  vaultId: VaultId;
  relPath: string;
  contentHash: string;
  mtime: number;
}

/** The `ai:` reserved frontmatter namespace (D28), schema per S10. */
export interface AiFrontmatter {
  v: number;
  tags?: string[]; // provisional tags
  links?: string[]; // provisional wikilink targets (resolution per S4)
  topics?: string[]; // topic ids
  applied?: string; // ISO timestamp
  model?: string; // model id, e.g. "apple@fm1"
}

export interface ParsedNote {
  relPath: string;
  title: string; // first H1 → filename fallback
  frontmatter: Record<string, unknown>; // user frontmatter (ai: block parsed separately)
  aiFrontmatter: AiFrontmatter | null; // the ai: namespace, if present (D9)
  headings: { depth: number; text: string }[];
  links: WikiLink[]; // outbound only
  tags: string[]; // display casing, deduped case-insensitively (S3)
  warnings: string[]; // best-effort parse never throws (pass-01 brief)
  /** Plain-text rendering of the body (frontmatter excluded), for full-text search (pass-05
   *  brief: search indexes title/headings/body/tags). Derived, never a source of truth. */
  bodyText: string;
}

// grammar: SPECS S2. `heading?` supersedes the MASTERPLAN §5 shape.
export interface WikiLink {
  targetTitle: string;
  heading?: string;
  alias?: string;
  embed: boolean;
  offsetStart: number;
  offsetEnd: number;
}

// Backlinks: NEVER stored (D5). Map<relPath, {fromPath, link}[]> computed from the link index.

export interface AiAnnotation {
  id: string;
  notePath: string;
  contentHash: string;
  kind: 'topic' | 'link' | 'tag' | 'summary' | 'alias';
  payload: unknown; // per-kind schema in pass 6 brief
  confidence: number; // 0..1
  reason: string; // human-readable justification — required (D6)
  status: 'suggested' | 'accepted' | 'rejected' | 'applied-provisional';
  model: string;
  createdAt: string;
}

export interface Topic {
  id: string;
  name: string;
  aliases: string[];
  parentId: string | null; // hierarchy (Finance → Banking)
  relatedIds: string[];
  source: 'user' | 'ai';
  members: { notePath: string; weight: number }[]; // soft multi-membership (D14)
}

export type GraphNodeId =
  | NoteId
  | `topic:${string}`
  | `topicmerge:${string}`
  | `tag:${string}`
  | `ghost:${string}`;

export interface GraphNode {
  id: GraphNodeId;
  type: 'note' | 'topic' | 'topicmerge' | 'tag' | 'ghost';
  vaultId?: VaultId;
  // Presentation label (filename/title/tag/topic name); derived, never a source of truth.
  label?: string;
}
// tag ids are global (merge across vaults); topicmerge is presentation-only — see SPECS S25

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type:
    | 'wikilink'
    | 'embed'
    | 'ai-link'
    | 'note-tag'
    | 'ai-tag'
    | 'note-topic'
    | 'topic-topic'
    | 'ai-similar'
    | 'manual';
  source: 'user' | 'parser' | 'ai' | 'system';
  weight: number;
  confidence?: number;
  reason?: string;
}
