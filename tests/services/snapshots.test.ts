// D21 snapshot policy: debounce gate + age/size retention.

import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  MIN_SNAPSHOT_INTERVAL_MS,
  MONTH_MS,
  parseSnapshotName,
  selectExpired,
  selectOverCap,
  shouldSnapshot,
  snapshotFileName,
  type SnapshotFile,
  type VaultSnapshotFile,
} from '../../src/services/snapshots';

describe('shouldSnapshot (D21 debounce)', () => {
  const now = 10_000_000_000;
  it('always snapshots when there is no prior snapshot', () => {
    expect(shouldSnapshot({}, 100, now)).toBe(true);
  });
  it('snapshots after ≥5 min even with no size change', () => {
    const gate = { lastSnapshotAt: now - MIN_SNAPSHOT_INTERVAL_MS, lastSize: 100 };
    expect(shouldSnapshot(gate, 100, now)).toBe(true);
  });
  it('does not snapshot within 5 min for a small change', () => {
    const gate = { lastSnapshotAt: now - 60_000, lastSize: 100 };
    expect(shouldSnapshot(gate, 110, now)).toBe(false); // 10% change
  });
  it('snapshots within 5 min when size changes ≥30%', () => {
    const gate = { lastSnapshotAt: now - 60_000, lastSize: 100 };
    expect(shouldSnapshot(gate, 131, now)).toBe(true);
  });
});

describe('snapshot filenames', () => {
  it('round-trips epoch millis', () => {
    expect(parseSnapshotName(snapshotFileName(1720000000000))).toBe(1720000000000);
    expect(parseSnapshotName('notes.md')).toBeNull();
    expect(parseSnapshotName('123')).toBeNull();
  });
});

describe('selectExpired (D21 retention)', () => {
  const now = 100 * DAY_MS;
  it('keeps everything younger than 24h', () => {
    const files: SnapshotFile[] = [
      { name: 'a', at: now - 1000, size: 1 },
      { name: 'b', at: now - 2000, size: 1 },
    ];
    expect(selectExpired(files, now)).toEqual([]);
  });

  it('keeps one snapshot per day between 24h and 30d', () => {
    // Two snapshots on the same day, 3 days ago → keep newest, drop the other.
    const day = now - 3 * DAY_MS;
    const files: SnapshotFile[] = [
      { name: 'newer', at: day + 5000, size: 1 },
      { name: 'older', at: day + 1000, size: 1 },
    ];
    expect(selectExpired(files, now)).toEqual(['older']);
  });

  it('keeps one snapshot per week beyond 30d', () => {
    const wk = now - (MONTH_MS + 3 * DAY_MS); // >30d ago, same week bucket
    const files: SnapshotFile[] = [
      { name: 'newer', at: wk + DAY_MS, size: 1 },
      { name: 'older', at: wk, size: 1 },
    ];
    expect(selectExpired(files, now)).toEqual(['older']);
  });
});

describe('selectOverCap (D21 vault cap)', () => {
  it('drops oldest until under the cap', () => {
    const files: VaultSnapshotFile[] = [
      { relPath: 'a.md', name: '1', at: 1, size: 40 },
      { relPath: 'a.md', name: '2', at: 2, size: 40 },
      { relPath: 'b.md', name: '3', at: 3, size: 40 },
    ];
    const del = selectOverCap(files, 100); // total 120 > 100 → drop oldest (size 40)
    expect(del.map((f) => f.name)).toEqual(['1']);
  });
  it('returns nothing when under cap', () => {
    const files: VaultSnapshotFile[] = [{ relPath: 'a.md', name: '1', at: 1, size: 10 }];
    expect(selectOverCap(files, 100)).toEqual([]);
  });
});
