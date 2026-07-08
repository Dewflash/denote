// src/state/opLog.ts — the structural-ops undo stack (D38/S23). Two undo systems exist and must
// stay separate: CodeMirror's own history handles typing; this op-log handles structural
// mutations (rename refactor now; accept-suggestion/takeover/restore-snapshot arrive with their
// features in later passes and push onto the same stack). Bound to cmd-Z only when the editor
// does not have focus (src/app/keymap.ts already special-cases this).

export interface Op {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

export class OpLog {
  private undoStack: Op[] = [];
  private redoStack: Op[] = [];

  /** Record a completed op. Pushing always clears the redo stack (a fresh op invalidates it). */
  push(op: Op): void {
    this.undoStack.push(op);
    this.redoStack = [];
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  async undo(): Promise<void> {
    const op = this.undoStack.pop();
    if (!op) return;
    await op.undo();
    this.redoStack.push(op);
  }

  async redo(): Promise<void> {
    const op = this.redoStack.pop();
    if (!op) return;
    await op.redo();
    this.undoStack.push(op);
  }

  peekUndoLabel(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.label;
  }
}
