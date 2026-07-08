// src/services/errors.ts — typed error taxonomy (S20). Services never throw raw strings across
// a boundary; the UI maps `kind` to a surface (badge / toast / parked-jobs panel). Only the
// kinds reachable in this pass are exercised; the union is the full S20 set.

export type DenoteErrorKind =
  | 'fs'
  | 'parse'
  | 'ai-unavailable'
  | 'ai-timeout'
  | 'ai-invalid-output'
  | 'budget-exceeded'
  | 'local-only-blocked'
  | 'conflict'
  | 'corrupt-store';

export class DenoteError extends Error {
  readonly kind: DenoteErrorKind;
  readonly path?: string;
  readonly retryable: boolean;

  constructor(kind: DenoteErrorKind, detail: string, opts: { path?: string; retryable?: boolean } = {}) {
    super(detail);
    this.name = 'DenoteError';
    this.kind = kind;
    this.path = opts.path;
    this.retryable = opts.retryable ?? false;
  }
}
