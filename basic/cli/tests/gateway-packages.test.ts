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
  probeGateway,
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
      'Packages: +1',
      '  · 启动实例',
      '✓ install 完成：zod（实例 running → running）',
      '',
    ].join('\n'));
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
