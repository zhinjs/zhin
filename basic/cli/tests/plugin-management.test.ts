import { mkdir, mkdtemp, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RootRuntime, ProjectGraphService, type ModuleRuntime } from '@zhin.js/runtime';
import { createConfigDocument } from '@zhin.js/config-file';
import { loadRuntimeEnvironmentLayers } from '../src/plugin-runtime/start/environment.js';
import { definePlugin, pluginVerificationToken } from '@zhin.js/plugin-runtime';
import { PluginManagementWorkflow, PluginManagementOperationError } from '../src/plugin-management/workflow.js';
import { PluginManagementActivity } from '../src/plugin-management/activity.js';
import { createPluginManagementPort } from '../src/plugin-runtime/console/plugin-management.js';
import adapterFeature, { Adapter, endpointSpec, createEndpointSpecification, type Endpoint, type EndpointSpecification, defineAdapter, adapterFeatureId, isAdapterIndex, endpointEventGatewayToken, type EndpointTransportState } from '@zhin.js/adapter';

const roots: string[] = [];
function application(configs: Record<string, unknown>, packages: Record<string, string> = Object.fromEntries(Object.keys(configs).map(key => [key, key]))) { return {configVersion: 2, plugins: packages, ...configs}; }
const manifest = { protocol: 1, type: 'plugin', entry: './plugin.js', platformFeatures: false, features: [], plugins: [] };
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function evidenceFixture() {
  const root = await fixture(); await mounted(root);
  const file = join(root, 'zhin.config.json');
  await writeFile(file, JSON.stringify(application({ reminder: { label: 'private-config-marker' } })));
  const definition = { default: definePlugin({ name: 'reminder', config: { toJsonSchema: () => ({ type: 'object', properties: { label: { type: 'string', default: 'daily' } } }) } }) };
  const modules = new Map([[join(root, 'plugin.js'), { default: definePlugin({ name: 'root' }) }], [join(root, 'node_modules/reminder/plugin.js'), definition]]);
  const loader: ModuleRuntime = { async load<T>(source: string) { return modules.get(source) as T; }, async close() {} };
  const runtime = new RootRuntime({ projectRoot: root, modules: loader, config: createConfigDocument(file), environment: { name: 'test', mode: 'test', platform: 'node' } });
  await runtime.start();
  return { root, file, runtime, document: createConfigDocument(file), workflow: new PluginManagementWorkflow(root, { snapshots: runtime.snapshots }) };
}

function pauseDependencyInspection() {
  let reached!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { reached = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  const original = ProjectGraphService.prototype.inspect;
  const spy = vi.spyOn(ProjectGraphService.prototype, 'inspect').mockImplementationOnce(async function (this: ProjectGraphService, ...args) {
    reached(); await wait; return original.apply(this, args);
  });
  return { entered, release, spy };
}

describe('configuration application evidence is one coherent observation', () => {
  it('rejects a file changed during inspection rather than attaching its new revision to an old published result', async () => {
    const f = await evidenceFixture(), pause = pauseDependencyInspection();
    try {
      const pending = f.workflow.inspect('reminder'); await pause.entered;
      await writeFile(f.file, JSON.stringify(application({ reminder: { label: 'changed' } }))); pause.release();
      await expect(pending).rejects.toThrow('配置或项目版本在读取期间变化');
      expect(await f.workflow.inspect('reminder')).toMatchObject({ revision: (await f.document.read()).revision, published: false, status: 'pending-restart' });
    } finally { pause.release(); pause.spy.mockRestore(); await f.runtime.stop(); }
  });

  it('rejects a generation changed during inspection and releases the old real Runtime lease', async () => {
    const f = await evidenceFixture(), pause = pauseDependencyInspection();
    const hmr = f.runtime.createHmrCoordinator({ onError: error => { throw error; }, onRestartRequired() { throw new Error('unexpected restart'); } });
    try {
      const initialGeneration = f.runtime.snapshot.generation;
      const pending = f.workflow.inspect('reminder'); await pause.entered;
      const reloaded = hmr.enqueue(join(f.root, 'node_modules/reminder/plugin.js'));
      await vi.waitFor(() => expect(f.runtime.snapshot.generation).toBeGreaterThan(initialGeneration)); pause.release();
      await expect(pending).rejects.toThrow('运行代在读取期间变化'); await reloaded;
      expect(await f.workflow.inspect('reminder')).toMatchObject({ generation: f.runtime.snapshot.generation, published: true });
    } finally { pause.release(); pause.spy.mockRestore(); await hmr.stop(); await f.runtime.stop(); }
  });

  it('reports semantic agreement for formatting-only saves without claiming an exact file revision was applied or exposing values', async () => {
    const f = await evidenceFixture();
    try {
      const before = await f.workflow.inspect('reminder');
      const config = JSON.parse(await readFile(f.file, 'utf8')); await writeFile(f.file, `${JSON.stringify(config, null, 2)}\n`);
      const state = await f.workflow.inspect('reminder');
      expect(state).toMatchObject({ published: true, generation: before.generation }); expect(state.revision).not.toBe(before.revision);
      expect(state.revision).toBe((await f.document.read()).revision); expect(JSON.stringify(state)).not.toContain('private-config-marker');
    } finally { await f.runtime.stop(); }
  });
});

it('keeps dependency and declaration writes inside one process-owned restart guard', async () => {
  const root = await fixture();
  const activity = new PluginManagementActivity();
  const workflow = new PluginManagementWorkflow(root, { activity, installDependencies: async (args, directory) => {
    expect(activity.active).toBe(true);
    await runPackageManager(args, directory);
    expect(activity.active).toBe(true);
  } });
  const operation = workflow.install('reminder');
  expect(activity.active).toBe(true);
  expect((await operation).state).toMatchObject({ installed: true, declared: true, restartRequired: true });
  expect(activity.active).toBe(false);
  await expect(new PluginManagementWorkflow(root, { activity, installDependencies: async () => { throw new Error('registry unavailable'); } }).install('another')).rejects.toThrow('registry unavailable');
  expect(activity.active).toBe(false);
});

it('finishes an exact installed version without reinstalling after a lost receipt', async () => {
  const root = await fixture();
  await runPackageManager(['add', 'reminder@1.0.0'], root);
  const installDependencies = vi.fn(runPackageManager);
  const workflow = new PluginManagementWorkflow(root, { installDependencies });
  expect((await workflow.install('reminder@1.0.0')).state).toMatchObject({ installed: true, version: '1.0.0', declared: true });
  expect(installDependencies).not.toHaveBeenCalled();
  await workflow.install('reminder@1.0.1');
  expect(installDependencies).toHaveBeenCalledTimes(1);
});

it('still runs the package manager when the declared range is not the requested exact pin', async () => {
  const root = await fixture();
  await runPackageManager(['add', 'reminder@1.0.0'], root);
  const project = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  project.dependencies.reminder = '^1.0.0';
  await writeFile(join(root, 'package.json'), JSON.stringify(project));
  const installDependencies = vi.fn(runPackageManager);
  await new PluginManagementWorkflow(root, { installDependencies }).install('reminder@1.0.0');
  expect(installDependencies).toHaveBeenCalledTimes(1);
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-plugin-workflow-')));
  roots.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'test-project', version: '1.0.0', zhin: manifest, dependencies: {} }));
  await writeFile(join(root, 'plugin.js'), 'export default {};');
  await writeFile(join(root, 'zhin.config.json'), JSON.stringify(application({})));
  return root;
}
async function packageInstalled(root: string, name = 'reminder', version = '1.0.0', schema?: unknown) {
  const directory = join(root, 'node_modules', name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version, zhin: manifest }));
  await writeFile(join(directory, 'plugin.js'), 'export default {};');
  if (schema) await writeFile(join(directory, 'schema.json'), JSON.stringify(schema));
}
async function runPackageManager(args: readonly string[], root: string) {
  const request = args.at(-1)!;
  const [name, version = '1.0.0'] = request.split('@');
  const project = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (args[0] === 'remove') {
    delete project.dependencies[name!];
    await rm(join(root, 'node_modules', name!), { recursive: true, force: true });
  } else {
    project.dependencies[name!] = version;
    await packageInstalled(root, name, version);
  }
  await writeFile(join(root, 'package.json'), JSON.stringify(project));
}
async function mounted(root: string, names = ['reminder']) {
  for (const name of names) await new PluginManagementWorkflow(root, { installDependencies: runPackageManager }).install(name);
}

describe('Shared CLI and Console plugin workflow', () => {
  it('uses actual owner-scoped adapter transport and admission evidence instead of publication or phase alone', async () => {
    const root = await fixture();
    await mounted(root, ['reminder', 'preferences']);
    const project = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    project.dependencies['@test/adapter'] = 'workspace:*';
    project.zhin.features = [{ package: '@test/adapter' }];
    await writeFile(join(root, 'package.json'), JSON.stringify(project));
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    await mkdir(join(root, 'packages/adapter'), { recursive: true });
    await writeFile(join(root, 'packages/adapter/package.json'), JSON.stringify({ name: '@test/adapter', version: '1.0.0', zhin: { protocol: 1, type: 'feature', entry: './index.js' } }));
    await writeFile(join(root, 'packages/adapter/index.js'), '');
    for (const name of ['reminder', 'preferences']) await writeFile(join(root, `node_modules/${name}/package.json`), JSON.stringify({
      name, version: '1.0.0', peerDependencies: { '@test/adapter': '*' }, zhin: { ...manifest, features: [{ package: '@test/adapter' }] },
    }));
    const config = application({ reminder: { endpoints: [{ id: 'one' }, { id: 'two' }] }, preferences: { endpoints: [{ id: 'one' }] } });
    await writeFile(join(root, 'zhin.config.json'), JSON.stringify(config));
    const states = new Map<string, EndpointTransportState | undefined>([['root/reminder:one', 'open'], ['root/reminder:two', 'open'], ['root/preferences:one', 'closed']]);
    class LiveClient { constructor(readonly key: string) {} }
    class LiveEndpoint extends LiveClient implements Endpoint {
      readonly [endpointSpec]: EndpointSpecification;
      constructor(key: string) {
        super(key);
        const transportState = () => states.get(this.key);
        this[endpointSpec] = createEndpointSpecification(this, { start() {}, open() {}, close() {}, stop() {}, get transportState() { return transportState(); } });
      }
    }
    const plugin = () => ({ default: definePlugin({ name: 'platform', config: { toJsonSchema: () => ({ type: 'object', properties: {
      endpoints: { type: 'array', items: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
    } }) }, setup({ addAdapter }) {
      addAdapter('platform', defineAdapter({ capabilities: ['inbound'], createAdapter: context => new class extends Adapter<LiveEndpoint> { protected createEndpoint(config: Readonly<Record<string, unknown>>) { return new LiveEndpoint(`${context.owner.id}:${String(config.id ?? context.endpointId)}`); } }() }));
    } }) });
    const files = new Map<string, unknown>([
      [join(root, 'plugin.js'), { default: definePlugin({ name: 'root' }) }],
      [join(root, 'packages/adapter/index.js'), { default: adapterFeature }],
      [join(root, 'node_modules/reminder/plugin.js'), plugin()],
      [join(root, 'node_modules/preferences/plugin.js'), plugin()],
    ]);
    const modules: ModuleRuntime = { async load<T>(file: string) { return files.get(file) as T; }, async close() {} };
    const runtime = new RootRuntime({ projectRoot: root, modules, environment: { name: 'test', mode: 'test', platform: 'node' }, config,
      installResources({ resources }) { resources.provide(endpointEventGatewayToken, { receive: async () => undefined }); },
    });
    try {
      await runtime.start();
      const workflow = new PluginManagementWorkflow(root, { snapshots: runtime.snapshots });
      expect(await workflow.inspect('reminder')).toMatchObject({ published: true, readiness: 'ready' });
      expect(await workflow.inspect('preferences')).toMatchObject({ published: true, readiness: 'degraded' });
      for (const transportState of ['connecting', 'reconnecting', 'idle'] as const) {
        states.set('root/reminder:two', transportState);
        expect(await workflow.inspect('reminder')).toMatchObject({ published: true, readiness: 'pending' });
      }
      states.set('root/reminder:two', undefined);
      expect(await workflow.inspect('reminder')).toMatchObject({ published: true, readiness: 'unknown' });
      states.set('root/reminder:two', 'closed');
      expect(await workflow.inspect('reminder')).toMatchObject({ published: true, readiness: 'degraded' });
      states.set('root/reminder:two', 'stopped');
      expect(await workflow.inspect('reminder')).toMatchObject({ readiness: 'degraded' });
      states.set('root/reminder:two', 'open');
      const index = runtime.snapshot.projections.get(adapterFeatureId);
      if (!isAdapterIndex(index)) throw new Error('missing real AdapterIndex');
      await index.close();
      expect(index.describe().filter(endpoint => endpoint.owner === 'root/reminder').every(endpoint => endpoint.transportState === 'open' && !endpoint.admitted)).toBe(true);
      expect(await workflow.inspect('reminder')).toMatchObject({ readiness: 'pending' });
    } finally { await runtime.stop(); }
  });

  it('plans dependency-only installs without manifest or configuration writes', async () => {
    const root = await fixture();
    const before = await readFile(join(root, 'package.json'), 'utf8');
    expect(await new PluginManagementWorkflow(root).planInstall('reminder', { enable: false })).toMatchObject({ restartRequired: false, changes: { packageManifest: 'unchanged', config: 'unchanged' } });
    expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(before);
  });

  it('rejects save-dev and enable before invoking the package manager or changing any project file', async () => {
    const root = await fixture();
    const runner = vi.fn(runPackageManager);
    const before = await readFile(join(root, 'package.json'), 'utf8');
    await expect(new PluginManagementWorkflow(root, { installDependencies: runner }).install('reminder', undefined, undefined, { saveDev: true })).rejects.toThrow('--no-enable');
    expect(runner).not.toHaveBeenCalled();
    expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(before);
  });

  it.each(['ordinary', 'missing-feature'])('rejects a version-matching update to an invalid %s package and reports completed stages', async kind => {
    const root = await fixture();
    await mounted(root);
    const workflow = new PluginManagementWorkflow(root, { installDependencies: async (args, directory) => {
      await runPackageManager(args, directory);
      await writeFile(join(root, 'node_modules/reminder/package.json'), JSON.stringify({ name: 'reminder', version: '2.0.0', ...(kind === 'ordinary' ? {} : { dependencies: { 'missing-feature': '^1' }, zhin: { ...manifest, features: [{ package: 'missing-feature' }] } }) }));
    } });
    await expect(workflow.update('reminder', '2.0.0')).rejects.toMatchObject({ name: 'PluginManagementOperationError', completedStages: ['dependency-update'] });
    expect(await workflow.inspect('reminder')).toMatchObject({ version: '2.0.0' });
  });

  it('does not equate a dependency declaration with an installed package', async () => {
    const root = await fixture();
    const file = join(root, 'package.json');
    const project = JSON.parse(await readFile(file, 'utf8'));
    project.dependencies.reminder = '^1.0.0';
    await writeFile(file, JSON.stringify(project));
    const port = createPluginManagementPort(root);
    expect(await port.planInstall('reminder')).toMatchObject({ alreadyInstalled: false, alreadyDeclared: false });
    expect(await port.inspect('reminder')).toMatchObject({ status: 'not-installed', installed: false, published: false });
  });

  it('preserves the exact install version and reports pending application, not feature success', async () => {
    const root = await fixture();
    const runner = vi.fn(runPackageManager);
    const result = await createPluginManagementPort(root, { installDependencies: runner }).install('reminder@1.2.3');
    expect(runner).toHaveBeenCalledWith(['add', 'reminder@1.2.3'], root);
    expect(result.state).toMatchObject({ version: '1.2.3', installed: true, declared: true, dependencies: 'passed', status: 'pending-restart', published: false, verification: 'not-configured' });
    expect(JSON.parse(await readFile(join(root, 'zhin.config.json'), 'utf8'))).toEqual(application({ reminder: {} }));
  });

  it('refuses a config revision changed during installation and preserves the user edit and installed dependency', async () => {
    const root = await fixture();
    const workflow = new PluginManagementWorkflow(root, { installDependencies: async (args, directory) => {
      await runPackageManager(args, directory);
      await writeFile(join(root, 'zhin.config.json'), JSON.stringify(application({ custom: { endpoint: 'user-edit' } })));
    } });
    let error: unknown;
    try { await workflow.install('reminder'); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(PluginManagementOperationError);
    expect(error).toMatchObject({ completedStages: ['dependency-install'] });
    expect(JSON.parse(await readFile(join(root, 'zhin.config.json'), 'utf8'))).toEqual(application({ custom: { endpoint: 'user-edit' } }));
    expect(await workflow.inspect('reminder')).toMatchObject({ installed: true, declared: false, status: 'installed' });
  });

  it('checks optimistic project revision inside the exclusive project lock before invoking pnpm', async () => {
    const root = await fixture();
    const runner = vi.fn(runPackageManager);
    const workflow = new PluginManagementWorkflow(root, { installDependencies: runner });
    const plan = await workflow.planInstall('reminder');
    const file = join(root, 'package.json');
    const project = JSON.parse(await readFile(file, 'utf8'));
    project.description = 'concurrent edit';
    await writeFile(file, JSON.stringify(project));
    await expect(workflow.install('reminder', undefined, plan.projectRevision)).rejects.toThrow('已被其他会话修改');
    expect(runner).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(file, 'utf8')).description).toBe('concurrent edit');
  });

  it('rejects concurrent independent installers and releases the lock on failure', async () => {
    const root = await fixture();
    let entered!: () => void;
    let finish!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const wait = new Promise<void>(resolve => { finish = resolve; });
    const first = new PluginManagementWorkflow(root, { installDependencies: async (args, directory) => { entered(); await wait; await runPackageManager(args, directory); } });
    const pending = first.install('reminder');
    await ready;
    await expect(new PluginManagementWorkflow(root).install('preferences')).rejects.toThrow('另一进程正在管理插件');
    finish();
    await pending;
    await expect(readFile(join(root, '.zhin/plugin-management.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a real competing Node process using the same workflow lock', async () => {
    const root = await fixture();
    const module = resolve('basic/cli/src/plugin-management/workflow.ts');
    const source = `import {PluginManagementWorkflow} from ${JSON.stringify(module)};
      const manager=new PluginManagementWorkflow(${JSON.stringify(root)},{installDependencies:async()=>{
        console.log('installer-entered'); await new Promise(resolve=>process.stdin.once('data',resolve));
        throw new Error('controlled-abort');}});
      try { await manager.install('reminder'); } catch {} finally { process.exit(0); }`;
    const child = spawn(process.execPath, ['--import', 'tsx', '--conditions=development', '--input-type=module', '-e', source], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    const exit = new Promise<void>((resolveExit, reject) => { child.once('exit', code => code === 0 ? resolveExit() : reject(new Error(`Child installer exited ${code}: ${stderr}`))); child.once('error', reject); });
    try {
      await Promise.race([new Promise<void>(resolveReady => child.stdout.on('data', chunk => { output += String(chunk); if (output.includes('installer-entered')) resolveReady(); })), exit.then(() => { throw new Error('Child installer exited before obtaining lock'); })]);
      await expect(new PluginManagementWorkflow(root).install('preferences')).rejects.toThrow('另一进程正在管理插件');
    } finally { child.stdin.write('release'); await exit; }
    await expect(readFile(join(root, '.zhin/plugin-management.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports a crashed installer lock immediately instead of waiting or stealing a live lock', async () => {
    const root = await fixture();
    await mkdir(join(root, '.zhin'));
    await writeFile(join(root, '.zhin/plugin-management.lock'), JSON.stringify({ pid: 2147483647, nonce: 'crashed' }));
    await expect(new PluginManagementWorkflow(root).install('reminder')).rejects.toThrow('已退出');
  });

  it('validates installed plugin identity and its actual entry before mounting', async () => {
    const root = await fixture();
    const workflow = new PluginManagementWorkflow(root, { installDependencies: async (args, directory) => {
      await runPackageManager(args, directory);
      await rm(join(root, 'node_modules/reminder/plugin.js'));
    } });
    await expect(workflow.install('reminder')).rejects.toThrow('ENOENT');
    expect(await workflow.inspect('reminder')).toMatchObject({ installed: true, plugin: false, declared: false, status: 'degraded' });
  });

  it('rejects a missing required Feature via the same Runtime graph resolver before mounting', async () => {
    const root = await fixture();
    const workflow = new PluginManagementWorkflow(root, { installDependencies: async (args, directory) => {
      await runPackageManager(args, directory);
      await writeFile(join(root, 'node_modules/reminder/package.json'), JSON.stringify({ name: 'reminder', version: '1.0.0', dependencies: { 'missing-feature': '^1' }, zhin: { ...manifest, features: [{ package: 'missing-feature' }] } }));
    } });
    await expect(workflow.install('reminder')).rejects.toThrow('missing-feature');
    expect(await workflow.inspect('reminder')).toMatchObject({ installed: true, declared: false });
  });

  it('exposes missing configuration and absent environment refs, never applies them', async () => {
    const root = await fixture();
    await mounted(root);
    await packageInstalled(root, 'reminder', '1.0.0', { type: 'object', required: ['token'], properties: { token: { type: 'string' } } });
    const restart = vi.fn();
    const workflow = new PluginManagementWorkflow(root, { requestRestart: restart });
    expect(await workflow.inspect('reminder')).toMatchObject({ status: 'missing-config', validation: { valid: false } });
    await expect(workflow.apply('reminder')).rejects.toThrow('不能应用');
    expect(restart).not.toHaveBeenCalled();
    await writeFile(join(root, 'zhin.config.json'), JSON.stringify(application({ reminder: { token: '${ZHIN_PHASE3_UNDEFINED_SECRET}' } })));
    expect(await workflow.inspect('reminder')).toMatchObject({ status: 'missing-config', validation: { valid: true, missingEnv: ['ZHIN_PHASE3_UNDEFINED_SECRET'] } });
  });

  it('rejects development-only environment references in a real production Runtime owner', async () => {
    const root = await fixture();
    await mounted(root);
    await packageInstalled(root, 'reminder', '1.0.0');
    await writeFile(join(root, '.env.development'), 'ZHIN_PHASE3_DEV_ONLY=test-value\n');
    const files = new Map([
      [join(root, 'plugin.js'), { default: definePlugin({ name: 'root' }) }],
      [join(root, 'node_modules/reminder/plugin.js'), { default: definePlugin({ name: 'reminder' }) }],
    ]);
    const modules: ModuleRuntime = { async load<T>(file: string) { return files.get(file) as T; }, async close() {} };
    const runtime = new RootRuntime({ projectRoot: root, modules, environment: { name: 'production', mode: 'production', platform: 'node' }, environmentVariables: await loadRuntimeEnvironmentLayers(root, 'production'), config: JSON.parse(await readFile(join(root, 'zhin.config.json'), 'utf8')) });
    await runtime.start();
    try {
      await writeFile(join(root, 'zhin.config.json'), JSON.stringify(application({ reminder: { commandNamespace: '${ZHIN_PHASE3_DEV_ONLY}' } })));
      const restart = vi.fn();
      const workflow = new PluginManagementWorkflow(root, { snapshots: runtime.snapshots, requestRestart: restart });
      expect(await workflow.inspect('reminder')).toMatchObject({ status: 'missing-config', validation: { missingEnv: ['ZHIN_PHASE3_DEV_ONLY'] } });
      await expect(workflow.apply('reminder')).rejects.toThrow('不能应用');
      expect(restart).not.toHaveBeenCalled();
    } finally { await runtime.stop(); }
  });

  it('retains package dependencies and sibling configuration when unmounting one of multiple instances', async () => {
    const root = await fixture();
    await mounted(root);
    const file = join(root, 'package.json');
    const project = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(file, JSON.stringify(project));
    await writeFile(join(root, 'zhin.config.json'), JSON.stringify(application({ first: {}, second: { label: 'untouched' } }, {first: 'reminder', second: 'reminder'})));
    const runner = vi.fn(runPackageManager);
    const workflow = new PluginManagementWorkflow(root, { installDependencies: runner });
    await expect(workflow.planUninstall('reminder')).rejects.toThrow('多个插件实例');
    await workflow.uninstall('second');
    expect(runner).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(file, 'utf8')).dependencies.reminder).toBe('1.0.0');
    expect(JSON.parse(await readFile(join(root, 'zhin.config.json'), 'utf8'))).toEqual(application({ first: {} }, {first: 'reminder'}));
  });

  it('normal dependencies are installed but never mounted as Plugins', async () => {
    const root = await fixture();
    const workflow = new PluginManagementWorkflow(root, { installDependencies: async (args, directory) => {
      await runPackageManager(args, directory);
      await writeFile(join(root, 'node_modules/reminder/package.json'), JSON.stringify({ name: 'reminder', version: '1.0.0' }));
    } });
    expect((await workflow.install('reminder')).state).toMatchObject({ installed: true, plugin: false, declared: false, restartRequired: false });
  });

  it('does not claim a local CLI inspected the running Host or business action', async () => {
    const root = await fixture();
    await mounted(root);
    const workflow = new PluginManagementWorkflow(root);
    expect(await workflow.apply('reminder')).toMatchObject({ requested: false, state: { status: 'pending-restart' } });
    const plan = await workflow.verificationPlan('reminder');
    expect(plan.checks).toEqual([]);
    expect(await workflow.verify('reminder', 'local-test', plan.generation, plan.projectRevision, plan.checkRevision)).toMatchObject({ status: 'not-configured', generation: null, current: false });
  });

  it('uses actual Runtime defaults when a plugin has no explicit empty config entry', async () => {
    const root = await fixture();
    await mounted(root);
    await writeFile(join(root, 'zhin.config.json'), JSON.stringify(application({}, {reminder: 'reminder'})));
    const files = new Map([
      [join(root, 'plugin.js'), { default: definePlugin({ name: 'root' }) }],
      [join(root, 'node_modules/reminder/plugin.js'), { default: definePlugin({ name: 'reminder', config: { toJsonSchema: () => ({ type: 'object', properties: { label: { type: 'string', default: 'daily' } } }) } }) }],
    ]);
    const modules: ModuleRuntime = { async load<T>(file: string) { return files.get(file) as T; }, async close() {} };
    const runtime = new RootRuntime({ projectRoot: root, modules, environment: { name: 'test', mode: 'test', platform: 'node' }, config: JSON.parse(await readFile(join(root, 'zhin.config.json'), 'utf8')) });
    await runtime.start();
    try {
      expect(await createPluginManagementPort(root, { snapshots: runtime.snapshots }).inspect('reminder')).toMatchObject({ status: 'enabled', published: true, validation: { valid: true } });
      await rm(join(root, 'zhin.config.json'));
      await expect(createPluginManagementPort(root, { snapshots: runtime.snapshots }).inspect('reminder')).rejects.toThrow(/configVersion|configuration/);
    } finally { await runtime.stop(); }
  });

  it('does not let an old generation declaration hide the updated package file schema or missing schema evidence', async () => {
    const root = await fixture();
    await mounted(root);
    await writeFile(join(root, 'zhin.config.json'), JSON.stringify(application({ reminder: { x: 'old' } })));
    const schemaA = { type: 'object', properties: { x: { type: 'string' } } };
    const files = new Map([
      [join(root, 'plugin.js'), { default: definePlugin({ name: 'root' }) }],
      [join(root, 'node_modules/reminder/plugin.js'), { default: definePlugin({ name: 'reminder', config: { toJsonSchema: () => schemaA } }) }],
    ]);
    const modules: ModuleRuntime = { async load<T>(file: string) { return files.get(file) as T; }, async close() {} };
    const runtime = new RootRuntime({ projectRoot: root, modules, environment: { name: 'test', mode: 'test', platform: 'node' }, config: JSON.parse(await readFile(join(root, 'zhin.config.json'), 'utf8')) });
    await runtime.start();
    try {
      const restart = vi.fn();
      const workflow = new PluginManagementWorkflow(root, { snapshots: runtime.snapshots, requestRestart: restart });
      expect(await workflow.inspect('reminder')).toMatchObject({ status: 'enabled', validation: { schemaAvailable: true, valid: true } });
      await packageInstalled(root, 'reminder', '2.0.0', { type: 'object', required: ['y'], properties: { y: { type: 'string' } } });
      expect(await workflow.inspect('reminder')).toMatchObject({ status: 'missing-config', validation: { schemaAvailable: true, valid: false, errors: [{ path: '$.y' }] } });
      await expect(workflow.apply('reminder')).rejects.toThrow('不能应用');
      expect(restart).not.toHaveBeenCalled();
      await rm(join(root, 'node_modules/reminder/schema.json'));
      expect(await workflow.inspect('reminder')).toMatchObject({ status: 'pending-restart', published: false, validation: { schemaAvailable: false, valid: true } });
    } finally { await runtime.stop(); }
  });

  it('uses the formal resolver for a declared local plugin and never removes its source directory', async () => {
    const root = await fixture();
    const pluginRoot = join(root, 'plugins/local');
    await mkdir(pluginRoot, { recursive: true });
    await writeFile(join(pluginRoot, 'package.json'), JSON.stringify({ name: 'actual-local', version: '1.0.0', zhin: manifest }));
    await writeFile(join(pluginRoot, 'plugin.js'), 'export default {};');
    const file = join(root, 'package.json');
    const project = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(join(root, 'zhin.config.json'), JSON.stringify(application({}, {local: './plugins/local'})));
    await writeFile(file, JSON.stringify(project));
    const files = new Map([[join(root, 'plugin.js'), { default: definePlugin({ name: 'root' }) }], [join(pluginRoot, 'plugin.js'), { default: definePlugin({ name: 'local' }) }]]);
    const modules: ModuleRuntime = { async load<T>(file: string) { return files.get(file) as T; }, async close() {} };
    const runtime = new RootRuntime({ projectRoot: root, modules, environment: { name: 'test', mode: 'test', platform: 'node' }, config: JSON.parse(await readFile(join(root, 'zhin.config.json'), 'utf8')) });
    await runtime.start();
    try {
      const runner = vi.fn(runPackageManager);
      const workflow = createPluginManagementPort(root, { snapshots: runtime.snapshots, installDependencies: runner });
      expect(await workflow.inspect('local')).toMatchObject({ packageName: './plugins/local', installed: true, declared: true, status: 'enabled' });
      await workflow.uninstall('local');
      expect(runner).not.toHaveBeenCalled();
      expect(await readFile(join(pluginRoot, 'plugin.js'), 'utf8')).toContain('export default');
    } finally { await runtime.stop(); }
  });

  it('binds approval to exact generation and descriptor effects, rejecting a replaced check with the same id', async () => {
    const root = await fixture();
    await mounted(root);
    const runA = vi.fn(async () => ({ status: 'passed' as const, summary: 'local', evidence: ['local check'] }));
    const runB = vi.fn(async () => ({ status: 'passed' as const, summary: 'platform', evidence: ['platform check'] }));
    const plugin = (run: typeof runA, scope: 'local' | 'platform') => ({ default: definePlugin({ name: 'reminder', setup({ resources }) { resources.provide(pluginVerificationToken, { checks: () => [{ id: 'test', title: 'test', scope, effects: [scope === 'local' ? 'temporary local task' : 'sends a platform message'] }], run }); } }) });
    const files = new Map([[join(root, 'plugin.js'), { default: definePlugin({ name: 'root' }) }], [join(root, 'node_modules/reminder/plugin.js'), plugin(runA, 'local')]]);
    const modules: ModuleRuntime = { async load<T>(file: string) { return files.get(file) as T; }, async close() {} };
    const runtime = new RootRuntime({ projectRoot: root, modules, environment: { name: 'test', mode: 'test', platform: 'node' }, config: JSON.parse(await readFile(join(root, 'zhin.config.json'), 'utf8')) });
    await runtime.start();
    try {
      const workflow = createPluginManagementPort(root, { snapshots: runtime.snapshots });
      const planA = await workflow.verificationPlan('reminder');
      const replacementHost = createPluginManagementPort(root, { snapshots: runtime.snapshots });
      const replacementPlan = await replacementHost.verificationPlan('reminder');
      expect(replacementPlan.generation).toBe(planA.generation);
      expect(replacementPlan.checkRevision).not.toBe(planA.checkRevision);
      await expect(replacementHost.verify('reminder', 'test', planA.generation, planA.projectRevision, planA.checkRevision)).rejects.toThrow('Verification plan changed');
      files.set(join(root, 'node_modules/reminder/plugin.js'), plugin(runB, 'platform'));
      await runtime.reload('root/reminder');
      await expect(workflow.verify('reminder', 'test', planA.generation, planA.projectRevision, planA.checkRevision)).rejects.toThrow('Verification plan changed');
      expect(runA).not.toHaveBeenCalled();
      expect(runB).not.toHaveBeenCalled();
      const planB = await workflow.verificationPlan('reminder');
      expect(planB.checks[0]?.effects).toEqual(['sends a platform message']);
      expect(planB.generation).not.toBe(planA.generation);
    } finally { await runtime.stop(); }
  });

  it('preserves verification translations without making approval depend on display language', async () => {
    const root = await fixture();
    await mounted(root);
    const descriptor = { id: 'local-test', title: '本地检查', titleI18n: { en: 'Local check' }, scope: 'local' as const,
      effects: ['写入再删除一个探针'], effectsI18n: { en: ['Write and delete one probe'] } };
    const run = vi.fn(async () => ({ status: 'passed' as const, summary: '通过', summaryI18n: { en: 'Passed' },
      evidence: ['探针已清理'], evidenceI18n: { en: ['Probe cleaned up'] } }));
    const files = new Map([
      [join(root, 'plugin.js'), { default: definePlugin({ name: 'root' }) }],
      [join(root, 'node_modules/reminder/plugin.js'), { default: definePlugin({ name: 'reminder', setup({ resources }) {
        resources.provide(pluginVerificationToken, { checks: () => [descriptor], run });
      } }) }],
    ]);
    const modules: ModuleRuntime = { async load<T>(file: string) { return files.get(file) as T; }, async close() {} };
    const runtime = new RootRuntime({ projectRoot: root, modules, environment: { name: 'test', mode: 'test', platform: 'node' }, config: JSON.parse(await readFile(join(root, 'zhin.config.json'), 'utf8')) });
    await runtime.start();
    try {
      const workflow = createPluginManagementPort(root, { snapshots: runtime.snapshots });
      const plan = await workflow.verificationPlan('reminder');
      expect(plan.checks[0]).toEqual(descriptor);
      expect((await workflow.verificationPlan('reminder')).checkRevision).toBe(plan.checkRevision);
      expect(run).not.toHaveBeenCalled();
      expect(await workflow.verify('reminder', 'local-test', plan.generation, plan.projectRevision, plan.checkRevision)).toMatchObject({
        status: 'passed', summary: '通过', summaryI18n: { en: 'Passed' }, evidenceI18n: { en: ['Probe cleaned up'] },
      });
      descriptor.effectsI18n.en = ['Changed effect'];
      expect(plan.checks[0]!.effectsI18n?.en).toEqual(['Write and delete one probe']);
      await expect(workflow.verify('reminder', 'local-test', plan.generation, plan.projectRevision, plan.checkRevision)).rejects.toThrow('Verification plan changed');
      expect(run).toHaveBeenCalledOnce();
      descriptor.effectsI18n.en = [];
      await expect(workflow.verificationPlan('reminder')).rejects.toThrow('Invalid plugin verification translations');
      descriptor.effectsI18n.en = [' '];
      await expect(workflow.verificationPlan('reminder')).rejects.toThrow('Invalid plugin verification translations');
    } finally { await runtime.stop(); }
  });

  it('starts a real Runtime owner, runs an explicit local business check, and detects pending config/version changes', async () => {
    const root = await fixture();
    await mounted(root, ['reminder', 'preferences']);
    const effects: string[] = [];
    const check = vi.fn(async () => {
      const task = join(root, '.zhin/test-task.json');
      await writeFile(task, JSON.stringify({ operation: 'verify', dueAt: 1 }));
      expect(JSON.parse(await readFile(task, 'utf8')).operation).toBe('verify');
      await rm(task);
      effects.push('reminder');
      return { status: 'passed' as const, summary: 'Local task written, read and cancelled; no platform delivery', evidence: ['create/read/cancel task', 'no outbound invocation'] };
    });
    const files = new Map([
      [join(root, 'plugin.js'), { default: definePlugin({ name: 'fixture' }) }],
      [join(root, 'node_modules/reminder/plugin.js'), { default: definePlugin({ name: 'reminder', setup({ resources }) { resources.provide(pluginVerificationToken, { checks: () => [{ id: 'local-task', title: 'Local task roundtrip', scope: 'local' as const, effects: ['Creates and deletes a temporary local task; sends no IM message'] }], run: check }); } }) }],
      [join(root, 'node_modules/preferences/plugin.js'), { default: definePlugin({ name: 'fixture' }) }],
    ]);
    const modules: ModuleRuntime = { async load<T>(file: string) { const value = files.get(file); if (!value) throw new Error(file); return value as T; }, async close() {} };
    const runtime = new RootRuntime({ projectRoot: root, modules, environment: { name: 'test', mode: 'test', platform: 'node' }, config: JSON.parse(await readFile(join(root, 'zhin.config.json'), 'utf8')) });
    await runtime.start();
    try {
      const workflow = createPluginManagementPort(root, { snapshots: runtime.snapshots });
      expect(await workflow.inspect('reminder')).toMatchObject({ status: 'enabled', published: true, verification: 'available' });
      expect(await workflow.inspect('preferences')).toMatchObject({ status: 'enabled', verification: 'not-configured' });
      const reminderPlan = await workflow.verificationPlan('reminder');
      const preferencesPlan = await workflow.verificationPlan('preferences');
      expect(reminderPlan.checks).toHaveLength(1);
      expect(check).not.toHaveBeenCalled();
      expect(await workflow.verify('preferences', 'local-task', preferencesPlan.generation, preferencesPlan.projectRevision, preferencesPlan.checkRevision)).toMatchObject({ status: 'not-configured' });
      expect(await workflow.verify('reminder', 'local-task', reminderPlan.generation, reminderPlan.projectRevision, reminderPlan.checkRevision)).toMatchObject({ status: 'passed', scope: 'local', generation: 1, current: true });
      expect(effects).toEqual(['reminder']);
      await packageInstalled(root, 'reminder', '1.0.1');
      expect(await workflow.inspect('reminder')).toMatchObject({ version: '1.0.1', status: 'pending-restart', published: false });
      await packageInstalled(root, 'reminder', '1.0.0');
      await writeFile(join(root, 'zhin.config.json'), JSON.stringify(application({ reminder: { commandNamespace: 'updated' }, preferences: {} })));
      expect(await workflow.inspect('reminder')).toMatchObject({ status: 'pending-restart', published: false });
      expect(await workflow.inspect('preferences')).toMatchObject({ status: 'enabled' });
    } finally { await runtime.stop(); }
  });
});


it('keeps a disabled sibling and its dependency when removing the active alias, and rejects ambiguous packages before writes', async () => {
  const root = await fixture();
  await mounted(root);
  const document = {configVersion: 2, plugins: {active: 'reminder', parked: 'reminder'}, disable_plugins: ['parked'], active: {}, parked: {token: '${UNSET_TOKEN}'}};
  const configFile = join(root, 'zhin.config.json');
  await writeFile(configFile, JSON.stringify(document));
  const manifestBefore = await readFile(join(root, 'package.json'), 'utf8');
  const configBefore = await readFile(configFile, 'utf8');
  const runner = vi.fn(runPackageManager);
  const workflow = new PluginManagementWorkflow(root, {installDependencies: runner});
  await expect(workflow.install('reminder')).rejects.toThrow('多个插件实例');
  await expect(workflow.uninstall('reminder')).rejects.toThrow('多个插件实例');
  expect(runner).not.toHaveBeenCalled();
  expect(await readFile(configFile, 'utf8')).toBe(configBefore);
  expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(manifestBefore);
  expect(await workflow.inspect('parked')).toMatchObject({disabled: true, validation: null});
  await workflow.uninstall('root/active');
  expect(runner).not.toHaveBeenCalled();
  expect(JSON.parse(await readFile(configFile, 'utf8'))).toEqual({configVersion: 2, plugins: {parked: 'reminder'}, disable_plugins: ['parked'], parked: {token: '${UNSET_TOKEN}'}});
});

it('rejects reserved implicit aliases before the package manager runs', async () => {
  const root = await fixture(); const runner = vi.fn(runPackageManager);
  const workflow = new PluginManagementWorkflow(root, {installDependencies: runner});
  await expect(workflow.install('@zhin.js/plugin-ai')).rejects.toThrow(/reserved/);
  expect(runner).not.toHaveBeenCalled();
});
