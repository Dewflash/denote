import { describe, expect, it, vi } from 'vitest';
import { loadMigratedJson, migrateJson } from '../../src/services/migrations';
import { memIO } from '../helpers/memIO';

describe('store migrations', () => {
  it('dispatches registered migrations to the current version', () => {
    const result = migrateJson(
      { version: 1, value: 'x' },
      { current: 2, migrations: { 1: (data) => ({ ...data, version: 2, touched: true }) } },
    );

    expect(result).toEqual({ data: { version: 2, value: 'x', touched: true }, migrated: true });
  });

  it('quarantines corrupt JSON', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1234);
    const io = memIO();
    await io.write('settings.json', '{broken');

    const result = await loadMigratedJson(io, 'settings.json');

    expect(result?.ok).toBe(false);
    expect(io.files.has('settings.json')).toBe(false);
    expect(io.files.has('settings.json.corrupt-1234')).toBe(true);
    vi.useRealTimers();
  });
});
