import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { projectDisplayLocale } from '../src/utils/cli-locale.js';
import { nextRunSummary } from '../src/utils/assistant-jobs.js';
import { formatJobSchedule, renderWatchText } from '../src/commands/watch-format.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe('CLI display language and dates (#1250)', () => {
  it('reads the project locale, defaults to zh-CN and honours an explicit override', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zhin-cli-locale-'));
    directories.push(root);
    expect(await projectDisplayLocale(root)).toBe('zh-CN');
    await writeFile(path.join(root, 'zhin.config.yml'), 'configVersion: 2\nlocale: en\n');
    expect(await projectDisplayLocale(root)).toBe('en');
    expect(await projectDisplayLocale(root, 'zh-CN')).toBe('zh-CN');
    expect(await projectDisplayLocale(root, 'fr')).toBe('zh-CN');
  });

  it('schedule list and watch print YYYY-MM-DD HH:mm:ss (24-hour), not the US locale', () => {
    const next = new Date(2026, 10, 16, 21, 0, 0).getTime();
    expect(nextRunSummary({ enabled: true, state: { nextRunAtMs: next }, schedule: { kind: 'cron', cron: '0 0 21 * * *' } } as never)).toBe('2026-11-16 21:00:00');
    expect(renderWatchText({ baseUrl: 'http://127.0.0.1:8068', fetchedAt: new Date(2026, 5, 5, 22, 4, 5) })).toContain('@ 22:04:05');
    // Local time (it used to print the UTC clock).
    expect(formatJobSchedule({ kind: 'at', atMs: new Date(2026, 5, 6, 9, 30).getTime() })).toBe('at 2026-06-06 09:30');
  });
});
