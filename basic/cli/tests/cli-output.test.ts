/**
 * #1250: user-facing results go to stdout without a log prefix; diagnostics go to stderr and only
 * carry `[time][LEVEL] [CLI]` with --verbose; instance failures are classified, and an unexpected
 * one shows its log correlation id with --debug.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setCliFlags } from '../src/utils/cli-flags.js';
import { cliLogFormatter, logger } from '../src/utils/logger.js';
import { output } from '../src/utils/output.js';
import { describeHostFailure, findInstanceLogLines, reportHostFailure } from '../src/utils/host-error.js';
import {
  formatCommandRoute,
  manifestFeatureNames,
  packageAuthors,
  packagePersonName,
  readPackageCapabilities,
} from '../src/utils/package-capabilities.js';

const plugin = vi.hoisted(() => ({ info: undefined as unknown }));
vi.mock('../src/utils/plugin-registry.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/utils/plugin-registry.js')>(),
  npmView: () => plugin.info,
  fetchWeeklyDownloads: async () => null,
}));

const PREFIX = /\[\d{2}:\d{2}:\d{2}\.\d{3}\]\[(INFO|WARN|ERROR)\]/;
let stdout: string[];
let stderr: string[];
let tmp: string;
let prevCwd: string;

beforeEach(() => {
  stdout = [];
  stderr = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { stdout.push(args.join(' ')); });
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string) => { stderr.push(String(chunk)); return true; }) as never);
  prevCwd = process.cwd();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-cli-output-'));
  process.chdir(tmp);
});

afterEach(() => {
  setCliFlags({ verbose: false, debug: false });
  process.chdir(prevCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('output and diagnostics', () => {
  it('writes results to stdout as-is and diagnostics to stderr without a prefix unless --verbose', () => {
    output.line('第一行', '第二行');
    output.line();
    expect(stdout).toEqual(['第一行\n第二行', '']);

    logger.info('诊断信息');
    logger.warn('注意');
    expect(stderr.join('')).toContain('诊断信息\n');
    expect(stderr.join('')).not.toMatch(PREFIX);
    expect(stderr.join('')).not.toContain('[CLI]');

    setCliFlags({ verbose: true });
    logger.info('详细');
    expect(stderr.at(-1)).toMatch(PREFIX);
    expect(stderr.at(-1)).toContain('[CLI] 详细');
    // Nothing diagnostic reached stdout.
    expect(stdout).toEqual(['第一行\n第二行', '']);
  });

  it('marks warnings and errors without the timestamp prefix', () => {
    const entry = (level: 'warn' | 'error' | 'info') => ({ level, name: 'CLI', message: 'm', timestamp: new Date(), args: [] });
    expect(cliLogFormatter.format(entry('info'))).toBe('m');
    expect(cliLogFormatter.format(entry('warn'))).toMatch(/⚠.* m$/);
    expect(cliLogFormatter.format(entry('error'))).toMatch(/✖.* m$/);
  });
});

describe('zhin packages info', () => {
  it('reads author and maintainers in every npm shape', () => {
    expect(packagePersonName('Jane Doe <jane@example.com> (https://x.dev)')).toBe('Jane Doe');
    expect(packagePersonName({ name: 'Jane' })).toBe('Jane');
    expect(packagePersonName('<only@mail>')).toBeUndefined();
    // Nested / unbalanced brackets never leave partial markup behind.
    expect(packagePersonName('Eve <<script>a> (x)')).toBe('Eve');
    expect(packagePersonName('Bob (site) <bob@x>')).toBe('Bob');
    expect(packageAuthors({ author: 'Jane <j@x>' })).toEqual(['Jane']);
    expect(packageAuthors({ maintainers: ['a <a@x>', { name: 'b' }, 'a <a@x>'] })).toEqual(['a', 'b']);
    expect(packageAuthors({})).toEqual([]);
    expect(manifestFeatureNames([{ package: '@zhin.js/command', api: '^1.0.0' }, 'legacy', 3])).toEqual(['@zhin.js/command', 'legacy']);
    expect(formatCommandRoute('rss-add/[url]')).toBe('rss-add <url>');
    expect(formatCommandRoute('rss-check/[[url]]')).toBe('rss-check [url]');
    expect(formatCommandRoute('echo/[...text]')).toBe('echo <...text>');
  });

  function installFixture(): string {
    const root = path.join(tmp, 'node_modules', '@demo', 'plugin-rss');
    const file = (relative: string, text = 'export default {}') => {
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
      fs.writeFileSync(path.join(root, relative), text);
    };
    file('package.json', JSON.stringify({ name: '@demo/plugin-rss', version: '1.0.0' }));
    file('commands/rss-add/[url]/index.ts');
    file('commands/rss-list/index.js');
    file('tools/fetch_feed/index.ts');
    file('skills/rss/SKILL.md', '# rss');
    file('skills/rss/tools/rss_preview/index.ts');
    file('schema.json', JSON.stringify({ type: 'object', properties: {
      pollCron: { type: 'string', default: '0 */5 * * * *', description: '轮询频率' },
      maxItems: { type: 'number' },
    } }));
    return root;
  }

  it('lists commands, Agent tools and config fields statically from the installed package', async () => {
    const capabilities = await readPackageCapabilities(installFixture());
    expect(capabilities.commands).toEqual(['rss-add <url>', 'rss-list']);
    expect(capabilities.tools).toEqual(['fetch_feed', 'rss_preview（技能 rss）']);
    expect(capabilities.config).toEqual([
      { key: 'pollCron', type: 'string', default: '0 */5 * * * *', description: '轮询频率' },
      { key: 'maxItems', type: 'number' },
    ]);
  });

  it('prints the info to stdout, unprefixed, with the author and the capability sections', async () => {
    installFixture();
    plugin.info = {
      name: '@demo/plugin-rss', version: '1.0.0', description: 'RSS',
      author: 'Jane Doe <jane@example.com>',
      zhin: { features: [{ package: '@zhin.js/command', api: '^1.0.0' }] },
    };
    const { runPluginInfo } = await import('../src/commands/search.js');
    await runPluginInfo('@demo/plugin-rss');
    const text = stdout.join('\n');
    expect(text).toContain('👤 作者: Jane Doe');
    expect(text).not.toContain('作者: 未知');
    expect(text).toContain('功能: @zhin.js/command');
    expect(text).toMatch(/⌨️ {2}命令（2）:\n {3}rss-add <url>\n {3}rss-list/);
    expect(text).toMatch(/Agent 工具（2）:\n {3}fetch_feed\n {3}rss_preview（技能 rss）/);
    expect(text).toContain('pollCron（string，默认 "0 */5 * * * *"） — 轮询频率');
    expect(text).not.toMatch(PREFIX);
    expect(stderr.join('')).not.toMatch(PREFIX);
  });

  it('says how to see the capabilities when the package is not installed', async () => {
    plugin.info = { name: '@demo/absent', version: '1.0.0', maintainers: ['bob <b@x>'] };
    const { runPluginInfo } = await import('../src/commands/search.js');
    await runPluginInfo('@demo/absent');
    const text = stdout.join('\n');
    expect(text).toContain('👤 作者: bob');
    expect(text).toContain('未安装到当前项目');
  });
});

describe('zhin schedule list', () => {
  it('prints jobs as plain stdout lines', async () => {
    fs.writeFileSync(path.join(tmp, 'zhin.config.yml'), 'http:\n  port: 9321\n  token: secret\n');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ success: true, data: { jobs: [{
        id: 'j1', label: '早报', enabled: true, schedule: { kind: 'every', everyMs: 1_800_000 },
        notify: { channel: 'log' }, action: { prompt: '汇报\n第二行' },
      }] } }),
    }) as unknown as Response));
    const { scheduleCommand } = await import('../src/commands/schedule.js');
    await scheduleCommand.parseAsync(['node', 'zhin', 'list']);
    const text = stdout.join('\n');
    expect(text).toContain('  j1 (早报)  [启用]');
    expect(text).toContain('    计划:   every 30m');
    expect(text).toContain('    内容:   汇报\n第二行');
    expect(text).not.toMatch(PREFIX);
  });
});

describe('instance failures', () => {
  const internal = { ok: false, status: 502, code: 'internal_error', error: 'Internal error', errorId: 'err_0123456789ab' };

  it('shows an expected failure as its classified explanation, with the code under --debug', () => {
    const delivery = {
      ok: false, status: 502, code: 'delivery_failed', error: '发送失败：该会话没有在线的客户端（例如没有打开对应的 Sandbox 会话）',
      detail: { code: 'sandbox_delivery_unavailable', reason: 'no_live_client' },
    };
    expect(describeHostFailure(delivery, '发送失败', false)).toEqual([delivery.error]);
    expect(describeHostFailure(delivery, '发送失败', true)).toEqual([delivery.error, '错误码: delivery_failed，sandbox_delivery_unavailable（HTTP 502）']);
    expect(describeHostFailure({ ok: false, status: 0, error: undefined }, '发送失败', false)).toEqual(['发送失败']);
  });

  it('hides the correlation id of an unexpected failure unless --debug', () => {
    expect(describeHostFailure(internal, 'x', false)).toEqual(['实例内部错误（Internal error）', '加 --debug 查看日志关联 id，并据此在 zhin logs 中找到原因']);
    expect(describeHostFailure(internal, 'x', true)[1]).toContain('日志关联 id: err_0123456789ab');
  });

  it('--debug looks the id up in the instance log file when no gateway runs', async () => {
    fs.mkdirSync(path.join(tmp, '.zhin', 'logs'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.zhin', 'logs', 'instance.log'), [
      '[10:00:00.000][INFO] boot',
      '[10:00:01.000][WARN] [console] console_message_send_failed | errorId: err_0123456789ab | error: socket closed',
    ].join('\n') + '\n');
    expect(await findInstanceLogLines(tmp, 'err_0123456789ab')).toEqual([
      '[10:00:01.000][WARN] [console] console_message_send_failed | errorId: err_0123456789ab | error: socket closed',
    ]);
    // The id comes from the response body: a malformed one (here matching every line) is not searched.
    for (const errorId of ['', ']', '[', 'err_0123456789a', 'err_0123456789abX', 'console']) {
      expect(await findInstanceLogLines(tmp, errorId), errorId).toEqual([]);
    }
    setCliFlags({ debug: true });
    await reportHostFailure(internal, 'x', tmp);
    const text = stderr.join('');
    expect(text).toContain('实例内部错误');
    expect(text).toContain('err_0123456789ab');
    expect(text).toContain('error: socket closed');
    expect(stdout).toEqual([]);
  });

  it('zhin send shows the classified delivery failure instead of "Internal error"', async () => {
    fs.writeFileSync(path.join(tmp, 'zhin.config.yml'), 'http:\n  port: 9321\n  token: secret\n');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 502,
      json: async () => ({ success: false, code: 'delivery_failed', error: '发送失败：该会话没有在线的客户端（例如没有打开对应的 Sandbox 会话）',
        data: { code: 'sandbox_delivery_unavailable', reason: 'no_live_client', status: 'failed' } }),
    }) as unknown as Response));
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`process.exit:${code}`); }) as never);
    const { sendCommand } = await import('../src/commands/send.js');
    await expect(sendCommand.parseAsync(['node', 'zhin', '-a', 'sandbox', '-e', 'sandbox', 'sandbox-user', 'hi'])).rejects.toThrow('process.exit:1');
    const text = stderr.join('');
    expect(text).toContain('没有在线的客户端');
    expect(text).not.toContain('Internal error');
  });
});
