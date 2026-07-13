import type { AiClient } from './aiClient';

export interface CaptureSuggestionResult {
  title: string;
  summary: string;
  tags: string[];
}

export interface CaptureSuggestionResponse {
  suggestion: CaptureSuggestionResult;
  unavailable?: { reason?: string; modelVersion: string };
}

/** Preflight direct capture work so an unavailable backend never receives generation calls. */
export async function suggestCaptureWithClients(
  summarizer: AiClient,
  enricher: AiClient,
  text: string,
  firstLine: string,
): Promise<CaptureSuggestionResponse> {
  const clients = [...new Set([summarizer, enricher])];
  const capabilities = await Promise.all(clients.map((client) => client.capabilities()));
  const unavailable = capabilities.find((capability) => !capability.available);
  if (unavailable) {
    return {
      suggestion: { title: firstLine, summary: '', tags: [] },
      unavailable: { reason: unavailable.reason, modelVersion: unavailable.modelVersion },
    };
  }

  const [{ summary }, enrich] = await Promise.all([
    summarizer.summarize({ text, maxWords: 40 }),
    enricher.enrichNote({
      text,
      title: firstLine,
      folderPath: 'Inbox',
      existingTopics: [],
      candidateNotes: [],
    }),
  ]);
  return {
    suggestion: {
      title: summary ? summary.split(/\s+/).slice(0, 8).join(' ') : firstLine,
      summary,
      tags: enrich.tags.map((tag) => tag.name).filter(Boolean).slice(0, 6),
    },
  };
}
