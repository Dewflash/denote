// src/services/snapshots.ts — copy-on-write local history (D21). Snapshots are written under
// `.denote/snapshots/<relPath>/<epochMillis>.md` on meaningful change, debounced, and pruned
// by age/size. The policy decisions here are pure and unit-tested; the Repository does the IO.

export const MIN_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // ≥5 min between snapshots per note
export const SIZE_DELTA_FRACTION = 0.3; // …unless size changed by ≥30%
export const DAY_MS = 24 * 60 * 60 * 1000;
export const MONTH_MS = 30 * DAY_MS;
export const VAULT_SNAPSHOT_CAP_BYTES = 50 * 1024 * 1024; // 50MB/vault

/** State the Repository tracks per note to gate snapshotting. */
export interface SnapshotGate {
  lastSnapshotAt?: number;
  lastSize?: number;
}

/** Decide whether to snapshot now (D21): first snapshot always; else ≥5 min elapsed OR ≥30%
 *  size delta. */
export function shouldSnapshot(gate: SnapshotGate, newSize: number, now: number): boolean {
  if (gate.lastSnapshotAt === undefined || gate.lastSize === undefined) return true;
  if (now - gate.lastSnapshotAt >= MIN_SNAPSHOT_INTERVAL_MS) return true;
  const denom = Math.max(gate.lastSize, 1);
  return Math.abs(newSize - gate.lastSize) / denom >= SIZE_DELTA_FRACTION;
}

/** A stored snapshot file (name = `<epochMillis>.md`). */
export interface SnapshotFile {
  name: string;
  at: number; // parsed from the filename
  size: number;
}

/** Parse `<epochMillis>.md` → epoch ms, or null if not a snapshot filename. */
export function parseSnapshotName(name: string): number | null {
  const m = /^(\d+)\.md$/.exec(name);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function snapshotFileName(at: number): string {
  return `${at}.md`;
}

/**
 * Retention decision for ONE note's snapshots (D21): keep everything <24h; between 24h and 30d
 * keep the newest per calendar-day bucket; beyond 30d keep the newest per week bucket. Returns
 * the names to delete. Deterministic (age buckets are relative to `now`).
 */
export function selectExpired(files: SnapshotFile[], now: number): string[] {
  const del: string[] = [];
  const keptDaily = new Set<number>();
  const keptWeekly = new Set<number>();
  // Newest first so the first entry seen in each bucket is the one we keep.
  const sorted = [...files].sort((a, b) => b.at - a.at);
  for (const f of sorted) {
    const age = now - f.at;
    if (age < DAY_MS) continue; // keep all recent
    if (age < MONTH_MS) {
      const bucket = Math.floor(f.at / DAY_MS);
      if (keptDaily.has(bucket)) del.push(f.name);
      else keptDaily.add(bucket);
    } else {
      const bucket = Math.floor(f.at / (7 * DAY_MS));
      if (keptWeekly.has(bucket)) del.push(f.name);
      else keptWeekly.add(bucket);
    }
  }
  return del;
}

/** A snapshot file tagged with its owning note (for the vault-wide size cap). */
export interface VaultSnapshotFile extends SnapshotFile {
  relPath: string; // owning note
}

/**
 * Enforce the per-vault byte cap (D21): while total size exceeds the cap, drop the oldest
 * snapshot across the whole vault. Returns the files to delete (oldest-first).
 */
export function selectOverCap(
  files: VaultSnapshotFile[],
  capBytes: number = VAULT_SNAPSHOT_CAP_BYTES,
): VaultSnapshotFile[] {
  let total = files.reduce((s, f) => s + f.size, 0);
  if (total <= capBytes) return [];
  const oldestFirst = [...files].sort((a, b) => a.at - b.at);
  const del: VaultSnapshotFile[] = [];
  for (const f of oldestFirst) {
    if (total <= capBytes) break;
    del.push(f);
    total -= f.size;
  }
  return del;
}
