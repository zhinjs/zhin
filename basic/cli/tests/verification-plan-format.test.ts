// #1250 verification-plan-empty-unexplained: `zhin packages verification-plan` explains an empty
// check list and a null generation; --json keeps the raw structure.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatVerificationPlan } from '../src/utils/verification-plan-format.js';

const offline = { packageName: 'zhin.js-weather', instanceKey: 'weather', generation: null, projectRevision: 'rev-1', checkRevision: 'chk-1', checks: [] };

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); vi.doUnmock('@zhin.js/gateway/plugin-management'); });

describe('formatVerificationPlan', () => {
  it('offline: says the null generation and the missing checks come from not asking the running instance', () => {
    const text = formatVerificationPlan(offline).join('\n');
    expect(text).toContain('插件实例 weather（包 zhin.js-weather）的验证计划（离线）');
    expect(text).toContain('离线查询不连接运行中的实例，这不表示插件没有加载');
    expect(text).toContain('加 --live <host-url> 查看可执行的检查');
    expect(text).not.toContain('null');
    expect(text).not.toContain('[]');
  });

  it('live without checks: the plugin declares none, and that is not a failed query', () => {
    const text = formatVerificationPlan({ ...offline, generation: 7 }, { live: 'http://127.0.0.1:8068' }).join('\n');
    expect(text).toContain('当前 generation: 7');
    expect(text).toContain('这个插件没有声明业务检查');
    expect(text).toContain('definePlugin 的 setup 中返回 verification');
    expect(text).toContain('查询本身成功');
  });

  it('live with a null generation explains the instance has not published one', () => {
    expect(formatVerificationPlan(offline, { live: 'http://127.0.0.1:8068' }).join('\n')).toContain('运行中的实例还没有发布 generation');
  });

  it('lists checks with scope, side effects and the exact verify command', () => {
    const text = formatVerificationPlan({
      ...offline,
      generation: 3,
      checks: [{ id: 'fetch', title: 'Fetch forecast', titleI18n: { 'zh-CN': '拉取天气' }, effects: ['calls the API'], scope: 'platform' }],
    }, { live: 'http://127.0.0.1:8068' }).join('\n');
    expect(text).toContain('业务检查（1）:');
    expect(text).toContain('  - fetch  拉取天气  [平台]');
    expect(text).toContain('      副作用: calls the API');
    expect(text).toContain('zhin packages verify weather <check-id> --live http://127.0.0.1:8068 --generation 3 --project-revision rev-1 --check-revision chk-1');
  });
});

describe('zhin packages verification-plan', () => {
  async function run(args: string[]): Promise<string> {
    vi.doMock('@zhin.js/gateway/plugin-management', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@zhin.js/gateway/plugin-management')>();
      return { ...actual, PluginManagementWorkflow: class { async verificationPlan() { return offline; } } };
    });
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...items: unknown[]) => { lines.push(items.join(' ')); });
    const { packagesCommand } = await import('../src/commands/packages.js');
    await packagesCommand.parseAsync(['node', 'packages', 'verification-plan', 'weather', ...args]);
    return lines.join('\n');
  }

  it('prints readable text by default', async () => {
    const text = await run([]);
    expect(text).toContain('的验证计划（离线）');
    expect(() => JSON.parse(text)).toThrow();
  });

  it('prints the raw structure with --json', async () => {
    expect(JSON.parse(await run(['--json']))).toEqual(offline);
  });
});
