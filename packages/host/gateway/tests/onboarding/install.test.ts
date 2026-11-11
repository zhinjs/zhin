import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConsolePrincipal } from '@zhin.js/host-http';
import { PluginManagementWorkflow } from '../../src/plugin-management/workflow.js';
import {
  createStreamingPackageManager, detectPackageManager, installPackages, OnboardingError, OnboardingService,
  translatePackageManagerArgs, type InstallEvent, type PackageInstallPort,
} from '../../src/onboarding/index.js';
import { testUser } from '../utils/console-users.js';

let root: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-onboarding-install-')));
  const manifest = { protocol: 1, type: 'plugin', entry: './plugin.js', platformFeatures: false };
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'bot', version: '1.0.0', zhin: manifest }));
  await writeFile(join(root, 'plugin.js'), 'export default {};');
  await writeFile(join(root, 'zhin.config.json'), JSON.stringify({ configVersion: 2, plugins: {} }));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const exists = (path: string) => access(path).then(() => true, () => false);

/** Fake package manager: `add` writes node_modules/<name>, `remove` deletes it; `fail` names fail. */
function fakePackageManager(fail: ReadonlySet<string> = new Set(), calls: string[][] = []) {
  return async (args: readonly string[], projectRoot: string) => {
    calls.push([...args]);
    const [command, ...rest] = args;
    for (const spec of rest.filter(arg => !arg.startsWith('-'))) {
      const at = spec.indexOf('@', spec.startsWith('@') ? 1 : 0);
      const name = at < 0 ? spec : spec.slice(0, at);
      if (fail.has(name)) throw new Error(`fake ${command} failed for ${name}`);
      const directory = join(projectRoot, 'node_modules', ...name.split('/'));
      if (command === 'add') {
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
      } else await rm(directory, { recursive: true, force: true });
    }
  };
}

const owner = testUser('owner');
const bootstrap: ConsolePrincipal = { kind: 'bootstrap', open: false };

describe('installPackages through PluginManagementWorkflow', () => {
  it('installs allowlisted packages and streams progress', async () => {
    const calls: string[][] = [];
    const service = new OnboardingService({
      projectRoot: root, hasOwner: () => true, readConfig: () => ({}),
      installer: new PluginManagementWorkflow(root, { installDependencies: fakePackageManager(new Set(), calls) }),
    });
    const events: InstallEvent[] = [];
    for await (const event of service.streamInstall(['pg', 'zod'], owner)) events.push(event);
    expect(calls).toEqual([['add', 'pg@^8.22.0'], ['add', 'zod']]);
    expect(events.map(event => event.type)).toEqual(['start', 'package-start', 'package-done', 'package-start', 'package-done', 'done']);
    const done = events.at(-1) as Extract<InstallEvent, { type: 'done' }>;
    expect(done.report).toMatchObject({ ok: true, installed: ['pg', 'zod'], rolledBack: [], preexisting: [] });
    expect(await exists(join(root, 'node_modules/pg/package.json'))).toBe(true);
  });

  it('stops at the first failure, rolls back what the batch added and reports it', async () => {
    const calls: string[][] = [];
    await mkdir(join(root, 'node_modules/zod'), { recursive: true });
    await writeFile(join(root, 'node_modules/zod/package.json'), JSON.stringify({ name: 'zod', version: '3.0.0' }));
    const service = new OnboardingService({
      projectRoot: root, hasOwner: () => true, readConfig: () => ({}),
      installer: new PluginManagementWorkflow(root, { installDependencies: fakePackageManager(new Set(['ai']), calls) }),
    });
    const events: InstallEvent[] = [];
    const report = await service.installPackages(['pg', 'zod', 'ai', '@zhin.js/agent'], owner, event => events.push(event));
    expect(report.ok).toBe(false);
    expect(report.failed).toMatchObject({ name: 'ai', completedStages: [] });
    expect(report.failed?.error).toContain('fake add failed for ai');
    expect(report.rolledBack).toEqual(['pg']);
    expect(report.preexisting).toEqual(['zod']);
    expect(report.installed).toEqual(['zod']);
    expect(report.rollbackFailed).toEqual([]);
    expect(calls.map(call => call[0])).toEqual(['add', 'add', 'add', 'remove']);
    expect(calls.at(-1)).toEqual(['remove', 'pg']);
    expect(await exists(join(root, 'node_modules/pg'))).toBe(false);
    expect(await exists(join(root, 'node_modules/zod'))).toBe(true);
    expect(events.filter(event => event.type === 'rollback')).toEqual([{ type: 'rollback', name: 'pg', ok: true }]);
    expect(events.some(event => event.type === 'package-start' && event.name === '@zhin.js/agent')).toBe(false);
  });

  it('reports a rollback that itself fails', async () => {
    const port: PackageInstallPort = {
      inspect: async () => ({ installed: false }),
      install: async spec => { if (spec.startsWith('zod')) throw new Error('boom'); return { restartRequired: true }; },
      uninstall: async () => { throw new Error('locked'); },
    };
    const report = await installPackages([
      { name: 'pg', kind: 'database-driver', spec: 'pg' }, { name: 'zod', kind: 'ai', spec: 'zod' },
    ], { port });
    expect(report).toMatchObject({ ok: false, rolledBack: [], rollbackFailed: [{ name: 'pg', error: 'locked' }], installed: ['pg'], restartRequired: true });
  });

  it('reports adapters installed but awaiting their first account', async () => {
    const need = { name: '@zhin.js/adapter-sandbox', instanceKey: 'sandbox', missing: ['endpoints'], missingEnv: [] };
    const port: PackageInstallPort = {
      inspect: async () => ({ installed: false }),
      install: async spec => (spec.startsWith('@zhin.js/adapter-sandbox') ? { restartRequired: false, needsConfiguration: need } : { restartRequired: true }),
    };
    const events: InstallEvent[] = [];
    const report = await installPackages([
      { name: '@zhin.js/adapter-sandbox', kind: 'adapter', spec: '@zhin.js/adapter-sandbox' }, { name: 'pg', kind: 'database-driver', spec: 'pg' },
    ], { port, onEvent: event => events.push(event) });
    expect(report).toMatchObject({ ok: true, installed: ['@zhin.js/adapter-sandbox', 'pg'], needsConfiguration: [need] });
    expect(events).toContainEqual({ type: 'package-done', name: '@zhin.js/adapter-sandbox', restartRequired: false, needsConfiguration: need });
    const plain = await installPackages([{ name: 'pg', kind: 'database-driver', spec: 'pg' }], { port });
    expect(plain.needsConfiguration).toBeUndefined();
  });

  it('authorizes before any work: bootstrap may only install drivers', async () => {
    const calls: string[][] = [];
    let ownerExists = false;
    const service = new OnboardingService({
      projectRoot: root, hasOwner: () => ownerExists, readConfig: () => ({}),
      installer: new PluginManagementWorkflow(root, { installDependencies: fakePackageManager(new Set(), calls) }),
    });
    await expect(service.installPackages(['mysql2', '@zhin.js/agent'], bootstrap)).rejects.toBeInstanceOf(OnboardingError);
    await expect(service.installPackages(['mysql2@file:../x'], owner)).rejects.toBeInstanceOf(OnboardingError);
    await expect(service.installPackages(['mysql2'], testUser('viewer'))).rejects.toBeInstanceOf(OnboardingError);
    expect(calls).toEqual([]);
    expect((await service.installPackages(['mysql2'], bootstrap)).ok).toBe(true);
    ownerExists = true;
    await expect(service.installPackages(['mongodb'], bootstrap)).rejects.toMatchObject({ code: 'forbidden' });
    expect(calls).toEqual([['add', 'mysql2@^3.23.2']]);
  });
});

describe('package manager', () => {
  it('detects the project package manager', async () => {
    expect(await detectPackageManager(root)).toBe('pnpm');
    await writeFile(join(root, 'package-lock.json'), '{}');
    expect(await detectPackageManager(root)).toBe('npm');
    await writeFile(join(root, 'package.json'), JSON.stringify({ packageManager: 'yarn@4.0.0' }));
    expect(await detectPackageManager(root)).toBe('yarn');
  });

  it('translates workflow invocations and refuses unknown commands or flags', () => {
    expect(translatePackageManagerArgs('pnpm', ['add', '-w', 'pg@^8'])).toEqual(['add', '-w', 'pg@^8']);
    expect(translatePackageManagerArgs('npm', ['add', '-w', '-D', 'pg'])).toEqual(['install', '--save-dev', 'pg']);
    expect(translatePackageManagerArgs('npm', ['remove', 'pg'])).toEqual(['uninstall', 'pg']);
    expect(translatePackageManagerArgs('yarn', ['add', '-w', 'pg'])).toEqual(['add', '-W', 'pg']);
    expect(translatePackageManagerArgs('bun', ['add', '-w', 'pg'])).toEqual(['add', 'pg']);
    expect(() => translatePackageManagerArgs('pnpm', ['exec', 'rm'])).toThrow();
    expect(() => translatePackageManagerArgs('pnpm', ['add', '--registry=http://evil', 'pg'])).toThrow();
  });

  it('spawns without a shell and streams output; non-zero exit rejects', async () => {
    const invocations: { command: string; args: string[]; options: Record<string, unknown> }[] = [];
    const fakeSpawn = ((command: string, args: string[], options: Record<string, unknown>) => {
      invocations.push({ command, args, options });
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
      setImmediate(() => {
        child.stdout.write('Progress: resolved 1\n');
        child.stderr.write('WARN deprecated\n');
        setImmediate(() => child.emit('close', args.includes('bad') ? 1 : 0, null));
      });
      return child;
    }) as never;
    const output: [string, string][] = [];
    const run = createStreamingPackageManager((stream, chunk) => output.push([stream, chunk]), { manager: 'pnpm', spawn: fakeSpawn });
    await run(['add', 'pg'], root);
    expect(invocations[0]).toMatchObject({ command: 'pnpm', args: ['add', 'pg'], options: { cwd: root, shell: false } });
    expect(output).toEqual([['stdout', 'Progress: resolved 1\n'], ['stderr', 'WARN deprecated\n']]);
    await expect(run(['add', 'bad'], root)).rejects.toThrow('pnpm add exited with code 1');
  });
});
