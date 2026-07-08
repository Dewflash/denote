// src/features/editor/autocomplete.ts — `[[` triggers note-title completion, `#` triggers
// known-tag completion (D19/pass-03 brief). Reads the same vaultContext the decorations use.

import { autocompletion, type CompletionSource } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import { vaultContextField } from './vaultContext';

const wikilinkSource: CompletionSource = (context) => {
  const match = context.matchBefore(/\[\[[^\]\n]*/);
  if (!match) return null;
  const query = match.text.slice(2).toLowerCase();
  const ctx = context.state.field(vaultContextField);
  const options = ctx.notes
    .filter((n) => n.title.toLowerCase().includes(query))
    .slice(0, 30)
    .map((n) => ({ label: n.title, detail: n.relPath, apply: `${n.title}]]` }));
  return { from: match.from + 2, options, validFor: /^[^\]\n]*$/ };
};

const tagSource: CompletionSource = (context) => {
  const match = context.matchBefore(/#[\p{L}\p{N}_/-]*/u);
  if (!match) return null;
  if (match.from === match.to && !context.explicit) return null;
  const query = match.text.slice(1).toLowerCase();
  const ctx = context.state.field(vaultContextField);
  const options = ctx.knownTags
    .filter((t) => t.toLowerCase().includes(query))
    .slice(0, 30)
    .map((t) => ({ label: `#${t}` }));
  return { from: match.from, options, validFor: /^#[\p{L}\p{N}_/-]*$/u };
};

export function wikilinkAndTagAutocomplete(): Extension {
  return autocompletion({ override: [wikilinkSource, tagSource] });
}
