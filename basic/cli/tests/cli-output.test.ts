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
import { NpmViewError, npmViewFailure } from '../src/utils/plugin-registry.js';

const plugin = vi.hoisted(() => ({ info: undefined as unknown, search: {} as Record<string, unknown[] | Error>, queries: [] as string[] }));
vi.mock('../src/utils/plugin-registry.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/utils/plugin-registry.js')>(),
  npmView: () => {
    if (plugin.info instanceof Error) throw plugin.info;
    return plugin.info;
  },
  fetchWeeklyDownloads: async () => null,
  npmSearch: (query: string) => {
    plugin.queries.push(query);
    const page = plugin.search[query];
    if (page instanceof Error) throw page;
    return page ?? [];
  },
}));

// The date is present when stdout is not a terminal (#1250), as under the test runner.
const PREFIX = /\[(?:\d{4}-\d{2}-\d{2} )?\d{2}:\d{2}:\d{2}\.\d{3}\]\[(INFO|WARN|ERROR)\]/;
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
    // npm search maintainers carry `username` (#1250 cli-search-author-unknown).
    expect(packagePersonName({ username: 'lc-cn' })).toBe('lc-cn');
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

  function installFixture(manifest: Record<string, unknown> = {}, base = path.join(tmp, 'node_modules', '@demo', 'plugin-rss')): string {
    const root = base;
    const file = (relative: string, text = 'export default {}') => {
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
      fs.writeFileSync(path.join(root, relative), text);
    };
    file('package.json', JSON.stringify({ name: '@demo/plugin-rss', version: '1.0.0', ...manifest }));
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

  it('prints the info of an installed package from disk, unprefixed, with the author and the capability sections', async () => {
    // Local first (#1250 cli-info-local-workspace-plugin): the installed package.json, not npm.
    installFixture({
      description: 'RSS',
      author: 'Jane Doe <jane@example.com>',
      zhin: { features: [{ package: '@zhin.js/command', api: '^1.0.0' }] },
    });
    plugin.info = undefined;
    const { runPluginInfo } = await import('../src/commands/search.js');
    await runPluginInfo('@demo/plugin-rss');
    const text = stdout.join('\n');
    expect(text).toContain('👤 作者: Jane Doe');
    expect(text).not.toContain('作者: 未知');
    expect(text).toContain('功能: @zhin.js/command');
    expect(text).toContain('📍 来源: 已安装到当前项目');
    expect(text).toContain('未查询 npm');
    expect(text).toMatch(/⌨️ {2}命令（2）:\n {3}rss-add <url>\n {3}rss-list/);
    expect(text).toMatch(/Agent 工具（2）:\n {3}fetch_feed\n {3}rss_preview（技能 rss）/);
    expect(text).toContain('pollCron（string，默认 "0 */5 * * * *"） — 轮询频率');
    expect(text).toContain('zhin install @demo/plugin-rss@latest');
    expect(text).not.toContain('zhin packages');
    expect(text).not.toMatch(PREFIX);
    expect(stderr.join('')).not.toMatch(PREFIX);
  });

  it('describes a workspace plugin of this project without asking npm', async () => {
    fs.writeFileSync(path.join(tmp, 'zhin.config.yml'), 'configVersion: 2\nplugins: {}\n');
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'demo-bot', private: true }));
    fs.writeFileSync(path.join(tmp, 'pnpm-workspace.yaml'), 'packages:\n  - plugins/*\n');
    installFixture({ name: 'zhin.js-media-ai', private: true, description: '本地插件' }, path.join(tmp, 'plugins', 'media-ai'));
    plugin.info = undefined;
    const { runPluginInfo } = await import('../src/commands/search.js');
    await runPluginInfo('zhin.js-media-ai');
    const text = stdout.join('\n');
    expect(text).toContain('📦 名称: zhin.js-media-ai');
    expect(text).toContain('📍 来源: 本项目 workspace（plugins/media-ai）');
    expect(text).toMatch(/⌨️ {2}命令（2）:/);
    expect(text).toContain('pollCron');
    expect(text).toContain('无需安装');
    expect(text).not.toContain('npm view');
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('reports a package that is neither local nor on npm without the raw npm view failure', async () => {
    plugin.info = new NpmViewError('@demo/missing', true);
    const { runPluginInfo } = await import('../src/commands/search.js');
    try {
      await runPluginInfo('@demo/missing');
      const err = stderr.join('');
      expect(err).toContain('未找到插件: @demo/missing');
      expect(err).toContain('zhin search');
      expect(err).not.toContain('Command failed');
      expect(err).not.toContain('zhin packages search');
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = 0;
    }
  });

  it('says how to see the capabilities when the package is not installed', async () => {
    plugin.info = { name: '@demo/absent', version: '1.0.0', maintainers: ['bob <b@x>'] };
    const { runPluginInfo } = await import('../src/commands/search.js');
    await runPluginInfo('@demo/absent');
    const text = stdout.join('\n');
    expect(text).toContain('👤 作者: bob');
    expect(text).toContain('未安装到当前项目');
    expect(text).toContain('   zhin install @demo/absent');
    expect(text).not.toContain('zhin packages install');
  });

  it('zhin search: official packages come from the scope query; hints name zhin install / zhin info', async () => {
    plugin.queries = [];
    plugin.search = {
      'zhin.js 60s': [{ name: '@maptiler/weather', version: '4.0.1', keywords: ['maptiler', 'plugin', 'weather'] }],
      '@zhin.js 60s': [{ name: '@zhin.js/plugin-60s', version: '1.0.0', description: '60 秒读懂世界', maintainers: [{ username: 'lc-cn', email: 'x@example.com' }] }],
    };
    const { runPluginSearch } = await import('../src/commands/search.js');
    await runPluginSearch('60s', { limit: 20 });
    const text = stdout.join('\n');
    expect(plugin.queries).toEqual(['zhin.js 60s', '@zhin.js 60s']);
    expect(text).toContain('@zhin.js/plugin-60s@1.0.0');
    expect(text).not.toContain('@maptiler/weather');
    expect(text).toContain('作者: lc-cn');
    expect(text).toContain('安装: zhin install @zhin.js/plugin-60s');
    expect(text).toContain('使用 zhin info <包名> 查看插件详情');
    expect(text).not.toContain('zhin packages');
  });

  it('zhin search: a failing scope query keeps the text query results', async () => {
    plugin.queries = [];
    plugin.search = {
      'zhin.js rss': [{ name: 'zhin.js-rss', version: '2.0.0', description: 'RSS', keywords: ['zhin.js'] }],
      '@zhin.js rss': new Error('npm error code E429'),
    };
    const { runPluginSearch } = await import('../src/commands/search.js');
    await runPluginSearch('rss', { limit: 20 });
    expect(plugin.queries).toEqual(['zhin.js rss', '@zhin.js rss']);
    expect(stdout.join('\n')).toContain('zhin.js-rss@2.0.0');
    expect(stderr.join('')).toContain('部分 npm 搜索失败（@zhin.js rss）');
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('classifies npm view failures without echoing the command line', () => {
    const missing = npmViewFailure('x', Object.assign(new Error('Command failed: npm view x --json'), {
      stdout: JSON.stringify({ error: { code: 'E404', summary: 'Not Found - GET https://registry.npmjs.org/x' } }),
    }));
    expect(missing.notFound).toBe(true);
    expect(missing.message).not.toContain('Command failed');
    const offline = npmViewFailure('x', Object.assign(new Error('Command failed: npm view x --json'), {
      stdout: JSON.stringify({ error: { code: 'ENOTFOUND', summary: 'request failed' } }),
    }));
    expect(offline.notFound).toBe(false);
    expect(offline.message).toContain('ENOTFOUND');
    expect(offline.message).not.toContain('Command failed');
    expect(npmViewFailure('x', Object.assign(new Error('spawn npm ENOENT'), { code: 'ENOENT' })).message).toContain('找不到 npm 命令');
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
    // No gateway for this project: an explicit --host (#1250); the stub reports no project id.
    await scheduleCommand.parseAsync(['node', 'zhin', '--host', 'http://127.0.0.1:9321', '--allow-unverified-host', 'list']);
    const text = stdout.join('\n');
    expect(text).toContain('  j1 (早报)  [启用]');
    expect(text).toContain('    计划:   every 30m');
    // Every content line is indented under the label (#1250 schedule-list-multiline-content).
    expect(text).toContain('    内容:   汇报\n            第二行');
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

  it('zhin send without this project\'s gateway exits 1 and sends nothing to the configured port (#1250)', async () => {
    fs.writeFileSync(path.join(tmp, 'zhin.config.yml'), 'http:\n  port: 9321\n  token: secret\n');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`process.exit:${code}`); }) as never);
    const { sendCommand } = await import('../src/commands/send.js');
    await expect(sendCommand.parseAsync(['node', 'zhin', '-a', 'sandbox', '-e', 'sandbox', 'sandbox-user', 'hi'])).rejects.toThrow('process.exit:1');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(stderr.join('')).toContain('本项目的网关未运行');
  });

  it('zhin send refuses a local --host that reports no project id and sends only the health probe (#1250)', async () => {
    fs.writeFileSync(path.join(tmp, 'zhin.config.yml'), 'http:\n  port: 9321\n  token: secret\n');
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ success: true, status: 'ok' })));
    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`process.exit:${code}`); }) as never);
    const { sendCommand } = await import('../src/commands/send.js');
    await expect(sendCommand.parseAsync(['node', 'zhin', '-a', 'sandbox', '-e', 'sandbox', '--host', 'http://127.0.0.1:9321', 'sandbox-user', 'hi'])).rejects.toThrow('process.exit:1');
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual(['http://127.0.0.1:9321/pub/health']);
    expect(JSON.stringify(fetchSpy.mock.calls)).not.toContain('secret');
    expect(stderr.join('')).toContain('--allow-unverified-host');
  });

  it('zhin packages --live refuses a local host whose health probe fails, sending no token (#1250 security review)', async () => {
    fs.writeFileSync(path.join(tmp, 'zhin.config.yml'), 'http:\n  port: 9321\n');
    vi.stubEnv('ZHIN_CONSOLE_TOKEN', 'live-token');
    const fetchSpy = vi.fn(async (url: string) => {
      if (String(url).endsWith('/pub/health')) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
      return new Response(JSON.stringify({ success: true, data: {} }));
    });
    vi.stubGlobal('fetch', fetchSpy);
    const { packagesCommand } = await import('../src/commands/packages.js');
    await expect(packagesCommand.parseAsync(['node', 'zhin', 'status', 'demo', '--live', 'http://127.0.0.1:9321'])).rejects.toMatchObject({ code: 'project-unverified' });
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual(['http://127.0.0.1:9321/pub/health']);
    expect(JSON.stringify(fetchSpy.mock.calls)).not.toContain('live-token');
    vi.unstubAllEnvs();
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
    await expect(sendCommand.parseAsync(['node', 'zhin', '-a', 'sandbox', '-e', 'sandbox', '--host', 'http://127.0.0.1:9321', '--allow-unverified-host', 'sandbox-user', 'hi'])).rejects.toThrow('process.exit:1');
    const text = stderr.join('');
    expect(text).toContain('没有在线的客户端');
    expect(text).not.toContain('Internal error');
  });
});
