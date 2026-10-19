import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfigDocument } from '@zhin.js/config-file';
import { applyInstanceDeclarationMigration, assertNoPendingInstanceMigration, planInstanceDeclarationMigration, recoverInstanceDeclarationMigration } from '../../src/plugin-runtime/migrate/instance-declarations.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function json(file: string, data: unknown) { await mkdir(join(file, '..'), { recursive: true }); await writeFile(file, JSON.stringify(data)); }
async function fixture(options: { json?: boolean; nested?: boolean; optional?: boolean; alias?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'zhin-instance-migration-')); roots.push(root);
  const aliases = options.alias ? [options.alias] : ['10', '2'];
  await json(join(root, 'package.json'), { name: 'migration-app', type: 'module', scripts: { custom: 'keep' },
    dependencies: { example: 'workspace:*' }, zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: [], plugins: aliases.map(instanceKey => ({ package: './plugins/example', instanceKey, ...(options.optional ? { optional: true } : {}) })) } });
  await json(join(root, 'plugins/example/package.json'), { name: 'example', type: 'module', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: [], plugins: options.nested ? [{ package: './child', instanceKey: 'nested' }] : [] } });
  // Prove static planning: loading this entry throws and leaves an observable marker.
  await writeFile(join(root, 'plugins/example/plugin.ts'), `throw new Error('ENTRY MUST NOT LOAD');\n`);
  await writeFile(join(root, 'plugin.ts'), `throw new Error('ROOT MUST NOT LOAD');\n`);
  const config = join(root, options.json ? 'config.json' : 'zhin.config.yml');
  const source = options.json
    ? '{"http":{"port":8080},"plugin":{},"plugins":{"10":{"token":"${TOKEN}","nil":null},"2":{"flag":false}}}\r\n'
    : `# root comment\r\nhttp:\r\n  port: 8080\r\nplugin: {}\r\nplugins: # instance config\r\n  "${aliases[0]}": # first\r\n    token: "\${TOKEN}" # literal\r\n    nil: null\r\n  ${aliases.length > 1 ? '"2":\r\n    flag: false\r\n' : ''}`;
  await writeFile(config, source); await chmod(config, 0o640);
  await json(join(root, '.zhin/plugin-lifecycle.json'), { schemaVersion: 1, disabled: [aliases.at(-1)] });
  return { root, config, source };
}

it('plans without writes, executes no plugin entry, and migrates identity/raw values/comments/order', async () => {
  const { root, config, source } = await fixture();
  const beforePackage = await readFile(join(root, 'package.json'), 'utf8');
  const plan = await planInstanceDeclarationMigration(root);
  expect(await readFile(config, 'utf8')).toBe(source);
  expect(await readdir(join(root, '.zhin'))).toEqual(['plugin-lifecycle.json']);
  expect(plan.instances).toEqual([
    { instanceKey: '10', package: './plugins/example', pluginId: 'root/10', enabled: true },
    { instanceKey: '2', package: './plugins/example', pluginId: 'root/2', enabled: false },
  ]);
  await applyInstanceDeclarationMigration(plan);
  await expect(assertNoPendingInstanceMigration(root)).resolves.toBeUndefined();
  const value = await createConfigDocument(config).readSource();
  expect(value.pluginOrder).toEqual(['10', '2']);
  expect(value.document).toMatchObject({ configVersion: 2, plugins: { '10': './plugins/example', '2': './plugins/example' }, disable_plugins: ['2'], '10': { token: '${TOKEN}', nil: null }, '2': { flag: false } });
  expect(value.source).toContain('# instance config'); expect(value.source).toContain('# root comment'); expect(value.source).toContain('# first'); expect(value.source).toContain('"${TOKEN}" # literal');
  expect(value.source.replaceAll('\r\n', '')).not.toContain('\n');
  expect((await stat(config)).mode & 0o777).toBe(0o640);
  const journalPath = join(root, '.zhin/instance-declarations-migration/journal.json');
  const journalSource = await readFile(journalPath, 'utf8');
  expect(journalSource).not.toContain('${TOKEN}');
  expect(JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))).toMatchObject({ scripts: { custom: 'keep' }, zhin: { plugins: [] } });
  expect(JSON.parse(await readFile(join(root, '.zhin/plugin-lifecycle.json'), 'utf8')).disabled).toEqual([]);
  const backup = join(root, '.zhin/instance-declarations-migration', JSON.parse(journalSource).files[0].backup);
  expect((await stat(backup)).mode & 0o777).toBe(0o600);
  expect(await readFile(backup, 'utf8')).toBe(source);
  await recoverInstanceDeclarationMigration(root, 'rollback');
  expect(await readFile(config, 'utf8')).toBe(source);
  expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(beforePackage);
  await expect(assertNoPendingInstanceMigration(root)).resolves.toBeUndefined();
  await applyInstanceDeclarationMigration(await planInstanceDeclarationMigration(root));
  expect((await createConfigDocument(config).read()).document.configVersion).toBe(2);
  expect((await readdir(join(root, '.zhin'))).some(file => file.startsWith('instance-declarations-migration.') && file.endsWith('.backup'))).toBe(true);
});

it.each(['yaml', 'json'])('preserves application menu configuration during %s migration and rollback', async format => {
  const { root, config, source } = await fixture({ json: format === 'json' });
  const menuStyle = { title: '工作菜单', accentColor: '#123456' };
  const original = format === 'json'
    ? JSON.stringify({ ...JSON.parse(source), menuKeyword: false, menuStyle })
    : `${source}menuKeyword: false\r\nmenuStyle:\r\n  title: 工作菜单\r\n  accentColor: '#123456'\r\n`;
  await writeFile(config, original);
  await applyInstanceDeclarationMigration(await planInstanceDeclarationMigration(root));
  const { document } = await createConfigDocument(config).read();
  expect(document).toMatchObject({ configVersion: 2, menuKeyword: false, menuStyle, plugin: {} });
  expect(document.plugins).not.toHaveProperty('menuStyle');
  await recoverInstanceDeclarationMigration(root, 'rollback');
  expect(await readFile(config, 'utf8')).toBe(original);
});

it('migrates JSON while preserving declaration 10/2 rather than JS integer-key order', async () => {
  const { root, config } = await fixture({ json: true });
  await applyInstanceDeclarationMigration(await planInstanceDeclarationMigration(root));
  expect((await createConfigDocument(config).read()).pluginOrder).toEqual(['10', '2']);
});

for (const crashAt of [0, 1, 2]) {
  it(`recovers a cutover interrupted after file ${crashAt}`, async () => {
    const { root } = await fixture();
    await expect(applyInstanceDeclarationMigration(await planInstanceDeclarationMigration(root), {
      afterWrite: index => { if (index === crashAt) throw new Error('simulated crash'); },
    })).rejects.toThrow('simulated crash');
    await expect(assertNoPendingInstanceMigration(root)).rejects.toThrow('Incomplete');
    await recoverInstanceDeclarationMigration(root, 'continue');
    await expect(assertNoPendingInstanceMigration(root)).resolves.toBeUndefined();
    expect(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).zhin.plugins).toEqual([]);
  });
}

it('rejects revision drift before writing and recovery never overwrites an external edit', async () => {
  const { root, config } = await fixture();
  const plan = await planInstanceDeclarationMigration(root);
  await writeFile(config, `${plan.files[0]!.before.source}# user edit\n`);
  await expect(applyInstanceDeclarationMigration(plan)).rejects.toThrow('source changed');
  await writeFile(config, plan.files[0]!.before.source);
  await expect(applyInstanceDeclarationMigration(await planInstanceDeclarationMigration(root), { afterWrite: () => { throw new Error('crash'); } })).rejects.toThrow('crash');
  await writeFile(config, 'user: changed\n');
  await expect(recoverInstanceDeclarationMigration(root, 'continue')).rejects.toThrow('will not overwrite');
  await expect(recoverInstanceDeclarationMigration(root, 'rollback')).rejects.toThrow('will not overwrite');
  expect(await readFile(config, 'utf8')).toBe('user: changed\n');
});

it.each([{ nested: true }, { optional: true }, { alias: 'database' }])('rejects lossy migration %j before changes', async options => {
  const { root, config, source } = await fixture(options);
  await expect(planInstanceDeclarationMigration(root)).rejects.toThrow(/nested|optional|collision/);
  expect(await readFile(config, 'utf8')).toBe(source);
});

it('rejects orphan disabled/config, YAML aliases, duplicate keys and source package changes', async () => {
  const { root, config, source } = await fixture();
  await json(join(root, '.zhin/plugin-lifecycle.json'), { schemaVersion: 1, disabled: ['orphan'] });
  await expect(planInstanceDeclarationMigration(root)).rejects.toThrow('Orphan disabled');
  await json(join(root, '.zhin/plugin-lifecycle.json'), { schemaVersion: 1, disabled: [] });
  await writeFile(config, `${source}other: &x {}\ncopy: *x\n`);
  await expect(planInstanceDeclarationMigration(root)).rejects.toThrow('aliases');
  await writeFile(config, `${source}http: {}\n`);
  await expect(planInstanceDeclarationMigration(root)).rejects.toThrow('unique');
  await writeFile(config, source);
  const plan = await planInstanceDeclarationMigration(root);
  await writeFile(join(root, 'plugins/example/package.json'), '{}');
  await expect(applyInstanceDeclarationMigration(plan)).rejects.toThrow('source changed');
});

it('checks facade-inherited declarations and refuses inherited nested instances', async () => {
  const { root } = await fixture();
  const packagePath = join(root, 'package.json');
  const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
  manifest.dependencies['zhin.js'] = '1.1.0';
  manifest.dependencies['@zhin.js/core'] = '1.1.0';
  await json(packagePath, manifest);
  await json(join(root, 'node_modules/zhin.js/package.json'), { name: 'zhin.js', dependencies: {}, zhin: { protocol: 1, type: 'plugin', entry: './plugin.js', plugins: [{ package: './nested', instanceKey: 'from-facade' }], features: [] } });
  await json(join(root, 'node_modules/@zhin.js/core/package.json'), { name: '@zhin.js/core', zhin: { protocol: 1, type: 'plugin', entry: './plugin.js', plugins: [], features: [] } });
  await json(join(root, 'node_modules/zhin.js/nested/package.json'), { name: 'nested-suite', zhin: { protocol: 1, type: 'plugin', entry: './plugin.js', plugins: [{ package: './child', instanceKey: 'child' }], features: [] } });
  await expect(planInstanceDeclarationMigration(root)).rejects.toThrow('nested');
  // Even an empty facade is consulted: its revision must guard the plan.
  await json(join(root, 'node_modules/zhin.js/package.json'), { name: 'zhin.js', dependencies: {}, zhin: { protocol: 1, type: 'plugin', entry: './plugin.js', plugins: [], features: [] } });
  const plan = await planInstanceDeclarationMigration(root);
  expect(plan.guards.some(guard => guard.path.endsWith('node_modules/zhin.js/package.json'))).toBe(true);
});

it('uses an explicitly selected external lifecycle and refuses a running Bot PID', async () => {
  const { root } = await fixture();
  const external = join(root, 'external-lifecycle.json');
  await json(external, { schemaVersion: 1, disabled: ['10'] });
  const plan = await planInstanceDeclarationMigration(root, { lifecycleFile: external });
  expect(plan.instances.find(instance => instance.instanceKey === '10')?.enabled).toBe(false);
  await writeFile(join(root, '.zhin.pid'), String(process.pid));
  await expect(applyInstanceDeclarationMigration(plan)).rejects.toThrow('Stop the running Bot');
});

it('the explicit CLI defaults to preview and prints no inline configuration values', async () => {
  const { migrateCommand } = await import('../../src/commands/migrate.js');
  const { root, config, source } = await fixture();
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    await migrateCommand.parseAsync(['node', 'zhin', 'instances']);
    const output = log.mock.calls.map(call => String(call[0])).join('\n');
    expect(output).toContain('dry-run');
    expect(output).not.toContain('${TOKEN}');
    expect(await readFile(config, 'utf8')).toBe(source);
    expect(await readdir(join(root, '.zhin'))).toEqual(['plugin-lifecycle.json']);
  } finally { log.mockRestore(); cwd.mockRestore(); }
});

it.each(['yaml', 'json', 'package', 'lifecycle'] as const)('redacts malformed %s preview errors and leaves files unchanged', async target => {
  const { root, config } = await fixture({ json: target === 'json' });
  const packagePath = join(root, 'package.json');
  const lifecyclePath = join(root, '.zhin/plugin-lifecycle.json');
  const brokenPath = target === 'package' ? packagePath : target === 'lifecycle' ? lifecyclePath : config;
  await writeFile(brokenPath, target === 'yaml'
    ? 'plugins: {token: synthetic-secret-malformed-preview, broken: [}\n'
    : 'synthetic-secret-malformed-preview');
  const files = [config, packagePath, lifecyclePath];
  const originals = await Promise.all(files.map(file => readFile(file, 'utf8')));
  const directory = await readdir(join(root, '.zhin'));
  let failure: unknown;
  try { await planInstanceDeclarationMigration(root); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(Error);
  expect(String(failure)).toContain('Cannot migrate');
  expect(String(failure)).not.toContain('synthetic');
  expect(await Promise.all(files.map(file => readFile(file, 'utf8')))).toEqual(originals);
  expect(await readdir(join(root, '.zhin'))).toEqual(directory);
});


it('explicit recovery reclaims only an exited migration lock owner', async () => {
  const { root } = await fixture();
  await expect(applyInstanceDeclarationMigration(await planInstanceDeclarationMigration(root), {
    afterWrite: () => { throw new Error('interrupted'); },
  })).rejects.toThrow('interrupted');
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  const pid = child.pid;
  await new Promise<void>((resolve, reject) => { child.once('exit', () => resolve()); child.once('error', reject); });
  const lock = join(root, '.zhin/plugin-management.lock');
  await writeFile(lock, JSON.stringify({ pid: process.pid, nonce: 'live' }));
  await expect(recoverInstanceDeclarationMigration(root, 'continue')).rejects.toThrow('running process');
  await writeFile(lock, JSON.stringify({ pid, nonce: 'crashed' }));
  await recoverInstanceDeclarationMigration(root, 'continue');
  await expect(assertNoPendingInstanceMigration(root)).resolves.toBeUndefined();
});


it.each(['continue', 'rollback'] as const)('preserves 0660 permissions under umask 022 across interrupted migration and %s', async action => {
  const originalUmask = process.umask(0o022);
  try {
    const {root, config, source} = await fixture();
    const files = [config, join(root, 'package.json'), join(root, '.zhin/plugin-lifecycle.json')];
    const originals = await Promise.all(files.map(file => readFile(file, 'utf8')));
    for (const file of files) await chmod(file, 0o660);
    const plan = await planInstanceDeclarationMigration(root);
    await expect(applyInstanceDeclarationMigration(plan, {afterWrite: index => {if (index === 0) throw new Error('permission crash');}})).rejects.toThrow('permission crash');
    expect((await stat(config)).mode & 0o777).toBe(0o660);
    await recoverInstanceDeclarationMigration(root, action);
    for (const file of files) expect((await stat(file)).mode & 0o777).toBe(0o660);
    if (action === 'rollback') {
      expect(await readFile(config, 'utf8')).toBe(source);
      expect(await Promise.all(files.map(file => readFile(file, 'utf8')))).toEqual(originals);
    } else expect((await createConfigDocument(config).read()).document.configVersion).toBe(2);
    const directory = join(root, '.zhin/instance-declarations-migration');
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    for (const entry of await readdir(directory)) expect((await stat(join(directory, entry))).mode & 0o777).toBe(0o600);
  } finally {process.umask(originalUmask);}
});
