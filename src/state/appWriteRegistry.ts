// src/state/appWriteRegistry.ts — app-write tagging protocol (S8 / D23).
//
// The watcher WILL deliver events for the app's own writes. Without classification, pass 7
// re-runs enrichment on every save → infinite loop (R1). Before each repository write we
// record a signature (relPath, contentHash(newContent), now). On a watcher event we compute
// the file's contentHash; a matching, unexpired signature ⇒ this event is our own echo.
//
// The match is on CONTENT HASH, not path+time alone (S8): a real external edit that happens
// to land inside the 5s window must NOT be misclassified — its bytes differ, so its hash
// differs, so it correctly reads as `external`.

/** Write kinds. A restore/checkout (pass 11) is content-changing and DOES run the pipeline
 *  exactly once — it is tagged so the watcher knows the app caused it, but classified
 *  distinctly from an ordinary echo (S8). */
export type WriteKind = 'app-write' | 'app-write-content-change';
export type WatchClassification = 'external' | WriteKind;

interface Signature {
  hash: string;
  at: number;
  kind: WriteKind;
}

/** Signatures older than this are ignored / swept (S8). */
export const APP_WRITE_WINDOW_MS = 5000;

export class AppWriteRegistry {
  private byPath = new Map<string, Signature[]>();
  // Path-level ops (delete/rename source) have no content to hash; suppress their echoes by
  // path within the same window.
  private pathOps = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Record an expected content write before performing it. */
  recordWrite(relPath: string, contentHash: string, kind: WriteKind = 'app-write'): void {
    const list = this.byPath.get(relPath) ?? [];
    list.push({ hash: contentHash, at: this.now(), kind });
    this.byPath.set(relPath, list);
  }

  /** Record an expected path operation (delete / rename-from) whose echo carries no content. */
  recordPathOp(relPath: string): void {
    this.pathOps.set(relPath, this.now());
  }

  /**
   * Classify a watcher event. `contentHash` is the file's current hash, or null for a delete
   * event. A matching signature is CONSUMED (rapid successive app writes each push their own
   * signature, so each echo consumes exactly one — S8).
   */
  classify(relPath: string, contentHash: string | null): WatchClassification {
    const t = this.now();
    if (contentHash !== null) {
      const list = this.byPath.get(relPath);
      if (list) {
        for (let i = list.length - 1; i >= 0; i--) {
          const sig = list[i];
          if (t - sig.at > APP_WRITE_WINDOW_MS) continue;
          if (sig.hash === contentHash) {
            list.splice(i, 1);
            if (list.length === 0) this.byPath.delete(relPath);
            return sig.kind;
          }
        }
      }
    } else {
      const at = this.pathOps.get(relPath);
      if (at !== undefined && t - at <= APP_WRITE_WINDOW_MS) {
        this.pathOps.delete(relPath);
        return 'app-write';
      }
    }
    return 'external';
  }

  /** Drop expired signatures (housekeeping; safe to call periodically). */
  sweep(): void {
    const t = this.now();
    for (const [p, list] of this.byPath) {
      const kept = list.filter((s) => t - s.at <= APP_WRITE_WINDOW_MS);
      if (kept.length) this.byPath.set(p, kept);
      else this.byPath.delete(p);
    }
    for (const [p, at] of this.pathOps) {
      if (t - at > APP_WRITE_WINDOW_MS) this.pathOps.delete(p);
    }
  }
}
