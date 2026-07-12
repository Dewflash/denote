import { describe, expect, it } from 'vitest';
import { SnippetStore, scopeSnippetCss } from '../../src/services/snippets';
import { memIO } from '../helpers/memIO';

describe('CSS snippets', () => {
  it('scopes hostile selectors under the app snippet scope', () => {
    expect(scopeSnippetCss('* { display: none !important }')).toBe('.snippet-scope *{display: none !important}');
    expect(scopeSnippetCss('main, aside { color: red }')).toBe('.snippet-scope main, .snippet-scope aside{color: red}');
  });

  it('loads only enabled snippets', async () => {
    const io = memIO();
    const store = new SnippetStore(io);
    await store.writeSnippet('hide.css', '* { display:none }', true);
    await store.writeSnippet('off.css', 'body { color:red }', false);

    const css = await store.enabledCss();

    expect(css).toContain('hide.css');
    expect(css).toContain('.snippet-scope *');
    expect(css).not.toContain('off.css');
  });
});
