import { describe, expect, it } from 'vitest';
import { newNoteBody } from '../../src/features/capture/newNote';

describe('new note capture', () => {
  it('starts a new note with a Markdown title matching its filename', () => {
    expect(newNoteBody('Inbox/Untitled.md')).toBe('# Untitled\n\n');
    expect(newNoteBody('Projects/Untitled 2.md')).toBe('# Untitled 2\n\n');
  });
});
