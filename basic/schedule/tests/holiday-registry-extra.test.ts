import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expandRange } from '../src/data/holiday-registry.js';
import {
  getMaxHolidayYear,
  loadHolidayOverrides,
  onHolidayDataUpdate,
  updateData,
} from '../src/update-data.js';

const TEST_TMP_ROOT = join(process.cwd(), 'tests', '.tmp');

describe('holiday registry extras', () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      tempDir = '';
    }
  });

  it('batch updateData merges multiple years', async () => {
    await updateData({
      2030: {
        holidayRanges: [{ start: '2030-01-01', end: '2030-01-01', festival: '元旦' }],
        workdays: [],
      },
      2031: {
        holidayRanges: [{ start: '2031-05-01', end: '2031-05-01', festival: '劳动节' }],
        workdays: [],
      },
    });

    expect(getMaxHolidayYear()).toBe(2031);
  });

  it('batch updateData with persist writes override file', async () => {
    tempDir = join(TEST_TMP_ROOT, `batch-persist-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const path = join(tempDir, 'batch-overrides.json');

    await updateData(
      {
        2037: {
          holidayRanges: [{ start: '2037-01-01', end: '2037-01-01', festival: '元旦' }],
          workdays: [],
        },
      },
      { persist: path },
    );

    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('"2037"');
  });

  it('getHolidaySet returns null for unknown year', async () => {
    const { getHolidaySet, getWorkdaySet } = await import('../src/data/holiday-registry.js');
    expect(getHolidaySet(1800)).toBeNull();
    expect(getWorkdaySet(1800)).toBeNull();
  });

  it('loadHolidayOverrides reads persisted file', async () => {
    tempDir = join(TEST_TMP_ROOT, `load-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const path = join(tempDir, 'overrides.json');
    await writeFile(
      path,
      JSON.stringify({
        2032: {
          holidayRanges: [{ start: '2032-01-01', end: '2032-01-01', festival: '元旦' }],
          workdays: [],
        },
      }),
    );

    await loadHolidayOverrides(path);
    expect(getMaxHolidayYear()).toBeGreaterThanOrEqual(2032);
  });

  it('loadHolidayOverrides ignores missing file', async () => {
    await expect(
      loadHolidayOverrides(join(TEST_TMP_ROOT, 'missing-overrides.json')),
    ).resolves.toBeUndefined();
  });

  it('loadHolidayOverrides throws on invalid json file', async () => {
    tempDir = join(TEST_TMP_ROOT, `bad-json-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const path = join(tempDir, 'bad.json');
    await writeFile(path, 'not-json');

    await expect(loadHolidayOverrides(path)).rejects.toThrow();
  });

  it('updateData throws when year given without data or force', async () => {
    await expect(updateData(2099, { persist: true } as never)).rejects.toThrow(/force: true/);
  });

  it('updateData with persist true writes default-style override file', async () => {
    tempDir = join(TEST_TMP_ROOT, `persist-default-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const path = join(tempDir, 'holiday-overrides.json');

    await updateData(
      2033,
      { holidayRanges: [{ start: '2033-01-01', end: '2033-01-01', festival: '元旦' }], workdays: [] },
      { persist: path },
    );

    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('"2033"');
  });

  it('onHolidayDataUpdate notifies listeners', async () => {
    const listener = vi.fn();
    const off = onHolidayDataUpdate(listener);
    await updateData(2034, {
      holidayRanges: [{ start: '2034-01-01', end: '2034-01-01', festival: '元旦' }],
      workdays: [],
    });
    expect(listener).toHaveBeenCalled();
    off();
  });

  it('expandRange includes start and end dates', () => {
    expect(expandRange('2025-01-01', '2025-01-03')).toEqual([
      '2025-01-01',
      '2025-01-02',
      '2025-01-03',
    ]);
  });
});
