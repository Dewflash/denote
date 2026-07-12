// src/services/aiClient — the AiClient contract (MASTERPLAN §6) + backends. Pass 6 ships the
// mock backend and the routing/D18 layer; apple (pass 7) and anthropic (pass 9) slot in behind
// the same interface with no downstream changes.

export * from './types';
export * from './router';
export { MockAiClient, MOCK_MODEL_ID } from './mock';
export {
  AppleAiClient,
  APPLE_MODEL_ID,
  normalizeTag,
  createTauriSidecarTransport,
  type SidecarTransport,
} from './apple';
export {
  AnthropicAiClient,
  DEFAULT_ANTHROPIC_MODELS,
  ENRICH_SCHEMA,
  safeJson,
  createAnthropicTransport,
  type AnthropicTransport,
  type AnthropicMessageRequest,
  type AnthropicMessageResponse,
  type BatchRequestItem,
  type BatchResultItem,
  type BatchLifecycle,
  type AnthropicModels,
  type CacheableText,
} from './anthropic';
export * from './pricing';
