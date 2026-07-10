// src/domain/tokenBudget.ts — on-device token budgeting (S16). Foundation Models has a SMALL
// context; every prompt must be trimmed to fit. PURE and deterministic (no I/O), so the exact
// allocation + truncation rules are unit-tested against S16.
//
// Estimate: tokens ≈ ceil(chars / 3.5). For `enrichNote` against a model reporting
// `maxInputTokens = M`: reserve 15% for instructions/schema, then split the remainder 50% body /
// 25% existing-topic stubs / 25% candidate summaries. Body truncation keeps the top 60% of the
// body budget and the bottom 20%, joined by a truncation marker (headings live in the prose, so
// the leading chunk preserves the early ones — see the enrich caller).

export const TRUNCATION_MARKER = '\n[…truncated…]\n';
const CHARS_PER_TOKEN = 3.5;

/** S16 token estimate: ceil(chars / 3.5). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function tokensToChars(tokens: number): number {
  return Math.max(0, Math.floor(tokens * CHARS_PER_TOKEN));
}

export interface EnrichBudget {
  bodyTokens: number;
  topicsTokens: number;
  candidatesTokens: number;
}

/** Split a model's `maxInputTokens` into the S16 enrich allocation (after the 15% reservation). */
export function enrichBudget(maxInputTokens: number): EnrichBudget {
  const usable = Math.max(0, Math.floor(maxInputTokens * 0.85));
  return {
    bodyTokens: Math.floor(usable * 0.5),
    topicsTokens: Math.floor(usable * 0.25),
    candidatesTokens: Math.floor(usable * 0.25),
  };
}

/** Truncate `text` to at most `maxTokens`, keeping the first 60% and last 20% of the budget with
 *  a marker between (S16). Returns the text unchanged when it already fits. */
export function truncateToBudget(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const budgetChars = tokensToChars(maxTokens);
  const headChars = Math.floor(budgetChars * 0.6);
  const tailChars = Math.floor(budgetChars * 0.2);
  if (headChars + tailChars >= text.length) return text;
  const head = text.slice(0, headChars).trimEnd();
  const tail = text.slice(text.length - tailChars).trimStart();
  return `${head}${TRUNCATION_MARKER}${tail}`;
}

/** Keep at most `maxWords` words (topic descriptions ≤20 words, candidate summaries ≤50, S16). */
export function capWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  return words.slice(0, maxWords).join(' ') + '…';
}
