/**
 * #1250 `logs-cli-no-filter`: `zhin logs --level / --since / --until / --grep / --name`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  instanceLogFiles,
  LogLineFilter,
  parseLogFilterLevel,
  parseLogTime,
  readFilteredHistory,
} from '../../src/utils/log-filter.js';
import { logFilterOptions } from '../../src/commands/lifecycle.js';

const NOW = new Date(2026, 10, 15, 12, 0, 0, 0);

describe('parseLogTime', () => {
  it('reads durations, clock times, local date-times and zoned ISO times', () => {
    expect(parseLogTime('10m', '--since', NOW)).toEqual(new Date(2026, 10, 15, 11, 50));
    expect(parseLogTime('2d', '--since', NOW)).toEqual(new Date(2026, 10, 13, 12, 0));
    expect(parseLogTime('09:00', '--since', NOW)).toEqual(new Date(2026, 10, 15, 9, 0));
    expect(parseLogTime('2026-11-14 08:30', '--since', NOW)).toEqual(new Date(2026, 10, 14, 8, 30));
    expect(parseLogTime('2026-11-14', '--since', NOW)).toEqual(new Date(2026, 10, 14));
    expect(parseLogTime('2026-11-14T08:30:00Z', '--since', NOW)).toEqual(new Date(Date.UTC(2026, 10, 14, 8, 30)));
    expect(() => parseLogTime('yesterday', '--since', NOW)).toThrow('--since 无法识别「yesterday」');
  });

  it('validates the level and the window', () => {
    expect(parseLogFilterLevel('WARN')).toBe('warn');
    expect(() => parseLogFilterLevel('fatal')).toThrow('--level 必须是');
    expect(logFilterOptions({ interval: '1000' })).toBeUndefined();
    expect(() => logFilterOptions({ interval: '1000', since: '10:00', until: '09:00' }, NOW)).toThrow('--since 晚于 --until');
  });
});

describe('LogLineFilter', () => {
  const lines = [
    'leading third-party output',
    '[2026-11-15 08:59:00.000][INFO] [schedule] tick',
    '[2026-11-15 09:00:01.000][ERROR] [schedule] weather job failed',
    '    at run (job.js:1:1)',
    '[2026-11-15 09:00:02.000][WARN] [icqq:12345] reconnecting',
    '[2026-11-15 09:00:03.000][DEBUG] [icqq] raw frame',
    '[09:00:04.000][ERROR] [schedule] written before the upgrade',
  ];
  const run = (filter: LogLineFilter) => lines.filter(line => filter.accept(line));

  it('keeps level and above, with the continuation lines of a kept entry', () => {
    expect(run(new LogLineFilter({ level: 'warn' }))).toEqual([lines[2], lines[3], lines[4], lines[6]]);
  });

  it('matches the logger name exactly or as a prefix', () => {
    expect(run(new LogLineFilter({ name: 'icqq' }))).toEqual([lines[4], lines[5]]);
    expect(run(new LogLineFilter({ name: 'ICQQ:12345' }))).toEqual([lines[4]]);
  });

  it('filters by time and counts entries without a date', () => {
    const filter = new LogLineFilter({ since: new Date(2026, 10, 15, 9, 0), until: new Date(2026, 10, 15, 9, 0, 2) });
    expect(run(filter)).toEqual([lines[2], lines[3], lines[4]]);
    expect(filter.undatedSkipped).toBe(1);
  });

  it('uses the capture time for lines without a date when the gateway gives one', () => {
    const filter = new LogLineFilter({ since: new Date(2026, 10, 15, 9, 0) });
    expect(filter.accept(lines[6]!, new Date(2026, 10, 15, 9, 0, 4).getTime())).toBe(true);
    expect(filter.accept(lines[6]!, new Date(2026, 10, 15, 8, 0).getTime())).toBe(false);
  });

  it('matches text case-insensitively, also in continuation lines and before any entry', () => {
    expect(run(new LogLineFilter({ grep: 'WEATHER' }))).toEqual([lines[2], lines[3]]);
    expect(run(new LogLineFilter({ grep: 'job.js' }))).toEqual([lines[3]]);
    expect(run(new LogLineFilter({ grep: 'third-party' }))).toEqual([lines[0]]);
    expect(run(new LogLineFilter({ grep: 'job.js', level: 'error' }))).toEqual([lines[3]]);
    expect(run(new LogLineFilter({ grep: 'job.js', level: 'warn', name: 'icqq' }))).toEqual([]);
  });
});

describe('readFilteredHistory', () => {
  let dir: string | undefined;
  afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = undefined; });

  it('reads rotated files oldest first and keeps the last N matches', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-log-filter-'));
    const file = path.join(dir, 'instance.log');
    fs.writeFileSync(`${file}.2`, '[2026-11-15 08:00:00.000][WARN] [a] oldest\n');
    fs.writeFileSync(`${file}.1`, '[2026-11-15 08:30:00.000][INFO] [a] middle\n[2026-11-15 08:31:00.000][WARN] [a] second\n');
    fs.writeFileSync(file, '[2026-11-15 09:00:00.000][WARN] [a] newest\n');
    const files = instanceLogFiles(file);
    expect(files).toEqual([`${file}.2`, `${file}.1`, file]);
    const all = await readFilteredHistory(files, new LogLineFilter({ level: 'warn' }), 10);
    expect(all.lines.map(line => line.split(' ').at(-1))).toEqual(['oldest', 'second', 'newest']);
    const last = await readFilteredHistory(files, new LogLineFilter({ level: 'warn' }), 2);
    expect(last).toEqual({ lines: [expect.stringContaining('second'), expect.stringContaining('newest')], matched: 3 });
  });
});
