import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { projectDisplayLocale } from '../src/utils/cli-locale.js';
import { contentLines, nextRunSummary } from '../src/utils/assistant-jobs.js';
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

  // #1250 cli-datetime-us-locale (retest): the tester's system ran with an en_US locale. A real Node
  // child with LANG / LC_ALL = en_US and its own TZ, so the process default locale and zone are the
  // ones a US system gives, not this test runner's.
  it('prints YYYY-MM-DD HH:mm:ss in a process started with LANG=en_US and another TZ', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    const tsx = path.join(root, 'node_modules/tsx/dist/loader.mjs');
    const code = [
      `const { nextRunSummary } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'basic/cli/src/utils/assistant-jobs.ts')).href)});`,
      `const { formatJobSchedule } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'basic/cli/src/commands/watch-format.ts')).href)});`,
      'const at = Date.UTC(2026, 10, 17, 14, 0, 0);',
      "process.stdout.write(JSON.stringify([Intl.DateTimeFormat().resolvedOptions().locale, new Date(at).toLocaleString(),",
      "  nextRunSummary({ enabled: true, state: { nextRunAtMs: at }, schedule: { kind: 'solar', cron: '0 0 9 * * *' } }),",
      "  formatJobSchedule({ kind: 'at', atMs: at })]));",
    ].join('\n');
    const out = execFileSync(process.execPath, ['--conditions=development', '--import', pathToFileURL(tsx).href, '--input-type=module', '--eval', code], {
      cwd: root, encoding: 'utf8',
      env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', TZ: 'America/New_York', NODE_ENV: 'test' },
    });
    const [locale, native, next, at] = JSON.parse(out) as string[];
    // The child really runs with the US defaults (an ICU without en-US data would report another locale).
    if (locale === 'en-US') expect(native).toBe('11/17/2026, 9:00:00 AM');
    expect(next).toBe('2026-11-17 09:00:00');
    expect(at).toBe('at 2026-11-17 09:00');
  });

  it('schedule list indents every content line and cuts after 2 lines with a --json hint (#1250)', () => {
    expect(contentLines('早报')).toEqual(['    内容:   早报']);
    expect(contentLines('第一行\n第二行')).toEqual(['    内容:   第一行', '            第二行']);
    expect(contentLines('一\r\n二\n三\n四')).toEqual([
      '    内容:   一',
      '            二',
      '            …（共 4 行，完整内容用 zhin schedule list --json 查看）',
    ]);
  });
});
