// `zhin status` shows adapter accounts, MCP servers and the attention inbox, read over the local
// gateway socket with a deadline; an unreadable source is 「无法读取」 (#1250 doctor-blind-to-runtime-health).
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readRuntimeState, renderRuntimeState, withDeadline } from '../src/utils/runtime-state.js';
import type { HostHttpConfig } from '../src/utils/host-http.js';

const gateway = vi.hoisted(() => ({
  info: undefined as undefined | Record<string, unknown>,
  reply: undefined as undefined | ((url: string, body: any) => { status: number; body: unknown } | Promise<never>),
}));
vi.mock('../src/utils/gateway.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/utils/gateway.js')>(),
  probeGateway: async () => gateway.info,
}));
vi.mock('@zhin.js/gateway/local', async importOriginal => ({
  ...await importOriginal<typeof import('@zhin.js/gateway/local')>(),
  probeLocalGateway: async () => (gateway.info ? { ok: true } : undefined),
  createLocalGatewayFetch: () => (async (url: string, init?: RequestInit) => {
    const answer = await gateway.reply!(url, init?.body ? JSON.parse(String(init.body)) : undefined);
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }),
}));

const endpoints = [
  { name: '1659488338', adapter: 'icqq', status: 'offline', connected: false, phase: 'failed', lastError: { category: 'auth', message: '登录失效', at: 1 } },
  { name: 'helper', adapter: 'kook', status: 'online', connected: true, phase: 'online' },
];
const mcp = { items: [{ name: 'github', connected: false, toolCount: 0, status: 'failed', lastError: { category: 'auth', message: '401', at: 1 } }], total: 1 };
const attention = {
  items: [{ id: 'mcp.disconnected:mcpServer=github', kind: 'mcp.disconnected', severity: 'warning', title: 'MCP 服务 github 未连接', detail: '401', source: 'mcp', since: '', revision: '', action: { label: '', path: '' } }],
  generatedAt: '', unavailable: ['logs'], unavailableDetails: [{ source: 'logs', reason: 'store busy' }],
};

function healthy(url: string, body: any): { status: number; body: unknown } {
  if (url.endsWith('/introspection/mcp?page=1&pageSize=200')) return { status: 200, body: { success: true, data: mcp } };
  if (body?.type === 'endpoint.list') return { status: 200, body: { success: true, data: { endpoints } } };
  if (body?.type === 'attention.list') return { status: 200, body: { success: true, data: attention } };
  return { status: 404, body: { success: false, error: 'not found' } };
}

const running = {
  gateway: { pid: 2 ** 30, mode: 'daemon', version: '1.4.0', args: [], ports: [8086], origins: [], startedAt: Date.now(), socket: 's' },
  instance: { state: 'running', pid: 1, restarts: 0 },
  consoleInitialized: true,
};

const dirs: string[] = [];
afterEach(async () => {
  gateway.info = undefined;
  gateway.reply = undefined;
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function project(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'zhin-status-'));
  dirs.push(root);
  await writeFile(path.join(root, 'zhin.config.yml'), 'http:\n  port: 8086\n');
  return root;
}

async function status(root: string, args: string[] = []): Promise<{ stdout: string; exitCode: number | undefined }> {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
  const previous = process.exitCode;
  process.exitCode = undefined;
  try {
    const { statusCommand } = await import('../src/commands/lifecycle.js');
    await statusCommand.parseAsync(['node', 'status', ...args]);
    return { stdout: stdout.mock.calls.map(call => String(call[0])).join(''), exitCode: process.exitCode as number | undefined };
  } finally {
    process.exitCode = previous;
    cwd.mockRestore();
    stdout.mockRestore();
    stderr.mockRestore();
  }
}

describe('zhin status runtime state', () => {
  it('prints each account, MCP server and the attention count', async () => {
    gateway.info = running;
    gateway.reply = healthy;
    const { stdout, exitCode } = await status(await project());
    expect(exitCode).toBeUndefined();
    expect(stdout).toContain('适配器账号：1/2 在线');
    expect(stdout).toContain('✗ icqq/1659488338：启动失败（登录失效）');
    expect(stdout).toContain('✓ kook/helper：在线');
    expect(stdout).toContain('✗ github：连接失败（401）');
    expect(stdout).toContain('需要你处理：1 项');
    expect(stdout).toContain('logs');
  });

  it('adds endpoints, mcp and attention to --json', async () => {
    gateway.info = running;
    gateway.reply = healthy;
    const parsed = JSON.parse((await status(await project(), ['--json'])).stdout);
    expect(parsed.endpoints).toEqual({ available: true, items: [
      { adapter: 'icqq', name: '1659488338', status: 'offline', phase: 'failed', lastError: '登录失效' },
      { adapter: 'kook', name: 'helper', status: 'online', phase: 'online' },
    ] });
    expect(parsed.mcp).toEqual({ available: true, items: [{ name: 'github', status: 'failed', toolCount: 0, lastError: '401' }] });
    expect(parsed.attention).toMatchObject({ available: true, items: [{ kind: 'mcp.disconnected', title: 'MCP 服务 github 未连接' }],
      unavailable: [{ source: 'logs', reason: 'store busy' }] });
  });

  it('degrades a failed read to 「无法读取」 and still exits 0', async () => {
    gateway.info = running;
    gateway.reply = (url, body) => (body?.type === 'endpoint.list' ? { status: 500, body: { success: false, error: 'boom' } } : healthy(url, body));
    const { stdout, exitCode } = await status(await project());
    expect(exitCode).toBeUndefined();
    expect(stdout).toContain('适配器账号：无法读取（boom）');
    expect(stdout).toContain('MCP 服务：');
  });

  it('does not read anything when the instance is not running', async () => {
    gateway.info = { ...running, instance: { state: 'stopped', restarts: 0 } };
    gateway.reply = () => { throw new Error('must not be called'); };
    const parsed = JSON.parse((await status(await project(), ['--json'])).stdout);
    expect(parsed.endpoints).toEqual({ available: false, error: '实例未运行' });
  });

  it('shows a server that has not connected yet as waiting to connect, not as a problem (#1250)', () => {
    const lines = renderRuntimeState({
      endpoints: { available: true, items: [] },
      mcp: { available: true, items: [
        { name: 'github', status: 'idle', toolCount: 0 },
        { name: 'docs', status: 'failed', toolCount: 0, lastError: 'HTTP 401' },
      ] },
      attention: { available: true, items: [], unavailable: [] },
    });
    expect(lines).toContain('  ✓ github：待连接');
    expect(lines).toContain('  ✗ docs：连接失败（HTTP 401）');
  });

  it('flags a connected server that no Agent binds (#1250 第 41 批 mcp-connected-but-unbound)', () => {
    const lines = renderRuntimeState({
      endpoints: { available: true, items: [] },
      mcp: { available: true, items: [
        { name: 'github', status: 'connected', toolCount: 49, boundAgents: [] },
        { name: 'docs', status: 'connected', toolCount: 3, boundAgents: ['zhin', 'researcher'] },
        // Older instances do not report bindings: shown as before.
        { name: 'legacy', status: 'connected', toolCount: 1 },
      ] },
      attention: { available: true, items: [], unavailable: [] },
    });
    expect(lines).toContain('  ! github：已连接，49 个工具（已连接但没有 Agent 能用，在 ai.agents.<name>.mcpServers 里绑定）');
    expect(lines).toContain('  ✓ docs：已连接，3 个工具，绑定：zhin、researcher');
    expect(lines).toContain('  ✓ legacy：已连接，1 个工具');
  });

  it('reads boundAgents from the instance MCP rows (#1250 第 41 批)', async () => {
    gateway.info = running;
    gateway.reply = (url, body) => (url.endsWith('/introspection/mcp?page=1&pageSize=200')
      ? { status: 200, body: { success: true, data: { items: [
        { name: 'github', connected: true, toolCount: 49, status: 'connected', boundAgents: [] },
      ], total: 1 } } }
      : healthy(url, body));
    const root = await project();
    const parsed = JSON.parse((await status(root, ['--json'])).stdout);
    expect(parsed.mcp.items).toEqual([{ name: 'github', status: 'connected', toolCount: 49, boundAgents: [] }]);
    expect((await status(root)).stdout).toContain('已连接但没有 Agent 能用，在 ai.agents.<name>.mcpServers 里绑定');
  });

  it('times out a read that never answers', async () => {
    const http: HostHttpConfig = { baseUrl: 'http://127.0.0.1:1/api', token: '', fetch: (() => new Promise(() => undefined)) as never };
    const state = await readRuntimeState('/nonexistent', { http, timeoutMs: 50 });
    expect(state.endpoints).toMatchObject({ available: false, error: expect.stringContaining('超时') });
    expect(state.mcp).toMatchObject({ available: false });
    expect(renderRuntimeState(state).join('\n')).toContain('需要你处理：无法读取');
    await expect(withDeadline(new Promise(() => undefined), 10, '测试')).rejects.toThrow('测试超时');
  });

  it('shows the gateway version skew and the exact restart command', async () => {
    const root = await project();
    const { mkdir } = await import('node:fs/promises');
    await mkdir(path.join(root, 'node_modules', '@zhin.js', 'gateway'), { recursive: true });
    await writeFile(path.join(root, 'node_modules', '@zhin.js', 'gateway', 'package.json'), JSON.stringify({ name: '@zhin.js/gateway', version: '1.5.0' }));
    gateway.info = running;
    gateway.reply = healthy;
    const { stdout } = await status(root);
    expect(stdout).toContain('网关版本不一致：运行中 v1.4.0，已安装 v1.5.0');
    expect(stdout).toContain('重启网关：zhin restart --gateway');
    const parsed = JSON.parse((await status(root, ['--json'])).stdout);
    expect(parsed.gateway).toMatchObject({ installedVersion: '1.5.0', versionSkew: { running: '1.4.0', installed: '1.5.0', restart: 'zhin restart --gateway' } });
  });
});

describe('zhin update: gateway restart notice (#1250 gateway-version-skew-after-update)', () => {
  it('prints the restart command when the gateway package changed under a running gateway', async () => {
    const { updateGatewayNotice } = await import('../src/commands/lifecycle.js');
    const daemon = { pid: 1, mode: 'daemon' as const, version: '1.3.0' };
    expect(updateGatewayNotice(daemon, '1.3.0', '1.4.0')).toEqual([
      '@zhin.js/gateway：1.3.0 → 1.4.0',
      expect.stringContaining('运行中 v1.3.0，已安装 v1.4.0'),
      '  重启网关：zhin restart --gateway',
    ]);
    expect(updateGatewayNotice(daemon, '1.3.0', '1.3.0')).toEqual([]);
    // Already behind before the update: still say so.
    expect(updateGatewayNotice(daemon, '1.4.0', '1.4.0')).toEqual(expect.arrayContaining(['  重启网关：zhin restart --gateway']));
    expect(updateGatewayNotice(undefined, '1.3.0', '1.4.0')).toEqual(['@zhin.js/gateway：1.3.0 → 1.4.0；下次 zhin start 会使用新版本']);
  });
});

describe('.zhin/runtime-failures.json reader (format of zhin.js RuntimeFailureJournal, #1270 batch 14)', () => {
  it('is empty without the file, validates entries like the writer and rejects other versions', async () => {
    const { readRuntimeFailureJournal } = await import('../src/utils/runtime-state.js');
    const root = await project();
    expect(readRuntimeFailureJournal(root)).toBeUndefined();
    const { mkdir } = await import('node:fs/promises');
    await mkdir(path.join(root, '.zhin'), { recursive: true });
    const file = path.join(root, '.zhin', 'runtime-failures.json');
    const good = { source: 'account', subject: 'acc-1', code: 'preparation-failed', category: 'preparation', message: 'project unavailable', firstAt: 1, lastAt: 5, count: 2 };
    await writeFile(file, JSON.stringify({ version: 1, entries: [
      good,
      { ...good, subject: 'newer', lastAt: 9, message: '' },
      { ...good, source: 'unknown' },
      { ...good, count: 0 },
      { ...good, category: undefined },
      'junk',
    ] }));
    expect(readRuntimeFailureJournal(root)).toEqual({ entries: [
      { ...good, subject: 'newer', lastAt: 9, message: 'preparation-failed' },
      good,
    ] });
    await writeFile(file, JSON.stringify({ version: 2, entries: [good] }));
    expect(readRuntimeFailureJournal(root)).toEqual({ error: expect.stringContaining('格式无法识别') });
    await writeFile(file, '{');
    expect(readRuntimeFailureJournal(root)).toEqual({ error: expect.stringContaining('不是有效的 JSON') });
  });
});
