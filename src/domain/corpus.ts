// src/domain/corpus.ts — PURE assembly of the deep-organize corpus into Batch items, plus the
// local token/cost estimate used for trimming (S27/D12). The retrieval funnel (D12) means the
// paid tier NEVER sees raw whole-vault text: each note contributes only its title, folder, and an
// on-device summary; themes reason over the topic index + folder manifest. This module builds the
// prompts and orders items by priority so the orchestrator can trim the lowest-priority ones to
// fit the budget. No I/O — the orchestrator supplies the assembled corpus and applies results.

// The local token estimate (S27: chars/3.5) is the same helper the on-device budgeter uses (S16).
import { estimateTokens } from './tokenBudget';

/** One note's contribution to the corpus (summary only — never the full body, D12). */
export interface CorpusNote {
  vaultId: string;
  relPath: string;
  title: string;
  folder: string;
  summary: string;
  /** Membership went stale (content changed) — highest priority to re-reason. */
  stale: boolean;
  /** Already has ontology annotations — lower priority than never-enriched notes. */
  enriched: boolean;
}

export interface CorpusTopic {
  vaultId: string;
  name: string;
  memberTitles: string[];
}

export interface AssembledCorpus {
  notes: CorpusNote[];
  topics: CorpusTopic[];
}

export type CorpusItemKind = 'note' | 'theme';

/** A single Batch request the orchestrator will submit (one custom_id). */
export interface BatchItemSpec {
  customId: string;
  kind: CorpusItemKind;
  /** notePath for a note item; 'theme' for the cross-note theme item. */
  ref: string;
  /** Vault the result applies back to; '' for the cross-vault theme item. */
  vaultId: string;
  /** Lower = kept longer when trimming to fit budget (theme + stale notes rank highest). */
  priority: number;
  system: string;
  user: string;
  maxTokens: number;
  schema: Record<string, unknown>;
}

const NOTE_SYSTEM =
  'You organize a personal Markdown knowledge base. Given ONE note (title, folder, summary) plus ' +
  'the vault\'s existing topics, propose topics to attach it to (reuse an EXISTING topic name ' +
  'verbatim when one fits — never invent a near-duplicate), specific tags, and wikilinks only ' +
  'to notes that share a NAMED concept. Every item needs a concrete reason and confidence 0..1. ' +
  'Reply as JSON matching the schema.';

const THEME_SYSTEM =
  'You find cross-cutting THEMES in a personal knowledge base: ideas that span multiple folders ' +
  'or vaults and connect notes that are not otherwise linked (e.g. a "de-dollarization" thread ' +
  'running through separate notes on gold, reserve currencies, and central banks). Given a topic ' +
  'index and a folder manifest of note titles, propose at most 5 themes. Each theme must cite the ' +
  'specific member note titles it connects and give a concrete reason. A theme is only worth ' +
  'proposing when its members sit in DIFFERENT folders. Reply as JSON matching the schema.';

const suggestionItem = (extra: Record<string, unknown> = {}) => ({
  type: 'object',
  additionalProperties: false,
  properties: { name: { type: 'string' }, reason: { type: 'string' }, confidence: { type: 'number' }, ...extra },
  required: ['name', 'reason', 'confidence', ...Object.keys(extra)],
});

export const NOTE_ITEM_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    topics: { type: 'array', items: suggestionItem({ parentName: { type: 'string' } }) },
    links: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { target: { type: 'string' }, reason: { type: 'string' }, confidence: { type: 'number' } },
        required: ['target', 'reason', 'confidence'],
      },
    },
    tags: { type: 'array', items: suggestionItem() },
    summary: { type: 'string' },
  },
  required: ['topics', 'links', 'tags', 'summary'],
};

export const THEME_ITEM_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    themes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          reason: { type: 'string' },
          confidence: { type: 'number' },
          memberTitles: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'description', 'reason', 'confidence', 'memberTitles'],
      },
    },
  },
  required: ['themes'],
};

function topicIndexText(topics: CorpusTopic[]): string {
  if (topics.length === 0) return '(no topics yet)';
  return topics.map((t) => `- ${t.name}: ${t.memberTitles.slice(0, 6).join(', ')}`).join('\n');
}

function folderManifestText(notes: CorpusNote[]): string {
  const byFolder = new Map<string, string[]>();
  for (const n of notes) {
    const key = `${n.vaultId}/${n.folder || '(root)'}`;
    (byFolder.get(key) ?? byFolder.set(key, []).get(key)!).push(n.title);
  }
  return [...byFolder.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([folder, titles]) => `## ${folder}\n${titles.map((t) => `- ${t}`).join('\n')}`)
    .join('\n');
}

/**
 * Build all Batch items for a corpus, ordered by priority (theme first, then stale notes, then
 * unenriched notes). The orchestrator trims from the END (lowest priority) to fit budget.
 */
export function buildBatchItems(corpus: AssembledCorpus): BatchItemSpec[] {
  const items: BatchItemSpec[] = [];

  // The cross-note theme item (priority 0 — always kept; it is the flagship deep-organize output).
  const topicIndex = topicIndexText(corpus.topics);
  const manifest = folderManifestText(corpus.notes);
  items.push({
    customId: 'theme',
    kind: 'theme',
    ref: 'theme',
    vaultId: '',
    priority: 0,
    system: THEME_SYSTEM,
    user: `Topic index:\n${topicIndex}\n\nFolder manifest:\n${manifest}`,
    maxTokens: 1500,
    schema: THEME_ITEM_SCHEMA,
  });

  // Per-note re-reasoning: stale first (priority 1), then unenriched (priority 2). Already-enriched,
  // non-stale notes are skipped — hash-gating (D3) means paying to re-ask them adds nothing.
  const noteCandidates = corpus.notes
    .filter((n) => n.stale || !n.enriched)
    .sort((a, b) => Number(b.stale) - Number(a.stale) || a.relPath.localeCompare(b.relPath));

  const existingTopics = corpus.topics.map((t) => `- ${t.name}`).join('\n') || '(none yet)';
  for (const n of noteCandidates) {
    items.push({
      customId: `note:${n.vaultId}:${n.relPath}`,
      kind: 'note',
      ref: n.relPath,
      vaultId: n.vaultId,
      priority: n.stale ? 1 : 2,
      system: NOTE_SYSTEM,
      user: `Title: ${n.title}\nFolder: ${n.folder || '(root)'}\n\nExisting topics:\n${existingTopics}\n\nSummary:\n${n.summary}`,
      maxTokens: 800,
      schema: NOTE_ITEM_SCHEMA,
    });
  }

  return items;
}

/** Local (chars/3.5) input-token estimate for one item = system + user. */
export function itemInputTokens(item: BatchItemSpec): number {
  return estimateTokens(item.system) + estimateTokens(item.user);
}

export interface CorpusEstimate {
  inputTokens: number;
  outputTokens: number;
}

/** Sum input (system+user) + a conservative output budget (each item's maxTokens) across items. */
export function estimateCorpus(items: BatchItemSpec[]): CorpusEstimate {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const item of items) {
    inputTokens += itemInputTokens(item);
    outputTokens += item.maxTokens;
  }
  return { inputTokens, outputTokens };
}

/**
 * Trim the lowest-priority items until `costFn(estimate) <= budget`. Returns the kept items (never
 * drops the theme item, priority 0, unless even it alone exceeds budget — then returns []). The
 * orchestrator turns an empty/over-budget result into a hard `budget-exceeded` refusal.
 */
export function trimToBudget(
  items: BatchItemSpec[],
  budget: number,
  costFn: (est: CorpusEstimate) => number,
): BatchItemSpec[] {
  const kept = [...items].sort((a, b) => a.priority - b.priority || a.customId.localeCompare(b.customId));
  while (kept.length > 0 && costFn(estimateCorpus(kept)) > budget) {
    kept.pop(); // drop the current lowest-priority item
  }
  return kept;
}
