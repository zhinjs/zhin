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
  installedPackageKind,
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

/** A Plugin package with an optional `schema.json`. */
async function installPlugin(name: string, version: string, schema?: unknown) {
  const directory = join(root, 'node_modules', ...name.split('/'));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version, zhin: { protocol: 1, type: 'plugin', entry: './plugin.js', platformFeatures: false } }));
  await writeFile(join(directory, 'plugin.js'), 'export default {};');
  if (schema) await writeFile(join(directory, 'schema.json'), JSON.stringify(schema));
}

function nameOf(spec: string) {
  const at = spec.indexOf('@', spec.startsWith('@') ? 1 : 0);
  return at < 0 ? spec : spec.slice(0, at);
}

/**
 * Fake package manager acting on package.json, the lockfile and node_modules:
 * `add` / `remove` edit all three, `install` syncs node_modules to package.json, `update` bumps.
 */
function fakePackageManager(options: { fail?: (args: readonly string[]) => boolean; calls?: string[][]; plugins?: Readonly<Record<string, unknown>> } = {}): GatewayPackageManager {
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
        if (options.plugins && Object.hasOwn(options.plugins, name)) await installPlugin(name, version, options.plugins[name]);
        else await installModule(name, version);
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
  // An earlier run's output: rollback tails must not include it.
  readonly lines: { seq: number; time: number; stream: 'stdout' | 'stderr'; line: string }[] = [{ seq: 1, time: 0, stream: 'stdout', line: 'previous run' }];
  readonly logs = { tail: (limit = 1000) => this.lines.slice(-limit) };
  print(line: string): void { this.lines.push({ seq: this.lines.length + 1, time: 0, stream: 'stderr', line }); }
  status(): InstanceStatus { return { state: this.state, lastExitCode: null, lastExitSignal: null, recentRestarts: 0 }; }
  async stop(): Promise<void> { this.calls.push('stop'); this.state = 'stopped'; }
  async start(): Promise<void> {
    const behaviour = this.behaviour(this.starts.length);
    this.starts.push(behaviour);
    this.calls.push('start');
    this.state = 'starting';
    if (behaviour === 'hang') { this.print('Error: cannot load plugin'); return new Promise(() => undefined); }
    if (behaviour !== 'ready') this.print('boom from instance');
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

  it('refreshes settings before each transaction and reads the ready timeout at start', async () => {
    const instance = new FakeInstance('running');
    let readyTimeoutMs = 200;
    const order: string[] = [];
    const packages = new GatewayPackageService({
      projectRoot: root,
      packageManager: fakePackageManager(),
      instance,
      hasOwner: () => true,
      readyTimeoutMs: () => { order.push(`read:${readyTimeoutMs}`); return readyTimeoutMs; },
      beforeTransaction: async () => { order.push('refresh'); readyTimeoutMs = 250; },
      stableMs: 30,
    });
    expect(await packages.install(['pg'], { principal: owner })).toMatchObject({ ok: true });
    expect(order).toEqual(['refresh', 'read:250']);
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

  it('starts the previously running instance even when the rollback reinstall fails (#1250)', async () => {
    // The install fails, then the rollback reinstall fails too (pnpm 11 exit 1): the bot must not stay stopped.
    const instance = new FakeInstance('running');
    const pm = fakePackageManager({ fail: args => args[0] === 'install' || args.includes('@zhin.js/agent') });
    const events: GatewayPackageEvent[] = [];
    const result = await service({ instance, pm }).install(['@zhin.js/agent'], { principal: owner, onEvent: event => events.push(event) });
    expect(result).toMatchObject({ ok: false, status: 'rollbackFailed', failedPhase: 'package-manager', rollbackError: 'fake pnpm install failed', instance: { before: 'running', after: 'running' } });
    expect(result.restartError).toBeUndefined();
    expect(instance.calls).toEqual(['stop', 'start']);
    expect(events.filter(event => event.type === 'phase').map(event => (event as { phase: string }).phase))
      .toEqual(['snapshot', 'stop-instance', 'package-manager', 'rollback', 'restore-files', 'reinstall', 'restart-instance', 'done']);
  });

  it('reports a failed restart apart from the rollback error', async () => {
    const instance = new FakeInstance('running', () => 'fail');
    const pm = fakePackageManager({ fail: args => args[0] === 'install' || args.includes('@zhin.js/agent') });
    const result = await service({ instance, pm }).install(['@zhin.js/agent'], { principal: owner });
    expect(result).toMatchObject({ status: 'rollbackFailed', rollbackError: 'fake pnpm install failed', restartError: 'Instance exited unexpectedly (code 1)', logTail: ['boom from instance'] });
  });

  describe('pnpm ERR_PNPM_IGNORED_BUILDS (#1250)', () => {
    const IGNORED = ' ERR_PNPM_IGNORED_BUILDS  Ignored build scripts: esbuild@0.25.4, @scope/native@1.0.0.\nRun "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.\n';
    /** pnpm 11: the install completes, then pnpm exits 1 because build scripts were skipped. */
    function ignoringBuilds(options: { linked?: boolean; calls?: string[][] } = {}): GatewayPackageManager {
      const base = fakePackageManager({ calls: options.calls });
      return async (args, projectRoot, output) => {
        await base(args, projectRoot, output);
        if (options.linked !== false) await writeFile(join(projectRoot, 'node_modules', '.modules.yaml'), 'layoutVersion: 5\n');
        output('stdout', IGNORED);
        throw new Error(`pnpm ${args[0]} exited with code 1`);
      };
    }

    it('keeps an install whose dependencies are in place and reports the skipped builds', async () => {
      const calls: string[][] = [];
      const instance = new FakeInstance('running');
      const result = await service({ instance, pm: ignoringBuilds({ calls }) }).install(['pg'], { principal: owner });
      expect(result).toMatchObject({ ok: true, status: 'succeeded', ignoredBuilds: ['esbuild', '@scope/native'], instance: { after: 'running' } });
      expect(calls.map(call => call[0])).toEqual(['add']);
      expect((await readJson(join(root, 'package.json'))).dependencies.pg).toBeDefined();
      expect(instance.calls).toEqual(['stop', 'start']);
    });

    it('still fails when the dependencies are not in place', async () => {
      const instance = new FakeInstance('running');
      const result = await service({ instance, pm: ignoringBuilds({ linked: false }) }).install(['pg'], { principal: owner });
      expect(result).toMatchObject({ ok: false, failedPhase: 'package-manager', error: 'pnpm add exited with code 1' });
      expect(instance.state).toBe('running');
    });

    it('does not treat another exit as ignored builds', async () => {
      const pm: GatewayPackageManager = async (_args, projectRoot, output) => {
        await mkdir(join(projectRoot, 'node_modules'), { recursive: true });
        await writeFile(join(projectRoot, 'node_modules', '.modules.yaml'), '');
        output('stderr', ' ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/nope: Not Found\n');
        throw new Error('pnpm add exited with code 1');
      };
      const result = await service({ pm }).install(['pg'], { principal: owner });
      expect(result).toMatchObject({ ok: false });
      expect(result.ignoredBuilds).toBeUndefined();
    });
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
      { name: 'pg', range: '^8.0.0', dependencyType: 'dependencies', installedVersion: '8.0.0', kind: 'library', catalog: 'database-driver' },
      { name: 'zod', range: '^3.0.0', dependencyType: 'dependencies', installedVersion: '3.0.0', kind: 'library', catalog: 'ai' },
    ]);
  });

  it('labels each installed dependency as plugin, feature or library from package.json#zhin.type (#1250)', async () => {
    const manifest = await readJson(join(root, 'package.json'));
    manifest.dependencies = { ...manifest.dependencies, '@zhin.js/adapter-sandbox': '^1.0.0', '@zhin.js/tool': '^1.0.0', ai: '^5.0.0', 'not-installed': '^1.0.0' };
    await writeFile(join(root, 'package.json'), JSON.stringify(manifest));
    await installPlugin('@zhin.js/adapter-sandbox', '1.0.0');
    await installModule('ai', '5.0.0');
    const tool = join(root, 'node_modules', '@zhin.js', 'tool');
    await mkdir(tool, { recursive: true });
    await writeFile(join(tool, 'package.json'), JSON.stringify({ name: '@zhin.js/tool', version: '1.0.0', zhin: { protocol: 1, type: 'feature' } }));
    const kinds = Object.fromEntries((await service().list(testUser('viewer'))).packages.map(item => [item.name, item.kind ?? null]));
    expect(kinds).toMatchObject({ '@zhin.js/adapter-sandbox': 'plugin', '@zhin.js/tool': 'feature', ai: 'library', 'not-installed': null });
    expect(installedPackageKind(undefined)).toBe('library');
    expect(installedPackageKind({ type: 'plugin' })).toBe('plugin');
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

describe('GatewayPackageService plugin configuration (ADR 0053 §2 step 4)', () => {
  const SANDBOX = '@zhin.js/adapter-sandbox';
  const schema = { type: 'object', required: ['endpoints'], properties: { endpoints: { type: 'array', items: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } } } };
  const readConfig = () => readJson(join(root, 'zhin.config.json'));

  function realService(instance: FakeInstance, calls: string[][] = []) {
    const pm = fakePackageManager({ calls, plugins: { [SANDBOX]: schema } });
    return new GatewayPackageService({
      projectRoot: root, instance, packageManager: pm, hasOwner: () => true, readyTimeoutMs: 200, stableMs: 30,
    });
  }

  it('installs an adapter whose schema needs an account without declaring it, and the transaction succeeds', async () => {
    const instance = new FakeInstance('running');
    const result = await realService(instance).install([SANDBOX], { principal: owner });
    expect(result).toMatchObject({ ok: true, status: 'succeeded', instance: { after: 'running' } });
    expect(result.needsConfiguration).toEqual([{ name: SANDBOX, instanceKey: 'sandbox', missing: ['endpoints'], missingEnv: [] }]);
    expect((await readJson(join(root, 'package.json'))).dependencies[SANDBOX]).toBeTruthy();
    expect(await readConfig()).toEqual({ configVersion: 2, plugins: {} });
    expect(instance.calls).toEqual(['stop', 'start']);
  });

  it('declares an installed plugin with a validated configuration, restarting the instance', async () => {
    const instance = new FakeInstance('running');
    const calls: string[][] = [];
    const subject = realService(instance, calls);
    await subject.install([SANDBOX], { principal: owner });
    const events: GatewayPackageEvent[] = [];
    const result = await subject.declare({ package: SANDBOX, config: { endpoints: [{ id: 'bot' }] } }, { principal: admin, onEvent: event => events.push(event) });
    expect(result).toMatchObject({ ok: true, status: 'succeeded', operation: 'declare', packages: [{ name: SANDBOX, spec: SANDBOX, source: 'adapter' }] });
    expect(result.needsConfiguration).toBeUndefined();
    expect(events.filter(event => event.type === 'phase').map(event => (event as { phase: string }).phase))
      .toEqual(['snapshot', 'stop-instance', 'configure', 'start-instance', 'done']);
    expect(await readConfig()).toEqual({ configVersion: 2, plugins: { sandbox: SANDBOX }, sandbox: { endpoints: [{ id: 'bot' }] } });
    expect(calls.map(call => call[0])).toEqual(['add']);
    expect(instance.calls).toEqual(['stop', 'start', 'stop', 'start']);
  });

  it('refuses an invalid configuration before touching the instance', async () => {
    const instance = new FakeInstance('running');
    const subject = realService(instance);
    await subject.install([SANDBOX], { principal: owner });
    instance.calls.length = 0;
    await expect(subject.declare({ package: SANDBOX, config: { endpoints: [{}] } }, { principal: owner }))
      .rejects.toMatchObject({ code: 'invalid_input', message: expect.stringContaining('$.endpoints.0.id'),
        details: { errors: [expect.objectContaining({ path: '$.endpoints.0.id', message: expect.any(String) })] } });
    const missing = await subject.declare({ package: SANDBOX, config: { endpoints: [{ id: '${ZHIN_DECLARE_TEST_UNSET}' }] } }, { principal: owner })
      .then(() => undefined, (error: unknown) => error);
    expect(missing).toMatchObject({ code: 'invalid_input', message: expect.stringContaining('缺少环境变量 ZHIN_DECLARE_TEST_UNSET'),
      details: { missingEnv: ['ZHIN_DECLARE_TEST_UNSET'] } });
    expect((missing as { details: object }).details).not.toHaveProperty('errors');
    await expect(subject.declare({ package: SANDBOX }, { principal: owner })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(subject.declare({ package: 'left-pad', config: {} }, { principal: admin })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(subject.declare({ package: `${SANDBOX}@1.0.0`, config: {} }, { principal: owner })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(subject.declare({ package: SANDBOX, config: { endpoints: [] } }, { principal: testUser('viewer') })).rejects.toMatchObject({ code: 'forbidden' });
    expect(instance.calls).toEqual([]);
    expect((await readConfig()).plugins).toEqual({});
  });

  it('keeps structured details when the configuration is refused inside the transaction', async () => {
    const instance = new FakeInstance('running');
    const subject = realService(instance);
    await subject.install([SANDBOX], { principal: owner });
    process.env.ZHIN_DECLARE_RACE = 'bot';
    try {
      // The variable exists for the preflight check and disappears before the in-transaction validation.
      const result = await subject.declare({ package: SANDBOX, config: { endpoints: [{ id: '${ZHIN_DECLARE_RACE}' }] } }, {
        principal: owner,
        onEvent: event => { if (event.type === 'phase' && event.phase === 'stop-instance') delete process.env.ZHIN_DECLARE_RACE; },
      });
      expect(result).toMatchObject({ ok: false, status: 'rolledBack', operation: 'declare', missingEnv: ['ZHIN_DECLARE_RACE'] });
      expect((await readConfig()).plugins).toEqual({});
    } finally {
      delete process.env.ZHIN_DECLARE_RACE;
    }
  });

  it('rolls the configuration back without reinstalling when the declared plugin does not start', async () => {
    const instance = new FakeInstance('running', attempt => (attempt === 1 ? 'fail' : 'ready'));
    const calls: string[][] = [];
    const subject = realService(instance, calls);
    await subject.install([SANDBOX], { principal: owner });
    const before = await readFile(join(root, 'zhin.config.json'), 'utf8');
    const events: GatewayPackageEvent[] = [];
    const result = await subject.declare({ package: SANDBOX, config: { endpoints: [{ id: 'bot' }] } }, { principal: owner, onEvent: event => events.push(event) });
    expect(result).toMatchObject({ ok: false, status: 'rolledBack', failedPhase: 'start-instance', operation: 'declare', instance: { after: 'running' } });
    // Only this transaction's output: not the earlier runs' lines.
    expect(result.logTail).toEqual(['boom from instance']);
    expect(events.filter(event => event.type === 'phase').map(event => (event as { phase: string }).phase))
      .toEqual(['snapshot', 'stop-instance', 'configure', 'start-instance', 'rollback', 'restore-files', 'restart-instance', 'done']);
    expect(await readFile(join(root, 'zhin.config.json'), 'utf8')).toBe(before);
    expect(calls.map(call => call[0])).toEqual(['add']);
  });
});

describe('GatewayPackageService enable / disable', () => {
  const SANDBOX = '@zhin.js/adapter-sandbox';
  const schema = { type: 'object', required: ['endpoints'], properties: { endpoints: { type: 'array', items: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } } } };
  const readConfig = () => readJson(join(root, 'zhin.config.json'));
  const phases = (events: GatewayPackageEvent[]) => events.filter(event => event.type === 'phase').map(event => (event as { phase: string }).phase);

  async function declaredService(instance: FakeInstance, calls: string[][] = []) {
    const subject = new GatewayPackageService({
      projectRoot: root, instance, packageManager: fakePackageManager({ calls, plugins: { [SANDBOX]: schema } }), hasOwner: () => true, readyTimeoutMs: 200, stableMs: 30,
    });
    await subject.install([SANDBOX], { principal: owner });
    await subject.declare({ package: SANDBOX, config: { endpoints: [{ id: 'bot' }] } }, { principal: owner });
    instance.calls.length = 0;
    calls.length = 0;
    return subject;
  }

  it('disables and enables a declared instance as configuration-only transactions that restart the instance', async () => {
    const instance = new FakeInstance('running');
    const calls: string[][] = [];
    const subject = await declaredService(instance, calls);
    const events: GatewayPackageEvent[] = [];
    const disabled = await subject.setEnabled({ plugin: 'sandbox' }, false, { principal: admin, onEvent: event => events.push(event) });
    expect(disabled).toMatchObject({ ok: true, status: 'succeeded', operation: 'disable', packages: [{ name: SANDBOX, source: 'adapter' }],
      plugin: { instanceKey: 'sandbox', packageName: SANDBOX, enabled: false, changed: true }, instance: { before: 'running', after: 'running' } });
    expect(phases(events)).toEqual(['snapshot', 'stop-instance', 'configure', 'start-instance', 'done']);
    expect((await readConfig()).disable_plugins).toEqual(['sandbox']);
    const enabled = await subject.setEnabled({ plugin: SANDBOX }, true, { principal: owner });
    expect(enabled).toMatchObject({ ok: true, operation: 'enable', plugin: { instanceKey: 'sandbox', enabled: true, changed: true } });
    expect((await readConfig()).disable_plugins).toEqual([]);
    // No package manager runs and no reinstall: only the configuration file changes.
    expect(calls).toEqual([]);
    expect(instance.calls).toEqual(['stop', 'start', 'stop', 'start']);
  });

  it('succeeds without touching the instance when the plugin already is in the requested state', async () => {
    const instance = new FakeInstance('running');
    const subject = await declaredService(instance);
    const before = await readFile(join(root, 'zhin.config.json'), 'utf8');
    const events: GatewayPackageEvent[] = [];
    const result = await subject.setEnabled({ plugin: 'sandbox' }, true, { principal: owner, onEvent: event => events.push(event) });
    expect(result).toMatchObject({ ok: true, status: 'succeeded', operation: 'enable', plugin: { instanceKey: 'sandbox', changed: false }, instance: { before: 'running', after: 'running' } });
    expect(events.map(event => event.type)).toEqual(['start', 'phase', 'result']);
    expect(instance.calls).toEqual([]);
    expect(await readFile(join(root, 'zhin.config.json'), 'utf8')).toBe(before);
  });

  it('refuses invalid requests and missing permissions before touching the instance', async () => {
    const instance = new FakeInstance('running');
    const subject = await declaredService(instance);
    await expect(subject.setEnabled({ plugin: 'missing' }, false, { principal: owner })).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringContaining('找不到插件实例 missing') });
    await expect(subject.setEnabled({ plugin: 'http' }, false, { principal: owner })).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringContaining('保留配置键') });
    await expect(subject.setEnabled({ plugin: 'bot' }, false, { principal: owner })).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringContaining('根插件') });
    await expect(subject.setEnabled({ plugin: 42 }, false, { principal: owner })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(subject.setEnabled({ plugin: 'sandbox' }, false, { principal: testUser('viewer') })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(subject.setEnabled({ plugin: 'sandbox' }, false, { principal: { kind: 'bootstrap', open: true } })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(subject.setEnabled({ plugin: 'sandbox' }, false, { principal: undefined })).rejects.toMatchObject({ code: 'forbidden' });
    expect(instance.calls).toEqual([]);
    expect((await readConfig()).disable_plugins).toBeUndefined();
  });

  it('refuses to enable an instance whose configuration fails its schema, with structured details', async () => {
    const instance = new FakeInstance('running');
    const subject = await declaredService(instance);
    await subject.setEnabled({ plugin: 'sandbox' }, false, { principal: owner });
    const config = await readConfig();
    await writeFile(join(root, 'zhin.config.json'), JSON.stringify({ ...config, sandbox: { endpoints: [{}] } }));
    instance.calls.length = 0;
    await expect(subject.setEnabled({ plugin: 'sandbox' }, true, { principal: owner })).rejects.toMatchObject({ code: 'invalid_input',
      details: { errors: [expect.objectContaining({ path: '$.endpoints.0.id' })] } });
    expect(instance.calls).toEqual([]);
  });

  it('rolls the configuration back when the instance does not start after enabling', async () => {
    // Starts: install, declare, disable, then the enable that fails.
    const instance = new FakeInstance('running', attempt => (attempt === 3 ? 'fail' : 'ready'));
    const subject = await declaredService(instance);
    await subject.setEnabled({ plugin: 'sandbox' }, false, { principal: owner });
    const before = await readFile(join(root, 'zhin.config.json'), 'utf8');
    const events: GatewayPackageEvent[] = [];
    const result = await subject.setEnabled({ plugin: 'sandbox' }, true, { principal: owner, onEvent: event => events.push(event) });
    expect(result).toMatchObject({ ok: false, status: 'rolledBack', failedPhase: 'start-instance', operation: 'enable', instance: { after: 'running' } });
    expect(result.plugin).toBeUndefined();
    expect(phases(events)).toEqual(['snapshot', 'stop-instance', 'configure', 'start-instance', 'rollback', 'restore-files', 'restart-instance', 'done']);
    expect(await readFile(join(root, 'zhin.config.json'), 'utf8')).toBe(before);
  });

  it('lets only owners toggle a project-local plugin', async () => {
    await mkdir(join(root, 'plugins', 'local'), { recursive: true });
    await writeFile(join(root, 'plugins', 'local', 'package.json'), JSON.stringify({ name: 'local-plugin', version: '1.0.0', zhin: { protocol: 1, type: 'plugin', entry: './plugin.js', platformFeatures: false } }));
    await writeFile(join(root, 'plugins', 'local', 'plugin.js'), 'export default {};');
    await writeFile(join(root, 'zhin.config.json'), JSON.stringify({ configVersion: 2, plugins: { local: './plugins/local' }, local: {} }));
    const instance = new FakeInstance('stopped');
    const subject = service({ instance });
    await expect(subject.setEnabled({ plugin: 'local' }, false, { principal: admin })).rejects.toMatchObject({ code: 'forbidden' });
    const result = await subject.setEnabled({ plugin: 'local' }, false, { principal: owner });
    expect(result).toMatchObject({ ok: true, operation: 'disable', packages: [{ name: './plugins/local', spec: './plugins/local', source: 'local' }], instance: { before: 'stopped', after: 'stopped' } });
    expect((await readConfig()).disable_plugins).toEqual(['local']);
    expect(instance.calls).toEqual([]);
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
      // The tail covers this transaction only, not the instance's earlier run.
      expect(result.logTail).not.toContain('instance ready');
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
