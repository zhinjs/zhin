import { mkdir, mkdtemp, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RootRuntime, type ModuleRuntime } from '@zhin.js/runtime';
import { loadRuntimeEnvironmentLayers } from '../src/plugin-runtime/start/environment.js';
import { definePlugin, pluginVerificationToken } from '@zhin.js/plugin-runtime';
import { PluginManagementWorkflow, PluginManagementOperationError } from '../src/plugin-management/workflow.js';
import { createPluginManagementPort } from '../src/plugin-runtime/console/plugin-management.js';

const roots: string[] = [];
const manifest = { protocol: 1, type: 'plugin', entry: './plugin.js', platformFeatures: false, features: [], plugins: [] };
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-plugin-workflow-')));
  roots.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'test-project', version: '1.0.0', zhin: manifest, dependencies: {} }));
  await writeFile(join(root, 'plugin.js'), 'export default {};');
  await writeFile(join(root, 'zhin.config.json'), JSON.stringify({ plugins: {} }));
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
    expect(JSON.parse(await readFile(join(root, 'zhin.config.json'), 'utf8'))).toEqual({ plugins: { reminder: {} } });
  });

  it('refuses a config revision changed during installation and preserves the user edit and installed dependency', async () => {
    const root = await fixture();
    const workflow = new PluginManagementWorkflow(root, { installDependencies: async (args, directory) => {
      await runPackageManager(args, directory);
      await writeFile(join(root, 'zhin.config.json'), JSON.stringify({ plugins: { custom: { endpoint: 'user-edit' } } }));
    } });
    let error: unknown;
    try { await workflow.install('reminder'); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(PluginManagementOperationError);
    expect(error).toMatchObject({ completedStages: ['dependency-install'] });
    expect(JSON.parse(await readFile(join(root, 'zhin.config.json'), 'utf8'))).toEqual({ plugins: { custom: { endpoint: 'user-edit' } } });
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
    await writeFile(join(root, 'zhin.config.json'), JSON.stringify({ plugins: { reminder: { token: '${ZHIN_PHASE3_UNDEFINED_SECRET}' } } }));
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
    const runtime = new RootRuntime({ projectRoot: root, modules, environment: { name: 'production', mode: 'production', platform: 'node' }, environmentVariables: await loadRuntimeEnvironmentLayers(root, 'production'), config: { plugins: { reminder: {} } } });
    await runtime.start();
    try {
      await writeFile(join(root, 'zhin.config.json'), JSON.stringify({ plugins: { reminder: { commandNamespace: '${ZHIN_PHASE3_DEV_ONLY}' } } }));
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
    project.zhin.plugins[0].instanceKey = 'first';
    project.zhin.plugins.push({ package: 'reminder', instanceKey: 'second' });
    await writeFile(file, JSON.stringify(project));
    await writeFile(join(root, 'zhin.config.json'), JSON.stringify({ plugins: { first: {}, second: { label: 'untouched' } } }));
    const runner = vi.fn(runPackageManager);
    const workflow = new PluginManagementWorkflow(root, { installDependencies: runner });
    await expect(workflow.planUninstall('reminder')).rejects.toThrow('多个插件实例');
    await workflow.uninstall('second');
    expect(runner).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(file, 'utf8')).zhin.plugins).toEqual([{ package: 'reminder', instanceKey: 'first' }]);
    expect(JSON.parse(await readFile(join(root, 'zhin.config.json'), 'utf8'))).toEqual({ plugins: { first: {} } });
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
    await writeFile(join(root, 'zhin.config.json'), JSON.stringify({ plugins: {} }));
    const files = new Map([
      [join(root, 'plugin.js'), { default: definePlugin({ name: 'root' }) }],
      [join(root, 'node_modules/reminder/plugin.js'), { default: definePlugin({ name: 'reminder', config: { toJsonSchema: () => ({ type: 'object', properties: { label: { type: 'string', default: 'daily' } } }) } }) }],
    ]);
    const modules: ModuleRuntime = { async load<T>(file: string) { return files.get(file) as T; }, async close() {} };
    const runtime = new RootRuntime({ projectRoot: root, modules, environment: { name: 'test', mode: 'test', platform: 'node' }, config: { plugins: {} } });
    await runtime.start();
    try {
      expect(await createPluginManagementPort(root, { snapshots: runtime.snapshots }).inspect('reminder')).toMatchObject({ status: 'enabled', published: true, validation: { valid: true } });
      await rm(join(root, 'zhin.config.json'));
      expect(await createPluginManagementPort(root, { snapshots: runtime.snapshots }).inspect('reminder')).toMatchObject({ status: 'enabled', published: true, validation: { valid: true } });
    } finally { await runtime.stop(); }
  });

  it('does not let an old generation declaration hide the updated package file schema or missing schema evidence', async () => {
    const root = await fixture();
    await mounted(root);
    await writeFile(join(root, 'zhin.config.json'), JSON.stringify({ plugins: { reminder: { x: 'old' } } }));
    const schemaA = { type: 'object', properties: { x: { type: 'string' } } };
    const files = new Map([
      [join(root, 'plugin.js'), { default: definePlugin({ name: 'root' }) }],
      [join(root, 'node_modules/reminder/plugin.js'), { default: definePlugin({ name: 'reminder', config: { toJsonSchema: () => schemaA } }) }],
    ]);
    const modules: ModuleRuntime = { async load<T>(file: string) { return files.get(file) as T; }, async close() {} };
    const runtime = new RootRuntime({ projectRoot: root, modules, environment: { name: 'test', mode: 'test', platform: 'node' }, config: { plugins: { reminder: { x: 'old' } } } });
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
    project.zhin.plugins = [{ package: './plugins/local', instanceKey: 'local' }];
    await writeFile(file, JSON.stringify(project));
    const files = new Map([[join(root, 'plugin.js'), { default: definePlugin({ name: 'root' }) }], [join(pluginRoot, 'plugin.js'), { default: definePlugin({ name: 'local' }) }]]);
    const modules: ModuleRuntime = { async load<T>(file: string) { return files.get(file) as T; }, async close() {} };
    const runtime = new RootRuntime({ projectRoot: root, modules, environment: { name: 'test', mode: 'test', platform: 'node' }, config: { plugins: {} } });
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
    const runtime = new RootRuntime({ projectRoot: root, modules, environment: { name: 'test', mode: 'test', platform: 'node' }, config: { plugins: { reminder: {} } } });
    await runtime.start();
    try {
      const workflow = createPluginManagementPort(root, { snapshots: runtime.snapshots });
      const planA = await workflow.verificationPlan('reminder');
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
    const runtime = new RootRuntime({ projectRoot: root, modules, environment: { name: 'test', mode: 'test', platform: 'node' }, config: { plugins: { reminder: {}, preferences: {} } } });
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
      await writeFile(join(root, 'zhin.config.json'), JSON.stringify({ plugins: { reminder: { commandNamespace: 'updated' }, preferences: {} } }));
      expect(await workflow.inspect('reminder')).toMatchObject({ status: 'pending-restart', published: false });
      expect(await workflow.inspect('preferences')).toMatchObject({ status: 'enabled' });
    } finally { await runtime.stop(); }
  });
});
