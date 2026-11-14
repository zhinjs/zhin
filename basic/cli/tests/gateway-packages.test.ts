import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GatewayPackageEvent, GatewayPackageTransactionResult } from '@zhin.js/console-protocol';
import { gatewaySocketPath, LocalControlServer } from '@zhin.js/gateway/local';
import { GatewayPackageService, type PackageWorkflowPort } from '@zhin.js/gateway/packages';
import { splitStartArguments } from '../src/commands/lifecycle.js';
import {
  describeGatewayError,
  packageEventPrinter,
  probeGateway,
  renderTransactionResult,
  runPackageOperationDirect,
  runPackageOperationViaGateway,
  type Output,
} from '../src/utils/gateway.js';

const dirs: string[] = [];
const servers: LocalControlServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function project(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'zcp-'));
  dirs.push(root);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'bot', dependencies: {} }));
  return root;
}

function capture(): Output & { text: () => string } {
  let text = '';
  return { out: (value) => { text += value; }, err: (value) => { text += value; }, text: () => text };
}

function result(ok: boolean): GatewayPackageTransactionResult {
  return {
    id: 't1', operation: 'install', packages: [{ name: 'zod', spec: 'zod', source: 'npm' }], ok,
    status: ok ? 'succeeded' : 'rolledBack', ...(ok ? {} : { failedPhase: 'start-instance', error: 'boom', logTail: ['last line'] }),
    instance: { before: 'running', after: 'running' }, startedAt: 1, finishedAt: 2,
  };
}

describe.runIf(process.platform !== 'win32')('dependency transactions from the CLI', () => {
  it('goes through the gateway socket with streamed progress', async () => {
    const root = await project();
    const requests: unknown[] = [];
    const server = await LocalControlServer.open({
      path: gatewaySocketPath(root),
      handler: async (request, emit) => {
        requests.push(request);
        const events: GatewayPackageEvent[] = [
          { type: 'start', id: 't1', operation: 'install', packages: [{ name: 'zod', spec: 'zod', source: 'npm' }] },
          { type: 'phase', id: 't1', phase: 'stop-instance' },
          { type: 'output', id: 't1', stream: 'stdout', chunk: 'Packages: +1\n' },
          { type: 'phase', id: 't1', phase: 'start-instance' },
        ];
        for (const event of events) emit(event);
        return { ok: true, data: result(true) };
      },
    });
    servers.push(server);
    const output = capture();
    const done = await runPackageOperationViaGateway({ root }, { operation: 'install', packages: ['zod'], enable: false }, output);
    expect(done.ok).toBe(true);
    expect(requests).toEqual([{ id: 1, type: 'gateway.packages.install', data: { packages: ['zod'], enable: false } }]);
    expect(output.text()).toBe([
      '→ install zod',
      '  · 停止实例',
      '    │ Packages: +1',
      '  · 启动实例',
      '✓ install 完成：zod（实例 running → running）',
      '',
    ].join('\n'));
  });

  it('hints how to configure a plugin installed without its required configuration', () => {
    const lines = renderTransactionResult({
      ...result(true),
      packages: [{ name: '@zhin.js/adapter-sandbox', spec: '@zhin.js/adapter-sandbox', source: 'adapter' }],
      needsConfiguration: [{ name: '@zhin.js/adapter-sandbox', instanceKey: 'sandbox', missing: ['endpoints'], missingEnv: ['SANDBOX_TOKEN'] }],
    });
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('@zhin.js/adapter-sandbox 已安装但未启用');
    expect(lines[1]).toContain('endpoints、环境变量 SANDBOX_TOKEN');
    expect(lines[1]).toContain('plugins.sandbox');
    expect(lines[1]).toContain('gateway.plugins.declare');
  });

  it('reports a rolled-back transaction with the instance log tail', async () => {
    const root = await project();
    servers.push(await LocalControlServer.open({ path: gatewaySocketPath(root), handler: async () => ({ ok: true, data: result(false) }) }));
    const output = capture();
    const done = await runPackageOperationViaGateway({ root }, { operation: 'uninstall', packages: ['zod'], removeDependency: false }, output);
    expect(done.ok).toBe(false);
    expect(output.text()).toContain('失败（阶段 start-instance），已回滚：boom');
    expect(output.text()).toContain('  last line');
  });

  it('keeps package-manager lines apart from the steps, also across chunks (#1250)', () => {
    const output = capture();
    const print = packageEventPrinter(output);
    print({ type: 'phase', id: 't1', phase: 'package-manager' });
    print({ type: 'output', id: 't1', stream: 'stdout', chunk: 'Progress: resolved 1\n ERR_PNPM_IGNORED' });
    print({ type: 'output', id: 't1', stream: 'stdout', chunk: '_BUILDS  Ignored build scripts: esbuild.' });
    print({ type: 'phase', id: 't1', phase: 'start-instance' });
    expect(output.text()).toBe([
      '  · 执行包管理器',
      '    │ Progress: resolved 1',
      '    │  ERR_PNPM_IGNORED_BUILDS  Ignored build scripts: esbuild.',
      '  · 启动实例',
      '',
    ].join('\n'));
  });

  it('reports ignored builds as a hint on a successful install (#1250)', () => {
    const lines = renderTransactionResult({ ...result(true), ignoredBuilds: ['esbuild'] });
    expect(lines[0]).toContain('✓ install 完成');
    expect(lines[1]).toContain('ERR_PNPM_IGNORED_BUILDS');
    expect(lines[1]).toContain('allowBuilds');
  });

  it('reports the rollback and the restart separately (#1250)', () => {
    const failed = { ...result(false), status: 'rollbackFailed' as const, failedPhase: 'package-manager' as const, rollbackError: 'pnpm install exited with code 1' };
    const restarted = renderTransactionResult(failed).join('\n');
    expect(restarted).toContain('回滚错误（恢复文件 / 重新安装依赖）：pnpm install exited with code 1');
    expect(restarted).toContain('实例已重新启动（running）');
    const down = renderTransactionResult({ ...failed, restartError: 'port in use', instance: { before: 'running', after: 'crashed' } }).join('\n');
    expect(down).toContain('重新启动实例失败：port in use');
    expect(down).not.toContain('实例已重新启动');
  });

  it('falls back to the direct transaction when no gateway runs', async () => {
    const root = await project();
    await expect(probeGateway({ root })).resolves.toBeUndefined();
    const calls: string[] = [];
    const workflow: PackageWorkflowPort = {
      inspect: async () => ({ declared: false }),
      install: async (spec) => { calls.push(`install ${spec}`); },
      uninstall: async (name) => { calls.push(`uninstall ${name}`); },
      update: async () => undefined,
    };
    const service = new GatewayPackageService({ projectRoot: root, workflow, packageManager: async (args) => { calls.push(args.join(' ')); } });
    const output = capture();
    const done = await runPackageOperationDirect({ root }, { operation: 'install', packages: ['zod'] }, output, service);
    expect(done).toMatchObject({ ok: true, instance: { before: 'unmanaged', after: 'unmanaged' } });
    expect(calls).toEqual(['install zod']);
    expect(output.text()).toContain('  · 执行包管理器');
    await runPackageOperationDirect({ root }, { operation: 'update', packages: 'all' }, output, service);
    expect(calls).toEqual(['install zod', 'update']);
  });

  it('explains a socket owned by another user', async () => {
    const root = await project();
    servers.push(await LocalControlServer.open({ path: gatewaySocketPath(root) }));
    const error = await probeGateway({ root, uid: () => (process.getuid?.() ?? 0) + 1 }).catch((caught: unknown) => caught);
    expect(describeGatewayError(error)).toContain('属于其他用户');
  });
});

describe('zhin start arguments', () => {
  it('separates gateway flags from the instance start options', () => {
    expect(splitStartArguments(['--foreground', '--mode', 'production'])).toEqual({ foreground: true, rest: ['--mode', 'production'] });
    expect(splitStartArguments(['-d', '--no-watch'])).toEqual({ foreground: false, rest: ['--no-watch'] });
    // A CI check and the standalone instance always run attached.
    expect(splitStartArguments(['--once'])).toEqual({ foreground: true, rest: ['--once'] });
    expect(splitStartArguments(['--standalone'])).toEqual({ foreground: true, rest: ['--standalone'] });
  });
});
