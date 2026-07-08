import { describe, expect, it } from 'vitest';
import { OpLog } from '../../src/state/opLog';

describe('OpLog (D38/S23)', () => {
  it('undo calls the inverse and moves the op to the redo stack', async () => {
    const log = new OpLog();
    const calls: string[] = [];
    log.push({
      label: 'rename a -> b',
      undo: async () => {
        calls.push('undo');
      },
      redo: async () => {
        calls.push('redo');
      },
    });
    expect(log.canUndo()).toBe(true);
    expect(log.canRedo()).toBe(false);
    await log.undo();
    expect(calls).toEqual(['undo']);
    expect(log.canUndo()).toBe(false);
    expect(log.canRedo()).toBe(true);
  });

  it('redo replays the forward op and moves it back to the undo stack', async () => {
    const log = new OpLog();
    const calls: string[] = [];
    log.push({
      label: 'op',
      undo: async () => calls.push('undo'),
      redo: async () => calls.push('redo'),
    });
    await log.undo();
    await log.redo();
    expect(calls).toEqual(['undo', 'redo']);
    expect(log.canUndo()).toBe(true);
    expect(log.canRedo()).toBe(false);
  });

  it('a new push clears the redo stack', async () => {
    const log = new OpLog();
    log.push({ label: 'a', undo: async () => {}, redo: async () => {} });
    await log.undo();
    expect(log.canRedo()).toBe(true);
    log.push({ label: 'b', undo: async () => {}, redo: async () => {} });
    expect(log.canRedo()).toBe(false);
  });

  it('undo/redo on an empty stack is a no-op', async () => {
    const log = new OpLog();
    await expect(log.undo()).resolves.toBeUndefined();
    await expect(log.redo()).resolves.toBeUndefined();
  });
});
