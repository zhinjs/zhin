import { EventEmitter } from 'node:events';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConsolePrincipal } from '@zhin.js/host-http';
import type { GatewayPackageEvent } from '@zhin.js/console-protocol';
import {
  GatewayError,
  GatewayPackageService,
  type GatewayPackageManager,
  type PackageTransactionInstance,
  type PackageWorkflowPort,
} from '../../src/packages/index.js';
import { PluginManagementWorkflow } from '../../src/plugin-management/workflow.js';
import { InstanceStartError, InstanceSupervisor, type InstanceFailure, type InstanceState, type InstanceStatus } from '../../src/supervisor/instance-supervisor.js';
import { testUser } from '../utils/console-users.js';

const LOCK = 'lockfileVersion: 9.0\n';
let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-gateway-packages-')));
  const manifest = { protocol: 1, type: 'plugin', entry: './plugin.js', platformFeatures: false };
  await writeFile(join(root, 'package.json'), `${JSON.stringify({ name: 'bot', version: '1.0.0', zhin: manifest, dependencies: { zod: '^3.0.0' } }, null, 2)}\n`);
  await writeFile(join(root, 'plugin.js'), 'export default {};');
  await writeFile(join(root, 'zhin.config.json'), JSON.stringify({ configVersion: 2, plugins: {} }));
  await writeFile(join(root, 'pnpm-lock.yaml'), LOCK);
  await installModule('zod', '3.0.0');
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const exists = (path: string) => access(path).then(() => true, () => false);
const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
const owner = testUser('owner');
const admin = testUser('admin');

async function installModule(name: string, version: string) {
  const directory = join(root, 'node_modules', ...name.split('/'));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version }));
}

function nameOf(spec: string) {
  const at = spec.indexOf('@', spec.startsWith('@') ? 1 : 0);
  return at < 0 ? spec : spec.slice(0, at);
}

/**
 * Fake package manager acting on package.json, the lockfile and node_modules:
 * `add` / `remove` edit all three, `install` syncs node_modules to package.json, `update` bumps.
 */
function fakePackageManager(options: { fail?: (args: readonly string[]) => boolean; calls?: string[][] } = {}): GatewayPackageManager {
  return async (args, projectRoot, output) => {
    options.calls?.push([...args]);
    output('stdout', `$ pnpm ${args.join(' ')}\n`);
    if (options.fail?.(args)) { output('stderr', 'ERR_PNPM_FAKE\n'); throw new Error(`fake pnpm ${args[0]} failed`); }
    const [command, ...rest] = args;
    const specs = rest.filter(arg => !arg.startsWith('-'));
    const manifestPath = join(projectRoot, 'package.json');
    const manifest = await readJson(manifestPath);
    manifest.dependencies ??= {};
    if (command === 'add') {
      for (const spec of specs) {
        const name = nameOf(spec);
        const version = spec.slice(name.length + 1).replace(/^[\^~]/u, '') || '1.0.0';
        manifest.dependencies[name] = `^${version}`;
        await installModule(name, version);
      }
    } else if (command === 'remove') {
      for (const name of specs) {
        delete manifest.dependencies[name];
        await rm(join(projectRoot, 'node_modules', ...name.split('/')), { recursive: true, force: true });
      }
    } else if (command === 'update') {
      for (const name of specs.length ? specs : Object.keys(manifest.dependencies)) await installModule(name, '9.9.9');
    } else if (command === 'install') {
      const modules = await readdir(join(projectRoot, 'node_modules')).catch(() => [] as string[]);
      for (const name of modules) if (!manifest.dependencies[name]) await rm(join(projectRoot, 'node_modules', name), { recursive: true, force: true });
      for (const [name, range] of Object.entries(manifest.dependencies as Record<string, string>)) {
        if (!await exists(join(projectRoot, 'node_modules', name))) await installModule(name, range.replace(/^[\^~]/u, ''));
      }
      return;
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(join(projectRoot, 'pnpm-lock.yaml'), `${LOCK}# ${args.join(' ')}\n`, { flag: 'a' });
  };
}

type StartBehaviour = 'ready' | 'fail' | 'hang' | 'crash-after-ready';

/** Scriptable stand-in for `InstanceSupervisor`. */
class FakeInstance extends EventEmitter implements PackageTransactionInstance {
  state: InstanceState;
  readonly starts: StartBehaviour[] = [];
  readonly calls: string[] = [];
  constructor(initial: InstanceState, readonly behaviour: (attempt: number) => StartBehaviour = () => 'ready') {
    super();
    this.state = initial;
  }
  readonly logs = { tail: () => [{ seq: 1, time: 0, stream: 'stderr' as const, line: 'Error: cannot load plugin' }] };
  status(): InstanceStatus { return { state: this.state, lastExitCode: null, lastExitSignal: null, recentRestarts: 0 }; }
  async stop(): Promise<void> { this.calls.push('stop'); this.state = 'stopped'; }
  async start(): Promise<void> {
    const behaviour = this.behaviour(this.starts.length);
    this.starts.push(behaviour);
    this.calls.push('start');
    this.state = 'starting';
    if (behaviour === 'hang') return new Promise(() => undefined);
    if (behaviour === 'fail') {
      this.state = 'backoff';
      throw new InstanceStartError(failure('Instance exited unexpectedly (code 1)'));
    }
    this.state = 'running';
    if (behaviour === 'crash-after-ready') {
      setTimeout(() => { this.state = 'crashed'; this.emit('failure', failure('restart storm')); }, 5);
    }
  }
}

function failure(message: string): InstanceFailure {
  return { reason: 'exit', message, at: 0, exitCode: 1, signal: null, logTail: ['boom from instance'] };
}

function service(options: { instance?: PackageTransactionInstance; pm?: GatewayPackageManager; workflow?: PackageWorkflowPort; hasOwner?: () => boolean } = {}) {
  const pm = options.pm ?? fakePackageManager();
  return new GatewayPackageService({
    projectRoot: root,
    packageManager: pm,
    ...(options.workflow ? { workflow: options.workflow } : {}),
    ...(options.instance ? { instance: options.instance } : {}),
    hasOwner: options.hasOwner ?? (() => true),
    readyTimeoutMs: 200,
    stableMs: 30,
  });
}

describe('GatewayPackageService transactions', () => {
  it('stops the instance, installs through the workflow, starts it again and streams progress', async () => {
    const calls: string[][] = [];
    const instance = new FakeInstance('running');
    const packages = service({ instance, pm: fakePackageManager({ calls }) });
    const events: GatewayPackageEvent[] = [];
    for await (const event of packages.stream('install', ['pg@^8.0.0'], { principal: owner })) events.push(event);
    const result = (events.at(-1) as Extract<GatewayPackageEvent, { type: 'result' }>).result;
    expect(result).toMatchObject({ ok: true, status: 'succeeded', operation: 'install', instance: { before: 'running', after: 'running' } });
    expect(result.packages).toEqual([{ name: 'pg', version: '^8.0.0', spec: 'pg@^8.0.0', source: 'database-driver' }]);
    expect(calls).toEqual([['add', 'pg@^8.0.0']]);
    expect(instance.calls).toEqual(['stop', 'start']);
    expect(events.filter(event => event.type === 'phase').map(event => (event as { phase: string }).phase))
      .toEqual(['snapshot', 'stop-instance', 'package-manager', 'start-instance', 'done']);
    expect(events).toContainEqual(expect.objectContaining({ type: 'output', stream: 'stdout', chunk: '$ pnpm add pg@^8.0.0\n' }));
    expect((await readJson(join(root, 'package.json'))).dependencies.pg).toBe('^8.0.0');
    expect(await exists(join(root, '.zhin/gateway-packages.lock'))).toBe(false);
  });

  it('leaves a stopped instance stopped unless asked to start it', async () => {
    const instance = new FakeInstance('stopped');
    const packages = service({ instance });
    expect(await packages.install(['pg'], { principal: owner })).toMatchObject({ ok: true, instance: { before: 'stopped', after: 'stopped' } });
    expect(instance.calls).toEqual([]);
    expect(await packages.install(['zod@^3.1.0'], { principal: owner, startInstance: true })).toMatchObject({ ok: true, instance: { after: 'running' } });
    expect(instance.calls).toEqual(['start']);
  });

  it('rolls back a package-manager failure: files restored, frozen reinstall, instance restarted', async () => {
    const calls: string[][] = [];
    const instance = new FakeInstance('running');
    const packageJson = await readFile(join(root, 'package.json'), 'utf8');
    const pm = fakePackageManager({ calls, fail: args => args.includes('@zhin.js/agent') });
    const packages = service({ instance, pm });
    const events: GatewayPackageEvent[] = [];
    const result = await packages.install(['pg', '@zhin.js/agent'], { principal: owner, onEvent: event => events.push(event) });
    expect(result).toMatchObject({ ok: false, status: 'rolledBack', failedPhase: 'package-manager', error: 'fake pnpm add failed', instance: { before: 'running', after: 'running' } });
    expect(result.rollbackError).toBeUndefined();
    expect(calls.map(call => call.join(' '))).toEqual(['add pg@^8.22.0', 'add @zhin.js/agent', 'install --frozen-lockfile']);
    expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(packageJson);
    expect(await readFile(join(root, 'pnpm-lock.yaml'), 'utf8')).toBe(LOCK);
    expect(await exists(join(root, 'node_modules/pg'))).toBe(false);
    expect(await exists(join(root, 'node_modules/zod'))).toBe(true);
    expect(instance.calls).toEqual(['stop', 'start']);
    expect(events.filter(event => event.type === 'phase').map(event => (event as { phase: string }).phase))
      .toEqual(['snapshot', 'stop-instance', 'package-manager', 'rollback', 'restore-files', 'reinstall', 'restart-instance', 'done']);
    expect(events).toContainEqual(expect.objectContaining({ type: 'output', stream: 'stderr', chunk: 'ERR_PNPM_FAKE\n' }));
  });

  it('rolls back when the instance never becomes ready after the install', async () => {
    const instance = new FakeInstance('running', attempt => (attempt === 0 ? 'hang' : 'ready'));
    const packages = service({ instance });
    const result = await packages.install(['pg'], { principal: owner });
    expect(result).toMatchObject({ ok: false, status: 'rolledBack', failedPhase: 'start-instance', instance: { after: 'running' } });
    expect(result.error).toContain('did not become ready within 200 ms');
    expect(result.logTail).toEqual(['Error: cannot load plugin']);
    expect((await readJson(join(root, 'package.json'))).dependencies.pg).toBeUndefined();
    expect(instance.calls).toEqual(['stop', 'start', 'stop', 'start']);
  });

  it('rolls back when the instance fails to start or crashes right after ready', async () => {
    for (const behaviour of ['fail', 'crash-after-ready'] as const) {
      const instance = new FakeInstance('running', attempt => (attempt === 0 ? behaviour : 'ready'));
      const result = await service({ instance }).install(['pg'], { principal: owner });
      expect(result, behaviour).toMatchObject({ ok: false, status: 'rolledBack', failedPhase: 'start-instance', logTail: ['boom from instance'] });
      expect((await readJson(join(root, 'package.json'))).dependencies.pg).toBeUndefined();
      expect(instance.state).toBe('running');
    }
  });

  it('reports rollbackFailed with the original error when the rollback cannot complete', async () => {
    const instance = new FakeInstance('running', () => 'fail');
    const pm = fakePackageManager({ fail: args => args[0] === 'install' });
    const result = await service({ instance, pm }).install(['pg'], { principal: owner });
    expect(result).toMatchObject({ ok: false, status: 'rollbackFailed', failedPhase: 'start-instance', error: 'Instance exited unexpectedly (code 1)', rollbackError: 'fake pnpm install failed' });
    // Files are restored even though the reinstall failed.
    expect((await readJson(join(root, 'package.json'))).dependencies.pg).toBeUndefined();
  });

  it('restores the root config and lockfile changed by the workflow', async () => {
    const config = await readFile(join(root, 'zhin.config.json'), 'utf8');
    const workflow: PackageWorkflowPort = {
      inspect: async () => ({ declared: false }),
      install: async () => {
        await writeFile(join(root, 'zhin.config.json'), JSON.stringify({ configVersion: 2, plugins: { x: 'x' }, x: {} }));
        await writeFile(join(root, 'bun.lock'), 'new lockfile');
        throw new Error('declaration failed');
      },
      uninstall: async () => undefined,
      update: async () => undefined,
    };
    const result = await service({ workflow }).install(['pg'], { principal: owner });
    expect(result).toMatchObject({ status: 'rolledBack', error: 'declaration failed', instance: { before: 'unmanaged', after: 'unmanaged' } });
    expect(await readFile(join(root, 'zhin.config.json'), 'utf8')).toBe(config);
    expect(await exists(join(root, 'bun.lock'))).toBe(false);
  });

  it('uninstalls and updates through the same transaction', async () => {
    const calls: string[][] = [];
    const instance = new FakeInstance('running');
    const packages = service({ instance, pm: fakePackageManager({ calls }) });
    expect(await packages.uninstall(['zod'], { principal: owner })).toMatchObject({ ok: true });
    expect(await exists(join(root, 'node_modules/zod'))).toBe(false);
    await packages.install(['zod'], { principal: owner });
    expect(await packages.update(['zod'], { principal: owner })).toMatchObject({ ok: true, operation: 'update' });
    expect(await packages.update('all', { principal: owner })).toMatchObject({ ok: true });
    expect(await packages.update(['zod@3.5.0'], { principal: owner })).toMatchObject({ ok: true });
    expect(calls.map(call => call.join(' '))).toEqual(['remove zod', 'add zod', 'update zod', 'update', 'add zod@3.5.0']);
    expect(instance.calls.filter(call => call === 'start')).toHaveLength(5);
  });

  it('passes removeDependency: false to the workflow on uninstall', async () => {
    const seen: unknown[] = [];
    const workflow: PackageWorkflowPort = {
      inspect: async () => ({ declared: true }),
      install: async () => undefined,
      uninstall: async (...args) => { seen.push(args); },
      update: async () => undefined,
    };
    await service({ workflow }).uninstall(['zod'], { principal: owner, removeDependency: false });
    await service({ workflow }).uninstall(['zod'], { principal: owner });
    expect(seen).toEqual([['zod', undefined, undefined, { removeDependency: false }], ['zod']]);
  });

  it('rejects a concurrent transaction, in process and across processes', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolvePromise => { release = resolvePromise; });
    const pm = fakePackageManager();
    const packages = service({ pm: async (args, projectRoot, output) => { await gate; await pm(args, projectRoot, output); } });
    const first = packages.install(['pg'], { principal: owner });
    await expect(packages.install(['zod'], { principal: owner })).rejects.toMatchObject({ code: 'conflict' });
    await vi.waitFor(() => expect(packages.activeTransaction).toBeDefined());
    // A second service on the same project (another process) sees the lock file.
    await vi.waitFor(async () => expect(await exists(join(root, '.zhin/gateway-packages.lock'))).toBe(true));
    await expect(service().install(['zod'], { principal: owner })).rejects.toBeInstanceOf(GatewayError);
    release();
    expect((await first).ok).toBe(true);
    expect(packages.activeTransaction).toBeUndefined();
    expect((await packages.install(['zod'], { principal: owner })).ok).toBe(true);
  });

  it('lists dependencies with installed versions and catalogs', async () => {
    await service().install(['pg@^8.0.0'], { principal: owner });
    const list = await service().list(testUser('viewer'));
    expect(list.packageManager).toBe('pnpm');
    expect(list.packages).toEqual([
      { name: 'pg', range: '^8.0.0', dependencyType: 'dependencies', installedVersion: '8.0.0', catalog: 'database-driver' },
      { name: 'zod', range: '^3.0.0', dependencyType: 'dependencies', installedVersion: '3.0.0', catalog: 'ai' },
    ]);
  });

  it('plans without changing anything', async () => {
    const calls: string[][] = [];
    const plan = await service({ instance: new FakeInstance('running'), pm: fakePackageManager({ calls }) }).plan('install', ['pg'], admin);
    expect(plan).toMatchObject({ operation: 'install', all: false, packageManager: 'pnpm', instanceState: 'running', restartsInstance: true });
    expect(calls).toEqual([]);
  });
});

describe('GatewayPackageService authorization matrix', () => {
  const bootstrap: ConsolePrincipal = { kind: 'bootstrap', open: false };
  const cases: readonly [string, ConsolePrincipal | 'local' | undefined, 'install' | 'uninstall' | 'update', readonly string[] | 'all', 'allow' | string][] = [
    ['anonymous', undefined, 'install', ['pg'], 'forbidden'],
    ['viewer', testUser('viewer'), 'install', ['pg'], 'forbidden'],
    ['operator', testUser('operator'), 'install', ['pg'], 'forbidden'],
    ['admin: allowlisted', admin, 'install', ['pg'], 'allow'],
    ['admin: any npm package', admin, 'install', ['left-pad'], 'forbidden'],
    ['admin: uninstall outside the allowlist', admin, 'uninstall', ['left-pad'], 'forbidden'],
    ['admin: update all', admin, 'update', 'all', 'forbidden'],
    ['owner: any npm package', owner, 'install', ['left-pad@^1.3.0'], 'allow'],
    ['owner: update all', owner, 'update', 'all', 'allow'],
    ['owner: unsafe spec', owner, 'install', ['left-pad@file:../x'], 'invalid_input'],
    ['owner: git url', owner, 'install', ['git+https://example.com/x.git'], 'invalid_input'],
    ['owner: shell syntax', owner, 'install', ['pg;rm -rf /'], 'invalid_input'],
    ['owner: uninstall with version', owner, 'uninstall', ['pg@1.0.0'], 'invalid_input'],
    ['owner: update to a range', owner, 'update', ['pg@^9'], 'invalid_input'],
    ['owner: duplicate', owner, 'install', ['pg', 'pg@^8'], 'invalid_input'],
    ['owner: adapter scoped elsewhere', testUser('owner', { kind: 'adapter', key: 'qq' }), 'install', ['pg'], 'forbidden'],
    ['local socket: any npm package', 'local', 'install', ['left-pad'], 'allow'],
    ['bootstrap: database driver', bootstrap, 'install', ['pg'], 'forbidden'],
    ['bootstrap: uninstall', bootstrap, 'uninstall', ['pg'], 'forbidden'],
  ];

  it.each(cases)('%s', async (_label, principal, operation, packages, expected) => {
    const calls: string[][] = [];
    const subject = service({ pm: fakePackageManager({ calls }) });
    const run = operation === 'update' ? subject.update(packages, { principal })
      : subject[operation](packages as readonly string[], { principal });
    if (expected === 'allow') {
      expect((await run).ok).toBe(true);
    } else {
      await expect(run).rejects.toMatchObject({ code: expected });
      expect(calls).toEqual([]);
    }
  });

  it('lets the bootstrap token install database drivers only before the first owner', async () => {
    let ownerExists = false;
    const subject = service({ hasOwner: () => ownerExists });
    await expect(subject.install(['@zhin.js/agent'], { principal: bootstrap })).rejects.toMatchObject({ code: 'forbidden' });
    expect((await subject.install(['mysql2'], { principal: bootstrap })).ok).toBe(true);
    ownerExists = true;
    await expect(subject.install(['pg'], { principal: bootstrap })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('applies the extra authorize hook after the built-in rules', async () => {
    const seen: string[] = [];
    const subject = new GatewayPackageService({
      projectRoot: root, packageManager: fakePackageManager(), hasOwner: () => true,
      authorize: (_principal, action, packages) => {
        seen.push(`${action}:${packages.map(item => item.name).join(',')}`);
        if (packages.some(item => item.name === 'left-pad')) throw new GatewayError('forbidden', 'policy');
      },
    });
    await expect(subject.install(['left-pad'], { principal: owner })).rejects.toMatchObject({ code: 'forbidden', message: 'policy' });
    expect((await subject.install(['pg'], { principal: owner })).ok).toBe(true);
    expect(seen).toEqual(['install:left-pad', 'install:pg']);
  });
});

describe('GatewayPackageService with the real workflow and supervisor', () => {
  const fixture = fileURLToPath(new URL('./fixtures/project-instance.mjs', import.meta.url));

  it('rolls back an install that leaves the instance unable to start', async () => {
    const supervisor = new InstanceSupervisor({
      spawn: { command: process.execPath, args: [fixture], cwd: root },
      readyTimeoutMs: 3_000, shutdownBudgetMs: 300, killGraceMs: 300, logs: { file: false },
      restart: { delayMs: 50 },
    });
    try {
      await supervisor.start();
      const calls: string[][] = [];
      const pm = fakePackageManager({ calls });
      const packages = new GatewayPackageService({
        projectRoot: root,
        instance: supervisor,
        packageManager: pm,
        workflow: new PluginManagementWorkflow(root, { installDependencies: (args, projectRoot) => pm(args, projectRoot, () => undefined) }),
        readyTimeoutMs: 3_000,
        stableMs: 100,
      });
      const result = await packages.install(['broken-pkg'], { principal: 'local' });
      expect(result).toMatchObject({ ok: false, status: 'rolledBack', failedPhase: 'start-instance', instance: { before: 'running', after: 'running' } });
      expect(result.logTail).toContain('broken-pkg cannot be loaded');
      expect(calls.map(call => call.join(' '))).toEqual(['add broken-pkg', 'install --frozen-lockfile']);
      expect(await exists(join(root, 'node_modules/broken-pkg'))).toBe(false);
      expect((await readJson(join(root, 'package.json'))).dependencies).toEqual({ zod: '^3.0.0' });
      expect(supervisor.state).toBe('running');
    } finally {
      await supervisor.stop({ force: true }).catch(() => undefined);
      supervisor.dispose();
    }
  }, 15_000);
});
