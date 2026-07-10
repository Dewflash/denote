// src/features/ai — suggestions panel, provisional-structure affordance, consent gate.
// Renders AiAnnotation/AiFrontmatter data; never writes a note body directly (all writes route
// through the repository via vaultStore actions — see CLAUDE.md hard rules).

export { SuggestionsPanel } from './SuggestionsPanel';
export { AiProvisionalBar } from './AiProvisionalBar';
export { AiConsentModal } from './AiConsentModal';
