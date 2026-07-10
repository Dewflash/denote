// src/services/aiClient/types.ts — the AiClient contract (MASTERPLAN §6) plus the request/result
// shapes shared by every backend (mock now; apple pass 7; anthropic pass 9).
//
// Two fields extend the MASTERPLAN §6 shape and are documented here as pass-06 additions:
//   - `modelId` — the exact model version string stamped into every AiAnnotation. Hash-gating
//     (D26) keys on (contentHash, modelId), so upgrading a backend re-enriches naturally.
//   - `isNetwork` — whether the backend sends content off-device. The router (router.ts) refuses
//     a network backend for a `localOnly` vault (D18); `mock` and `apple` are local, `anthropic`
//     is network.

export type AiBackendKind = 'mock' | 'apple' | 'anthropic';

/** The routable units of AI work (settings map each to a backend; MASTERPLAN §6 routing table). */
export type AiTask = 'summarize' | 'enrich' | 'label-similarity' | 'deep-organize';

export interface AiCapabilities {
  available: boolean;
  reason?: string;
  maxInputTokens: number;
  supportsGuidedJson: boolean;
  modelVersion: string;
}

/** A topic the note might attach to (retrieved by name/embedding similarity — pass 8). */
export interface TopicStub {
  id: string;
  name: string;
  description?: string;
  memberTitles?: string[];
}

/** A candidate neighbor note (retrieved top-k; summaries, never full bodies — D12). */
export interface NoteStub {
  relPath: string;
  title: string;
  summary?: string;
}

export interface SuggestedTopic {
  name: string;
  existingTopicId: string | null;
  reason: string;
  confidence: number;
  /** Proposed parent topic name (pass-8 hierarchy — applied after it recurs; optional). */
  parentName?: string;
  /** Proposed related topic names (pass-8; applied after recurrence; optional). */
  relatedNames?: string[];
}
export interface SuggestedLink {
  target: string; // wikilink target text
  targetPath?: string; // resolved relPath when the suggestion points at a real note
  reason: string;
  confidence: number;
}
export interface SuggestedTag {
  name: string;
  reason: string;
  confidence: number;
}
export interface SuggestedAlias {
  name: string;
  reason: string;
  confidence: number;
}

/** The output of `enrichNote`: attach-or-create topics, links, tags, an optional summary and
 *  aliases — every item carries a human-readable `reason` and a `confidence` (D6/D6a). */
export interface EnrichResult {
  topics: SuggestedTopic[];
  links: SuggestedLink[];
  tags: SuggestedTag[];
  summary: { text: string; reason: string; confidence: number } | null;
  aliases: SuggestedAlias[];
}

export interface SummarizeRequest {
  text: string;
  maxWords: number;
}
export interface EnrichRequest {
  text: string;
  title: string;
  folderPath: string;
  existingTopics: TopicStub[];
  candidateNotes: NoteStub[];
}
export interface LabelSimilarityRequest {
  a: NoteStub;
  b: NoteStub;
}

export interface AiClient {
  readonly id: AiBackendKind;
  /** Exact model version (e.g. `mock@1`), stamped into annotations (D26 hash-gating key). */
  readonly modelId: string;
  /** True iff this backend sends note content off-device (router blocks it for localOnly, D18). */
  readonly isNetwork: boolean;

  capabilities(): Promise<AiCapabilities>;
  summarize(req: SummarizeRequest): Promise<{ summary: string }>;
  enrichNote(req: EnrichRequest): Promise<EnrichResult>;
  labelSimilarity(
    req: LabelSimilarityRequest,
  ): Promise<{ related: boolean; reason: string; confidence: number }>;
}
