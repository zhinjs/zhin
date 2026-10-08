import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const modulePath = (name) => join(repository, `packages/im/${name}/lib/index.js`);
const { RootRuntime, NativeDevelopmentModuleRuntime } = await import(pathToFileURL(modulePath('runtime')).href);
const { commandFeatureId } = await import(pathToFileURL(modulePath('command')).href);
const { createToken } = await import(pathToFileURL(modulePath('plugin-runtime')).href);
const fixture = await mkdtemp(join(tmpdir(), 'zhin-native-hmr-acceptance-'));
const physicalProject = join(await realpath(fixture), 'physical');
await mkdir(physicalProject);
const project = join(fixture, 'alias');
await symlink(physicalProject, project, 'dir');
const watchMode = process.argv.includes('--watch');
const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 10000;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
const receipt = { loader: 'NativeDevelopmentModuleRuntime', notification: watchMode ? 'actual filesystem watcher' : 'explicit HmrCoordinator.enqueue', checks: [], errors: [] };
let runtime;
let coordinator;
let oldLease;
let disposed = 0;
try {
  const save = async (relative, content) => {
    const path = join(project, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(`${path}.acceptance-tmp`, content);
    await rename(`${path}.acceptance-tmp`, path);
    return path;
  };
  await save('package.json', JSON.stringify({ name: '@fixture/native-root', type: 'module', dependencies: { '@fixture/command': 'workspace:*' }, zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: [{ package: '@fixture/command' }] } }));
  await save('packages/command/package.json', JSON.stringify({ name: '@fixture/command', type: 'module', zhin: { protocol: 1, type: 'feature', entry: './index.ts' } }));
  await save('packages/command/index.ts', `export { default } from ${JSON.stringify(modulePath('command'))};\n`);
  await save('plugin.ts', `import { definePlugin } from ${JSON.stringify(modulePath('plugin-runtime'))};\nexport default definePlugin({ name: 'native-root' });\n`);
  const command = async (version) => save('commands/probe/index.ts', `import { defineCommand } from ${JSON.stringify(modulePath('command'))};\nimport { createToken } from ${JSON.stringify(modulePath('plugin-runtime'))};\nexport default defineCommand({ execute: ({ use }) => use(createToken('fixture.greeting')) + ':${version}' });\n`);
  const source = await command('v1');
  const modules = new NativeDevelopmentModuleRuntime({ projectRoot: project, watch: watchMode });
  runtime = new RootRuntime({ projectRoot: project, modules, environment: { name: 'acceptance', mode: 'test', platform: 'node' }, installResources({ resources }) { resources.provide(createToken('fixture.greeting'), 'hello', () => { disposed += 1; }); } });
  const commits = [];
  runtime.onGenerationCommit(({ current }) => commits.push(current.snapshot.generation));
  const first = await runtime.start();
  const execute = (snapshot) => snapshot.projections.get(commandFeatureId).execute('probe');
  assert.equal(await execute(first), 'hello:v1');
  oldLease = runtime.snapshots.acquire();
  coordinator = runtime.createHmrCoordinator({ onRestartRequired() { throw new Error('Unexpected process restart'); }, onError(error) { receipt.errors.push(error.message); } });
  if (watchMode) coordinator.start();
  const reload = async (expected) => {
    if (watchMode) await waitFor(async () => await execute(runtime.snapshot) === expected, expected);
    else await coordinator.enqueue(source);
  };
  assert.notEqual(source, await realpath(source));
  assert.equal(runtime.sourceOwnership.recordsFor(source).length, 1);
  receipt.checks.push('symlink notification matches physical source ownership');
  await command('v2');
  await reload('hello:v2');
  const second = runtime.snapshot;
  assert.equal(await execute(second), 'hello:v2');
  assert.equal(await execute(oldLease.value), 'hello:v1');
  assert.equal(disposed, 0);
  receipt.checks.push('native TS reload uses new command; old leased generation retains old command/resource');
  await save('commands/probe/index.ts', 'export default { execute: "invalid" };\n');
  if (watchMode) await waitFor(() => receipt.errors.length > 0, 'invalid module rejected');
  else await assert.rejects(coordinator.enqueue(source), TypeError);
  assert.equal(runtime.snapshot, second);
  assert.equal(await execute(runtime.snapshot), 'hello:v2');
  assert.equal(disposed, 0);
  receipt.checks.push('invalid capability rejects reload; committed generation and resources remain usable');
  await command('v3');
  await reload('hello:v3');
  assert.equal(await execute(runtime.snapshot), 'hello:v3');
  assert.equal(await execute(oldLease.value), 'hello:v1');
  receipt.checks.push('correcting failed source permits a later reload without restart');
  await rm(source);
  if (watchMode) await waitFor(() => !runtime.snapshot.projections.get(commandFeatureId).has('probe'), 'removed command');
  else await coordinator.enqueue(source);
  assert.equal(runtime.snapshot.projections.get(commandFeatureId).has('probe'), false);
  receipt.checks.push('removing capability removes it from current generation');
  if (watchMode) {
    await save('commands/new-probe/index.ts', `import { defineCommand } from ${JSON.stringify(modulePath('command'))};\nexport default defineCommand({ execute: () => 'new-directory' });\n`);
    await waitFor(() => runtime.snapshot.projections.get(commandFeatureId).has('new-probe'), 'new capability directory');
    assert.equal(await runtime.snapshot.projections.get(commandFeatureId).execute('new-probe'), 'new-directory');
    receipt.checks.push('watcher discovers a newly created capability directory without manual notification');
  }
  oldLease.release(); oldLease = undefined;
  await coordinator.stop(); coordinator = undefined;
  if (watchMode) {
    const stoppedGeneration = runtime.snapshot.generation;
    await command('after-stop');
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(runtime.snapshot.generation, stoppedGeneration);
    assert.equal(runtime.snapshot.projections.get(commandFeatureId).has('probe'), false);
    receipt.checks.push('stopped watcher admits no further reload after another source edit');
  }
  const stopping = runtime.stop();
  assert.equal(runtime.stop(), stopping);
  await stopping;
  await runtime.stop();
  assert.equal(disposed, 1);
  receipt.checks.push('repeat stop shares outcome; root resource disposed exactly once');
  receipt.committedGenerations = commits;
  receipt.resourceDisposals = disposed;
  receipt.ok = true;
  const target = resolve(process.argv.slice(2).find((arg) => arg !== '--watch') ?? join(repository, watchMode ? 'test-results/runtime/native-hmr-watcher-current.json' : 'test-results/runtime/native-hmr-current.json'));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt));
} finally {
  oldLease?.release();
  await coordinator?.stop().catch(() => {});
  await runtime?.stop().catch(() => {});
  await rm(fixture, { recursive: true, force: true });
}
