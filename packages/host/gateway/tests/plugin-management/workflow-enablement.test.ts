import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginEnablementError, PluginManagementWorkflow } from '../../src/plugin-management/workflow.js';

const manifest = { protocol: 1, type: 'plugin', entry: './plugin.js', platformFeatures: false, features: [], plugins: [] };
const REQUIRED_SCHEMA = { type: 'object', required: ['token'], properties: { token: { type: 'string' } } };

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-workflow-enable-')));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'bot', version: '1.0.0', zhin: manifest, dependencies: { reminder: '1.0.0', rss: '1.0.0', strict: '1.0.0' } }));
  await writeFile(join(root, 'plugin.js'), 'export default {};');
  await installPlugin('reminder');
  await installPlugin('rss');
  await installPlugin('strict', REQUIRED_SCHEMA);
  await writeConfig({ configVersion: 2, plugins: { reminder: 'reminder', rss: 'rss', strict: 'strict' }, disable_plugins: ['rss', 'strict'], reminder: {}, rss: {}, strict: {} });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function installPlugin(name: string, schema?: unknown) {
  const directory = join(root, 'node_modules', ...name.split('/'));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', zhin: manifest }));
  await writeFile(join(directory, 'plugin.js'), 'export default {};');
  if (schema) await writeFile(join(directory, 'schema.json'), JSON.stringify(schema));
}
const writeConfig = (config: unknown) => writeFile(join(root, 'zhin.config.json'), JSON.stringify(config));
const readConfig = async () => JSON.parse(await readFile(join(root, 'zhin.config.json'), 'utf8')) as Record<string, any>;
const workflow = () => new PluginManagementWorkflow(root);

describe('enable / disable: disable_plugins of one declared instance', () => {
  it('disables an enabled instance by instance key and enables it again', async () => {
    const disabled = await workflow().setEnabled('reminder', false);
    expect(disabled).toMatchObject({ changed: true, restartRequired: true, plan: { instanceKey: 'reminder', packageName: 'reminder', enabled: false }, state: { disabled: true } });
    expect((await readConfig()).disable_plugins).toEqual(['rss', 'strict', 'reminder']);
    const enabled = await workflow().setEnabled('reminder', true);
    expect(enabled).toMatchObject({ changed: true, state: { disabled: false, declared: true } });
    const config = await readConfig();
    expect(config.disable_plugins).toEqual(['rss', 'strict']);
    // Only disable_plugins changes: declarations and instance sections stay as they were.
    expect(config.plugins).toEqual({ reminder: 'reminder', rss: 'rss', strict: 'strict' });
    expect(config.reminder).toEqual({});
  });

  it('accepts the package name of a package declared once', async () => {
    const plan = await workflow().planSetEnabled('rss', true);
    expect(plan).toMatchObject({ instanceKey: 'rss', packageName: 'rss', enabled: true, changed: true, disabled: ['strict'], restartRequired: true });
    await workflow().setEnabled('root/rss', true);
    expect((await readConfig()).disable_plugins).toEqual(['strict']);
  });

  it('succeeds idempotently without writing when the instance already is in the requested state', async () => {
    const before = await readFile(join(root, 'zhin.config.json'), 'utf8');
    expect(await workflow().planSetEnabled('reminder', true)).toMatchObject({ changed: false, disabled: ['rss', 'strict'] });
    expect(await workflow().setEnabled('reminder', true)).toMatchObject({ changed: false });
    expect(await workflow().setEnabled('rss', false)).toMatchObject({ changed: false });
    expect(await readFile(join(root, 'zhin.config.json'), 'utf8')).toBe(before);
  });

  it('refuses reserved keys, the root plugin and undeclared targets', async () => {
    for (const request of ['http', 'plugins', 'disable_plugins', 'root', 'configVersion']) {
      await expect(workflow().planSetEnabled(request, false), request).rejects.toMatchObject({ name: 'PluginEnablementError', code: 'reserved' });
    }
    await expect(workflow().planSetEnabled('bot', false)).rejects.toMatchObject({ code: 'root' });
    // Never suggest installing the raw request: `weather` on npm is not ours (#1250).
    const undeclared = await workflow().planSetEnabled('weather', true).catch((error: unknown) => error);
    expect(undeclared).toMatchObject({ code: 'not-declared', message: '找不到插件实例 weather（配置中没有声明）' });
    expect((undeclared as Error).message).not.toContain('zhin install');
    await expect(workflow().planSetEnabled('Not A Package', true)).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(workflow().planSetEnabled('', true)).rejects.toBeInstanceOf(PluginEnablementError);
  });

  it('suggests only official packages for an undeclared short name (#1250)', async () => {
    await writeConfig({ configVersion: 2, plugins: {} });
    const error = await workflow().planSetEnabled('reminder', true).catch((caught: unknown) => caught) as PluginEnablementError;
    expect(error.code).toBe('not-declared');
    expect(error.message).toContain('zhin install @zhin.js/plugin-reminder');
    expect(error.message).not.toMatch(/zhin install reminder(?![\w-])/u);
    // An official package installed in the project but not declared is a candidate too.
    await installPlugin('@zhin.js/plugin-weather');
    expect(await workflow().planSetEnabled('weather', true).catch((caught: unknown) => (caught as Error).message))
      .toContain('zhin install @zhin.js/plugin-weather');
    // A third-party package installed under its own name is not.
    await installPlugin('foo');
    expect(await workflow().planSetEnabled('foo', true).catch((caught: unknown) => (caught as Error).message))
      .toBe('找不到插件实例 foo（配置中没有声明）');
  });

  it('asks for an exact instance key when a package is declared more than once', async () => {
    await writeConfig({ configVersion: 2, plugins: { home: 'reminder', work: 'reminder' }, home: {}, work: {} });
    await expect(workflow().planSetEnabled('reminder', false)).rejects.toMatchObject({ code: 'invalid-request', message: expect.stringContaining('instanceKey') });
    await workflow().setEnabled('work', false);
    expect((await readConfig()).disable_plugins).toEqual(['work']);
  });

  it('refuses to enable a package that is not installed, but still disables it', async () => {
    await rm(join(root, 'node_modules', 'reminder'), { recursive: true, force: true });
    await writeConfig({ configVersion: 2, plugins: { reminder: 'reminder' }, disable_plugins: ['reminder'], reminder: {} });
    await expect(workflow().planSetEnabled('reminder', true)).rejects.toMatchObject({ code: 'not-installed', message: expect.stringContaining('未安装') });
    await writeConfig({ configVersion: 2, plugins: { reminder: 'reminder' }, reminder: {} });
    await workflow().setEnabled('reminder', false);
    expect((await readConfig()).disable_plugins).toEqual(['reminder']);
  });

  it('refuses to enable an instance whose configuration fails its schema', async () => {
    const before = await readFile(join(root, 'zhin.config.json'), 'utf8');
    const refused = await workflow().planSetEnabled('strict', true).then(() => undefined, (error: unknown) => error);
    expect(refused).toMatchObject({ code: 'invalid-config', errors: [expect.objectContaining({ path: '$.token' })] });
    await expect(workflow().setEnabled('strict', true)).rejects.toMatchObject({ cause: expect.objectContaining({ code: 'invalid-config' }) });
    expect(await readFile(join(root, 'zhin.config.json'), 'utf8')).toBe(before);
  });

  it('checks the expected configuration revision', async () => {
    await expect(workflow().setEnabled('reminder', false, '0'.repeat(64))).rejects.toThrow('已被其他会话修改');
    const plan = await workflow().planSetEnabled('reminder', false);
    await workflow().setEnabled('reminder', false, plan.configurationRevision, plan.projectRevision);
    expect((await readConfig()).disable_plugins).toContain('reminder');
  });
});
