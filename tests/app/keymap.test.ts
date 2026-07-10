import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BINDINGS,
  KeymapRegistry,
  comboFromEvent,
  formatCombo,
  EDITOR_ROOT_ATTR,
} from '../../src/app/keymap';

describe('KeymapRegistry defaults (S21)', () => {
  it('registers all defaults without a combo collision', () => {
    expect(() => new KeymapRegistry()).not.toThrow();
    const reg = new KeymapRegistry();
    expect(reg.all()).toHaveLength(DEFAULT_BINDINGS.length);
  });

  it('rejects a duplicate combo at registration time', () => {
    const reg = new KeymapRegistry([]);
    reg.registerBinding('a', 'cmd-n', 'A');
    expect(() => reg.registerBinding('b', 'cmd-n', 'B')).toThrow(/already bound/);
  });

  it('rejects a duplicate id even with a different combo', () => {
    const reg = new KeymapRegistry([]);
    reg.registerBinding('a', 'cmd-n', 'A');
    expect(() => reg.registerBinding('a', 'cmd-o', 'A again')).toThrow(/already registered/);
  });

  it('setHandler on an unknown id throws', () => {
    const reg = new KeymapRegistry([]);
    expect(() => reg.setHandler('nope', () => {})).toThrow(/unknown binding/);
  });

  it('invoke runs the attached handler and reports whether one ran', () => {
    const reg = new KeymapRegistry([]);
    reg.registerBinding('new-note', 'cmd-n', 'New note');
    expect(reg.invoke('new-note')).toBe(false);
    let ran = false;
    reg.setHandler('new-note', () => {
      ran = true;
    });
    expect(reg.invoke('new-note')).toBe(true);
    expect(ran).toBe(true);
  });
});

describe('comboFromEvent', () => {
  it('requires the meta (cmd) key', () => {
    expect(comboFromEvent({ key: 'n', metaKey: false })).toBeNull();
  });

  it('normalizes cmd-n', () => {
    expect(comboFromEvent({ key: 'n', metaKey: true })).toBe('cmd-n');
  });

  it('normalizes cmd-shift-f', () => {
    expect(comboFromEvent({ key: 'F', metaKey: true, shiftKey: true })).toBe('cmd-shift-f');
  });

  it('normalizes cmd-,', () => {
    expect(comboFromEvent({ key: ',', metaKey: true })).toBe('cmd-,');
  });
});

describe('formatCombo (affordance tooltips — post-06 fix #1)', () => {
  it('renders cmd/shift/alt as Mac glyphs and uppercases the key', () => {
    expect(formatCombo('cmd-n')).toBe('⌘N');
    expect(formatCombo('cmd-shift-f')).toBe('⌘⇧F');
    expect(formatCombo('cmd-g')).toBe('⌘G');
  });

  it('leaves multi-char / punctuation keys intact', () => {
    expect(formatCombo('cmd-,')).toBe('⌘,');
  });
});

describe('EDITOR_ROOT_ATTR', () => {
  it('is a stable attribute name used to detect focus inside the editor', () => {
    expect(EDITOR_ROOT_ATTR).toBe('data-denote-editor-root');
  });
});
