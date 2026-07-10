// src/services/aiClient/mock.ts — the deterministic MOCK backend. Seeded by note CONTENT so the
// same note always yields the same suggestions (hash-gating + rejection memory need this to be
// stable). Local (never network), so it is always allowed even for localOnly vaults (D18).
//
// It is intentionally *plausible*, not smart: it keys off concept keywords in the text to emit
// content-relevant tags/topics/links with SPECIFIC reasons and VARIED confidences (some above the
// 0.75 takeover threshold, some below), so every UI state — provisional apply, suggestion-only,
// accept, reject — is exercisable end-to-end with fake AI. Passes 7/9 swap in real intelligence
// behind the same AiClient contract with zero UI change.

import type {
  AiCapabilities,
  AiClient,
  EnrichRequest,
  EnrichResult,
  LabelSimilarityRequest,
  SuggestedLink,
  SuggestedTag,
  SuggestedTopic,
  SummarizeRequest,
} from './types';

export const MOCK_MODEL_ID = 'mock@1';

interface Concept {
  test: RegExp;
  tag: string;
  topic: string;
  reason: (title: string) => string;
}

// Concept keywords → a plausible tag + topic + a specific reason. Ordered; matches are stable.
const CONCEPTS: Concept[] = [
  {
    test: /\b(bank|banking|monetary|central bank|boj|fed)\b/i,
    tag: 'banking',
    topic: 'Banking',
    reason: (t) => `"${t}" discusses central-bank / monetary-policy mechanics.`,
  },
  {
    test: /\b(interest rate|interest rates|\brates\b|yield|bond)\b/i,
    tag: 'interest-rates',
    topic: 'Interest Rates',
    reason: (t) => `"${t}" centers on interest-rate / yield dynamics.`,
  },
  {
    test: /\b(yen|japan|japanese|intervention|tokyo)\b/i,
    tag: 'japan',
    topic: 'Japan',
    reason: (t) => `"${t}" references Japan / yen-market specifics.`,
  },
  {
    test: /\b(gold|bullion|precious metal|commodit)\b/i,
    tag: 'gold',
    topic: 'Commodities',
    reason: (t) => `"${t}" is about gold / commodity pricing.`,
  },
  {
    test: /\b(dollar|de-dollar|dedollar|reserve currency|fx|exchange rate)\b/i,
    tag: 'de-dollarization',
    topic: 'Currencies',
    reason: (t) => `"${t}" concerns reserve-currency / de-dollarization themes.`,
  },
  {
    test: /\b(embedding|embeddings|vector|semantic|retrieval|rag)\b/i,
    tag: 'embeddings',
    topic: 'Machine Learning',
    reason: (t) => `"${t}" covers embeddings / vector-retrieval techniques.`,
  },
  {
    test: /\b(local-first|offline|crdt|sync|self-host)\b/i,
    tag: 'local-first',
    topic: 'Software Architecture',
    reason: (t) => `"${t}" is about local-first / offline-sync software design.`,
  },
  {
    test: /\b(prayer|sermon|steward|faith|scripture|church|worship)\b/i,
    tag: 'faith',
    topic: 'Faith & Church',
    reason: (t) => `"${t}" is devotional / church-related writing.`,
  },
  {
    test: /\b(recipe|soup|cook|cooking|ingredient|miso|broth)\b/i,
    tag: 'cooking',
    topic: 'Cooking',
    reason: (t) => `"${t}" is a recipe / cooking note.`,
  },
];

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — a tiny deterministic PRNG seeded from the note content. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const round2 = (n: number): number => Math.round(n * 100) / 100;

function firstWords(text: string, n: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const head = words.slice(0, n).join(' ');
  return words.length > n ? `${head}…` : head;
}

export class MockAiClient implements AiClient {
  readonly id = 'mock' as const;
  readonly modelId = MOCK_MODEL_ID;
  readonly isNetwork = false;

  async capabilities(): Promise<AiCapabilities> {
    return {
      available: true,
      maxInputTokens: 8000,
      supportsGuidedJson: true,
      modelVersion: this.modelId,
    };
  }

  async summarize(req: SummarizeRequest): Promise<{ summary: string }> {
    return { summary: firstWords(req.text, Math.max(1, req.maxWords)) };
  }

  async enrichNote(req: EnrichRequest): Promise<EnrichResult> {
    const rng = makeRng(fnv1a(`${req.title}\n${req.folderPath}\n${req.text}`));
    const matched = CONCEPTS.filter((c) => c.test.test(req.text) || c.test.test(req.title));

    const tags: SuggestedTag[] = [];
    const topics: SuggestedTopic[] = [];
    const seenTag = new Set<string>();
    const seenTopic = new Set<string>();

    for (const c of matched) {
      if (!seenTag.has(c.tag)) {
        seenTag.add(c.tag);
        tags.push({ name: c.tag, reason: c.reason(req.title), confidence: round2(clamp01(0.82 + rng() * 0.12)) });
      }
      if (!seenTopic.has(c.topic)) {
        seenTopic.add(c.topic);
        const existing = req.existingTopics.find(
          (t) => t.name.toLowerCase() === c.topic.toLowerCase(),
        );
        topics.push({
          name: c.topic,
          existingTopicId: existing?.id ?? null,
          reason: c.reason(req.title),
          confidence: round2(clamp01(0.78 + rng() * 0.14)),
        });
      }
    }

    // Always emit one lower-confidence folder tag (suggestion-only — below threshold) so a note
    // with no concept match still has something to react to, and so not everything auto-applies.
    const folderTag = folderLeaf(req.folderPath);
    if (folderTag && !seenTag.has(folderTag)) {
      tags.push({
        name: folderTag,
        reason: `Filed under the "${folderTag}" folder; weak organizational signal.`,
        confidence: round2(clamp01(0.5 + rng() * 0.15)),
      });
    }

    // Links: candidate neighbors that share a matched concept get a plausible, resolvable link.
    const links: SuggestedLink[] = [];
    const matchedTests = matched.map((c) => c.test);
    for (const n of req.candidateNotes.slice(0, 8)) {
      if (links.length >= 2) break;
      const hay = `${n.title} ${n.summary ?? ''}`;
      const sharedConcept = matched.find((c) => c.test.test(hay));
      if (sharedConcept) {
        links.push({
          target: n.title,
          targetPath: n.relPath,
          reason: `Shares the "${sharedConcept.topic}" theme with "${req.title}".`,
          confidence: round2(clamp01(0.7 + rng() * 0.2)),
        });
      } else if (links.length === 0 && matchedTests.length === 0 && rng() > 0.5) {
        // Nothing concept-matched: offer one weak link so link-suggestion UX is still reachable.
        links.push({
          target: n.title,
          targetPath: n.relPath,
          reason: `Nearby note in the same area of the vault as "${req.title}".`,
          confidence: round2(clamp01(0.45 + rng() * 0.15)),
        });
      }
    }

    const summaryText = firstWords(req.text, 24);
    const summary = summaryText
      ? { text: summaryText, reason: 'Condensed from the note’s opening lines.', confidence: 0.8 }
      : null;

    return { topics, links, tags, summary, aliases: [] };
  }

  async labelSimilarity(
    req: LabelSimilarityRequest,
  ): Promise<{ related: boolean; reason: string; confidence: number }> {
    const hayA = `${req.a.title} ${req.a.summary ?? ''}`;
    const hayB = `${req.b.title} ${req.b.summary ?? ''}`;
    const shared = CONCEPTS.find((c) => c.test.test(hayA) && c.test.test(hayB));
    if (!shared) return { related: false, reason: 'No specific shared concept found.', confidence: 0.2 };
    return {
      related: true,
      reason: `Both notes engage the "${shared.topic}" concept in substance, not just wording.`,
      confidence: 0.82,
    };
  }
}

function folderLeaf(folderPath: string): string {
  const leaf = folderPath.split('/').filter(Boolean).pop();
  if (!leaf) return '';
  return leaf.toLowerCase().replace(/[^a-z0-9_/-]+/g, '-').replace(/^-+|-+$/g, '');
}
