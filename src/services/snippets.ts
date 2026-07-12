// src/services/snippets.ts — pass-10 CSS snippets.
// Snippets are scoped under `.snippet-scope` so Settings can stay outside that subtree and
// remain usable even if a snippet contains hostile rules like `* { display: none !important }`.

import type { AppSupportIO } from './appSupportStore';

export interface SnippetRecord {
  name: string;
  css: string;
  enabled: boolean;
}

export interface SnippetSettingsFile {
  version: 1;
  enabled: Record<string, boolean>;
}

const SETTINGS_PATH = 'snippets/settings.json';
const SNIPPETS_PREFIX = 'snippets/';

function isCssSnippet(name: string): boolean {
  return name.startsWith(SNIPPETS_PREFIX) && name.endsWith('.css') && !name.includes('/.');
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

export function scopeSnippetCss(css: string, scope = '.snippet-scope'): string {
  return css
    .split('}')
    .map((block) => {
      const i = block.indexOf('{');
      if (i < 0) return '';
      const selector = block.slice(0, i).trim();
      const body = block.slice(i + 1).trim();
      if (!selector || !body) return '';
      if (selector.startsWith('@')) return `${selector}{${body}}`;
      const scoped = selector
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => (s.startsWith(scope) ? s : `${scope} ${s}`))
        .join(', ');
      return `${scoped}{${body}}`;
    })
    .filter(Boolean)
    .join('\n');
}

export class SnippetStore {
  private settings: SnippetSettingsFile = { version: 1, enabled: {} };

  constructor(private readonly io: AppSupportIO) {}

  async load(): Promise<SnippetRecord[]> {
    await this.loadSettings();
    const list = this.io.list ? await this.io.list(SNIPPETS_PREFIX) : [];
    const records: SnippetRecord[] = [];
    for (const entry of list) {
      if (entry.isDir || !isCssSnippet(entry.name) || entry.name === SETTINGS_PATH) continue;
      const css = await this.io.read(entry.name);
      if (css == null) continue;
      const name = baseName(entry.name);
      records.push({
        name,
        css,
        enabled: this.settings.enabled[name] ?? false,
      });
    }
    return records.sort((a, b) => a.name.localeCompare(b.name));
  }

  async setEnabled(name: string, enabled: boolean): Promise<void> {
    await this.loadSettings();
    this.settings.enabled[name] = enabled;
    await this.persistSettings();
  }

  async writeSnippet(name: string, css: string, enabled = true): Promise<void> {
    const clean = baseName(name).replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || 'snippet.css';
    const fileName = clean.endsWith('.css') ? clean : `${clean}.css`;
    await this.io.write(`${SNIPPETS_PREFIX}${fileName}`, css);
    await this.setEnabled(fileName, enabled);
  }

  async enabledCss(): Promise<string> {
    const snippets = await this.load();
    return snippets
      .filter((s) => s.enabled)
      .map((s) => `/* ${s.name} */\n${scopeSnippetCss(s.css)}`)
      .join('\n\n');
  }

  private async loadSettings(): Promise<void> {
    const raw = await this.io.read(SETTINGS_PATH);
    if (!raw) {
      this.settings = { version: 1, enabled: {} };
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<SnippetSettingsFile>;
      this.settings = parsed.version === 1 && parsed.enabled && typeof parsed.enabled === 'object'
        ? { version: 1, enabled: parsed.enabled as Record<string, boolean> }
        : { version: 1, enabled: {} };
    } catch {
      this.settings = { version: 1, enabled: {} };
    }
  }

  private persistSettings(): Promise<void> {
    return this.io.write(SETTINGS_PATH, JSON.stringify(this.settings, null, 2) + '\n');
  }
}
