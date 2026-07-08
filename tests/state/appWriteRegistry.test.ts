// S8 app-write tagging: content-hash matching, 5s window, consume-once, path ops.

import { describe, expect, it } from 'vitest';
import { AppWriteRegistry, APP_WRITE_WINDOW_MS } from '../../src/state/appWriteRegistry';
import { makeClock } from '../helpers/nodeStorage';

describe('AppWriteRegistry (S8)', () => {
  it('classifies a matching content write as app-write and consumes it once', () => {
    const clock = makeClock();
    const reg = new AppWriteRegistry(clock.now);
    reg.recordWrite('a.md', 'hash1');
    expect(reg.classify('a.md', 'hash1')).toBe('app-write');
    // Consumed — a second identical echo (e.g. a real external edit) reads as external.
    expect(reg.classify('a.md', 'hash1')).toBe('external');
  });

  it('does NOT misclassify an external edit whose content differs within the window', () => {
    const clock = makeClock();
    const reg = new AppWriteRegistry(clock.now);
    reg.recordWrite('a.md', 'hash1');
    // Different bytes → different hash → external, even inside the 5s window (S8).
    expect(reg.classify('a.md', 'hash2')).toBe('external');
  });

  it('expires signatures after the 5s window', () => {
    const clock = makeClock();
    const reg = new AppWriteRegistry(clock.now);
    reg.recordWrite('a.md', 'hash1');
    clock.advance(APP_WRITE_WINDOW_MS + 1);
    expect(reg.classify('a.md', 'hash1')).toBe('external');
  });

  it('gives each rapid successive write its own signature', () => {
    const clock = makeClock();
    const reg = new AppWriteRegistry(clock.now);
    reg.recordWrite('a.md', 'h1');
    reg.recordWrite('a.md', 'h2');
    expect(reg.classify('a.md', 'h2')).toBe('app-write');
    expect(reg.classify('a.md', 'h1')).toBe('app-write');
    expect(reg.classify('a.md', 'h1')).toBe('external');
  });

  it('classifies delete echoes via recorded path ops', () => {
    const clock = makeClock();
    const reg = new AppWriteRegistry(clock.now);
    reg.recordPathOp('a.md');
    expect(reg.classify('a.md', null)).toBe('app-write');
    expect(reg.classify('a.md', null)).toBe('external'); // consumed
  });

  it('preserves the write kind (restore = app-write-content-change)', () => {
    const clock = makeClock();
    const reg = new AppWriteRegistry(clock.now);
    reg.recordWrite('a.md', 'h1', 'app-write-content-change');
    expect(reg.classify('a.md', 'h1')).toBe('app-write-content-change');
  });
});
