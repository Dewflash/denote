// src/features/ai/AiProvisionalBar.tsx — the editor's "AI provisional" affordance (S10). When the
// active note carries an `ai:` block (takeover applied provisional structure to a bare note), its
// tags/links are surfaced here in muted, dashed styling — clearly NOT part of the body text, and
// clearly reversible. The moment the user adds their own structure the block is demoted and this
// bar disappears (the engine handles the demotion; this just reflects the parsed note).

import { useVaultStore } from '../../state/vaultStore';

export function AiProvisionalBar() {
  const repo = useVaultStore((s) => s.repo);
  const activeNotePath = useVaultStore((s) => s.activeNotePath);
  // revision is the re-derive signal — the parsed note (and its ai: block) changes with it.
  useVaultStore((s) => s.revision);

  if (!repo || !activeNotePath) return null;
  const ai = repo.getParsed(activeNotePath)?.aiFrontmatter;
  if (!ai) return null;
  const chips = [
    ...(ai.tags ?? []).map((t) => ({ kind: 'tag' as const, label: `#${t}` })),
    ...(ai.links ?? []).map((l) => ({ kind: 'link' as const, label: `[[${l}]]` })),
  ];
  if (chips.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 px-3 py-1.5 text-xs"
      style={{ borderBottom: '1px solid var(--border)', backgroundColor: 'var(--bg-panel)' }}
      title="Provisional AI structure (stored in the note's ai: metadata block; reversible). Add your own tag or link to dismiss it."
    >
      <span
        className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
        style={{ border: '1px solid var(--accent)', color: 'var(--accent)' }}
      >
        AI provisional
      </span>
      {chips.map((c) => (
        <span
          key={`${c.kind}:${c.label}`}
          className="rounded px-1.5 py-0.5"
          style={{
            border: '1px dashed var(--fg-muted)',
            color: 'var(--fg-muted)',
            fontFamily: 'var(--font-editor)',
          }}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}
