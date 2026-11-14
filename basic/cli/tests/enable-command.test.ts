import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GatewayPackageTransactionResult } from '@zhin.js/console-protocol';
import { gatewaySocketPath, LocalControlServer } from '@zhin.js/gateway/local';
import { runPluginEnablement, type PluginEnablementLog } from '../src/commands/enable.js';
import { renderTransactionResult, type Output } from '../src/utils/gateway.js';

const dirs: string[] = [];
const servers: LocalControlServer[] = [];
const manifest = { protocol: 1, type: 'plugin', entry: './plugin.js', platformFeatures: false, features: [], plugins: [] };

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A project with one installed, declared plugin `reminder` (instance key `reminder`). */
async function project(config: Record<string, unknown> = { configVersion: 2, plugins: { reminder: 'reminder' }, reminder: {} }): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'zen-'));
  dirs.push(root);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'bot', version: '1.0.0', zhin: manifest, dependencies: { reminder: '1.0.0' } }));
  await writeFile(path.join(root, 'plugin.js'), 'export default {};');
  const plugin = path.join(root, 'node_modules', 'reminder');
  await mkdir(plugin, { recursive: true });
  await writeFile(path.join(plugin, 'package.json'), JSON.stringify({ name: 'reminder', version: '1.0.0', zhin: manifest }));
  await writeFile(path.join(plugin, 'plugin.js'), 'export default {};');
  await writeFile(path.join(root, 'zhin.config.json'), JSON.stringify(config));
  return root;
}

function capture(): PluginEnablementLog & Output & { text: () => string } {
  let text = '';
  const line = (value: string) => { text += `${value}\n`; };
  return { success: line, info: line, error: line, out: (value) => { text += value; }, err: (value) => { text += value; }, text: () => text };
}

const readConfig = async (root: string) => JSON.parse(await readFile(path.join(root, 'zhin.config.json'), 'utf8')) as Record<string, unknown>;

describe('zhin enable / disable without a gateway', () => {
  it('writes disable_plugins directly and reports that the next start applies it', async () => {
    const root = await project();
    const log = capture();
    expect(await runPluginEnablement('reminder', false, { cwd: root, log })).toBe(0);
    expect((await readConfig(root)).disable_plugins).toEqual(['reminder']);
    expect(log.text()).toContain('已停用插件实例 reminder（reminder），已更新 disable_plugins');
    expect(log.text()).toContain('下次 zhin start 时生效');
    expect(await runPluginEnablement('reminder', true, { cwd: root, log })).toBe(0);
    expect((await readConfig(root)).disable_plugins).toEqual([]);
  });

  it('succeeds without writing when the plugin already is in the requested state', async () => {
    const root = await project();
    const before = await readFile(path.join(root, 'zhin.config.json'), 'utf8');
    const log = capture();
    expect(await runPluginEnablement('reminder', true, { cwd: root, log })).toBe(0);
    expect(log.text()).toContain('已是启用状态，未修改配置');
    expect(await readFile(path.join(root, 'zhin.config.json'), 'utf8')).toBe(before);
  });

  it('exits with 1 for undeclared plugins, reserved keys and directories without a project', async () => {
    const root = await project();
    const log = capture();
    expect(await runPluginEnablement('weather', false, { cwd: root, log })).toBe(1);
    expect(log.text()).toContain('停用插件失败：找不到插件实例 weather（配置中没有声明）');
    expect(log.text()).not.toContain('zhin install weather');
    // An official short name gets the official package, never `zhin install reminder` (#1250).
    const bare = await project({ configVersion: 2, plugins: {} });
    expect(await runPluginEnablement('reminder', true, { cwd: bare, log })).toBe(1);
    expect(log.text()).toContain('zhin install @zhin.js/plugin-reminder');
    expect(log.text()).not.toMatch(/zhin install reminder(?![\w-])/u);
    expect(await runPluginEnablement('http', true, { cwd: root, log })).toBe(1);
    expect(log.text()).toContain('保留配置键');
    const empty = await mkdtemp(path.join(tmpdir(), 'zen-empty-'));
    dirs.push(empty);
    expect(await runPluginEnablement('reminder', true, { cwd: empty, log })).toBe(1);
    expect(log.text()).toContain('当前目录不是有效的项目');
  });
});

describe.runIf(process.platform !== 'win32')('zhin enable / disable through a running gateway', () => {
  it('sends gateway.plugins.disable and prints the transaction', async () => {
    const root = await project();
    const requests: unknown[] = [];
    const result: GatewayPackageTransactionResult = {
      id: 't1', operation: 'disable', packages: [{ name: 'reminder', spec: 'reminder', source: 'npm' }], ok: true, status: 'succeeded',
      plugin: { instanceKey: 'reminder', packageName: 'reminder', enabled: false, changed: true },
      instance: { before: 'running', after: 'running' }, startedAt: 1, finishedAt: 2,
    };
    servers.push(await LocalControlServer.open({
      path: gatewaySocketPath(root),
      handler: async (request, emit) => {
        if (request.type === 'gateway.info') return { ok: true, data: {} };
        requests.push(request);
        emit({ type: 'start', id: 't1', operation: 'disable', packages: result.packages });
        emit({ type: 'phase', id: 't1', phase: 'configure' });
        return { ok: true, data: result };
      },
    }));
    const output = capture();
    expect(await runPluginEnablement('reminder', false, { cwd: root, log: output, output })).toBe(0);
    expect(requests).toEqual([{ id: expect.any(Number), type: 'gateway.plugins.disable', data: { plugin: 'reminder' } }]);
    expect(output.text()).toContain('→ disable reminder');
    expect(output.text()).toContain('· 写入插件声明与配置');
    expect(output.text()).toContain('✓ 已停用插件实例 reminder（reminder），已更新 disable_plugins（实例 running → running）');
    // The gateway owns the write: the CLI does not touch the file itself.
    expect((await readConfig(root)).disable_plugins).toBeUndefined();
  });

  it('exits with 1 when the gateway rolls the change back or refuses it', async () => {
    const root = await project();
    servers.push(await LocalControlServer.open({
      path: gatewaySocketPath(root),
      handler: async (request) => (request.type === 'gateway.info' ? { ok: true, data: {} } : request.type === 'gateway.plugins.enable'
        ? { ok: true, data: { id: 't2', operation: 'enable', packages: [], ok: false, status: 'rolledBack', failedPhase: 'start-instance', error: 'boom', instance: { before: 'running', after: 'running' }, startedAt: 1, finishedAt: 2 } }
        : { ok: false, error: { code: 'invalid_input', message: '插件实例 x（x）未在配置中声明', status: 400 } }),
    }));
    const output = capture();
    expect(await runPluginEnablement('reminder', true, { cwd: root, log: output, output })).toBe(1);
    expect(output.text()).toContain('✗ enable 失败（阶段 start-instance），已回滚：boom');
    expect(await runPluginEnablement('x', false, { cwd: root, log: output, output })).toBe(1);
    expect(output.text()).toContain('停用插件失败：网关拒绝请求（invalid_input）：插件实例 x（x）未在配置中声明');
  });

  it('renders an unchanged plugin without claiming a restart', () => {
    expect(renderTransactionResult({
      id: 't3', operation: 'enable', packages: [], ok: true, status: 'succeeded',
      plugin: { instanceKey: 'reminder', packageName: 'reminder', enabled: true, changed: false },
      instance: { before: 'running', after: 'running' }, startedAt: 1, finishedAt: 1,
    })).toEqual(['✓ 插件实例 reminder（reminder）已是启用状态，未改动配置，实例未重启']);
  });
});

describe.runIf(existsSync(path.resolve(__dirname, '../lib/cli.js')))('built CLI', () => {
  it('registers enable and disable as top-level commands', () => {
    const help = execFileSync(process.execPath, [path.resolve(__dirname, '../lib/cli.js'), '--help'], { encoding: 'utf8', timeout: 20_000 });
    expect(help).toMatch(/^\s+enable <plugin>/mu);
    expect(help).toMatch(/^\s+disable <plugin>/mu);
  });
});
