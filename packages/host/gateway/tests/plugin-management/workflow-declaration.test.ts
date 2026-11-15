import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginDeclarationError, PluginManagementWorkflow } from '../../src/plugin-management/workflow.js';
import { isRegistryPackageRequest, projectPinsExactZhinVersions } from '../../src/plugin-management/exact-pins.js';

const manifest = { protocol: 1, type: 'plugin', entry: './plugin.js', platformFeatures: false, features: [], plugins: [] };
const ADAPTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['endpoints'],
  properties: {
    commandPrefix: { type: 'string', default: '' },
    endpoints: { type: 'array', items: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  },
};
const DEFAULTED_SCHEMA = { type: 'object', properties: { label: { type: 'string', default: 'daily' } } };

let root: string;
const schemas = new Map<string, unknown>();

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-workflow-declare-')));
  schemas.clear();
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'bot', version: '1.0.0', zhin: manifest, dependencies: {} }));
  await writeFile(join(root, 'plugin.js'), 'export default {};');
  await writeFile(join(root, 'zhin.config.json'), JSON.stringify({ configVersion: 2, plugins: {} }));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const readConfig = async () => JSON.parse(await readFile(join(root, 'zhin.config.json'), 'utf8')) as Record<string, any>;
const readProject = async () => JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as Record<string, any>;

/** Fake `pnpm add`: records the dependency and writes a plugin package with its schema. */
async function packageManager(args: readonly string[], projectRoot: string) {
  const request = args.at(-1)!;
  const at = request.indexOf('@', request.startsWith('@') ? 1 : 0);
  const name = at < 0 ? request : request.slice(0, at);
  const directory = join(projectRoot, 'node_modules', ...name.split('/'));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', zhin: manifest }));
  await writeFile(join(directory, 'plugin.js'), 'export default {};');
  const schema = schemas.get(name);
  if (schema) await writeFile(join(directory, 'schema.json'), JSON.stringify(schema));
  const project = await readProject();
  project.dependencies[name] = '1.0.0';
  await writeFile(join(projectRoot, 'package.json'), JSON.stringify(project));
}

const workflow = () => new PluginManagementWorkflow(root, { installDependencies: packageManager });

describe('installing with enable: declaration follows the plugin schema', () => {
  it('declares a plugin whose schema is satisfied by its defaults', async () => {
    schemas.set('reminder', DEFAULTED_SCHEMA);
    const result = await workflow().install('reminder');
    expect(result.needsConfiguration).toBeUndefined();
    expect(result.state).toMatchObject({ installed: true, declared: true, status: 'pending-restart' });
    const config = await readConfig();
    expect(config.plugins).toEqual({ reminder: 'reminder' });
    // Defaults stay in the package schema; the file gets the empty section the Runtime completes.
    expect(config.reminder).toEqual({});
  });

  it('installs but leaves undeclared a plugin whose schema requires fields without defaults', async () => {
    schemas.set('@zhin.js/adapter-sandbox', ADAPTER_SCHEMA);
    const before = await readFile(join(root, 'zhin.config.json'), 'utf8');
    const result = await workflow().install('@zhin.js/adapter-sandbox');
    expect(result.needsConfiguration).toEqual({ name: '@zhin.js/adapter-sandbox', instanceKey: 'sandbox', missing: ['endpoints'], missingEnv: [] });
    expect(result.restartRequired).toBe(false);
    expect(result.state).toMatchObject({ installed: true, plugin: true, declared: false, status: 'installed' });
    expect((await readProject()).dependencies['@zhin.js/adapter-sandbox']).toBe('1.0.0');
    expect(await readFile(join(root, 'zhin.config.json'), 'utf8')).toBe(before);
  });

  it('treats defaults referencing missing environment variables as incomplete configuration', async () => {
    schemas.set('reminder', { type: 'object', properties: { token: { type: 'string', default: '${ZHIN_DECLARE_TEST_UNDEFINED}' } } });
    const result = await workflow().install('reminder');
    expect(result.needsConfiguration).toEqual({ name: 'reminder', instanceKey: 'reminder', missing: [], missingEnv: ['ZHIN_DECLARE_TEST_UNDEFINED'] });
    expect((await readConfig()).plugins).toEqual({});
  });
});

describe('declare: an installed plugin with its first configuration', () => {
  beforeEach(async () => {
    schemas.set('@zhin.js/adapter-sandbox', ADAPTER_SCHEMA);
    await workflow().install('@zhin.js/adapter-sandbox');
  });

  it('declares the instance and writes its validated section atomically', async () => {
    const result = await workflow().declare('@zhin.js/adapter-sandbox', { endpoints: [{ id: 'e2e' }] });
    expect(result).toMatchObject({ packageName: '@zhin.js/adapter-sandbox', instanceKey: 'sandbox', state: { declared: true } });
    expect(await readConfig()).toEqual({ configVersion: 2, plugins: { sandbox: '@zhin.js/adapter-sandbox' }, sandbox: { endpoints: [{ id: 'e2e' }] } });
  });

  it('accepts an explicit instance key', async () => {
    await workflow().declare('@zhin.js/adapter-sandbox', { endpoints: [] }, { instanceKey: 'sandbox-2' });
    expect((await readConfig()).plugins).toEqual({ 'sandbox-2': '@zhin.js/adapter-sandbox' });
  });

  it('refuses an invalid explicit configuration without writing anything', async () => {
    const before = await readFile(join(root, 'zhin.config.json'), 'utf8');
    for (const config of [{}, { endpoints: [{}] }, { endpoints: 'x' }, { unknown: true, endpoints: [] }]) {
      const refused = await workflow().declare('@zhin.js/adapter-sandbox', config).then(() => undefined, (error: unknown) => error);
      expect(refused, JSON.stringify(config)).toBeInstanceOf(Error);
      expect((refused as Error & { cause?: unknown }).cause).toBeInstanceOf(PluginDeclarationError);
    }
    await expect(workflow().planDeclaration('@zhin.js/adapter-sandbox', {})).rejects.toMatchObject({ errors: [{ path: '$.endpoints' }] });
    expect(await readFile(join(root, 'zhin.config.json'), 'utf8')).toBe(before);
  });

  it('refuses declared, reserved, versioned and uninstalled targets', async () => {
    await workflow().declare('@zhin.js/adapter-sandbox', { endpoints: [] });
    await expect(workflow().planDeclaration('@zhin.js/adapter-sandbox', { endpoints: [] })).rejects.toThrow('已声明');
    await expect(workflow().planDeclaration('@zhin.js/adapter-sandbox', { endpoints: [] }, { instanceKey: 'http' })).rejects.toThrow('保留配置键');
    await expect(workflow().planDeclaration('@zhin.js/adapter-sandbox@1.0.0', { endpoints: [] }, { instanceKey: 'other' })).rejects.toThrow('不能指定版本');
    await expect(workflow().planDeclaration('zhin-plugin-missing', {})).rejects.toThrow('生产依赖');
    await expect(workflow().planDeclaration('@zhin.js/adapter-sandbox', [] as unknown, { instanceKey: 'other' })).rejects.toThrow('config 必须是对象');
  });

  it('checks the expected configuration revision', async () => {
    await expect(workflow().declare('@zhin.js/adapter-sandbox', { endpoints: [] }, { expectedRevision: '0'.repeat(64) })).rejects.toThrow('已被其他会话修改');
    expect((await readConfig()).plugins).toEqual({});
  });
});

describe('exact version pins follow the project (#1250)', () => {
  it('passes --save-exact to the package manager when every zhin dependency is exact', async () => {
    const project = await readProject();
    project.dependencies = { 'zhin.js': '1.5.0', '@zhin.js/adapter-sandbox': '1.2.3', lodash: '^4.17.0' };
    await writeFile(join(root, 'package.json'), JSON.stringify(project));
    const calls: (readonly string[])[] = [];
    await new PluginManagementWorkflow(root, { installDependencies: async (args, projectRoot) => { calls.push(args); await packageManager(args, projectRoot); } })
      .install('reminder', undefined, undefined, { enable: false });
    expect(calls).toEqual([['add', '--save-exact', 'reminder']]);
  });

  it('keeps the default when a zhin dependency is a range, or the source is not the registry', async () => {
    const project = await readProject();
    project.dependencies = { 'zhin.js': '^1.5.0' };
    await writeFile(join(root, 'package.json'), JSON.stringify(project));
    const calls: (readonly string[])[] = [];
    await new PluginManagementWorkflow(root, { installDependencies: async (args, projectRoot) => { calls.push(args); await packageManager(args, projectRoot); } })
      .install('reminder', undefined, undefined, { enable: false });
    expect(calls).toEqual([['add', 'reminder']]);
  });

  it('decides from zhin.js / @zhin.js/* registry specs only', () => {
    expect(projectPinsExactZhinVersions({ dependencies: { 'zhin.js': '1.5.0' }, devDependencies: { '@zhin.js/cli': '1.6.0-beta.1' } })).toBe(true);
    expect(projectPinsExactZhinVersions({ dependencies: { 'zhin.js': '1.5.0' }, devDependencies: { '@zhin.js/cli': '~1.6.0' } })).toBe(false);
    expect(projectPinsExactZhinVersions({ dependencies: { 'zhin.js': '1.5.0', '@zhin.js/x': '>=1.0.0' } })).toBe(false);
    expect(projectPinsExactZhinVersions({ dependencies: { 'zhin.js': '1.x' } })).toBe(false);
    expect(projectPinsExactZhinVersions({ dependencies: { 'zhin.js': '*' } })).toBe(false);
    // Protocols and tags say nothing about the style; nothing left means no pin.
    expect(projectPinsExactZhinVersions({ dependencies: { 'zhin.js': 'workspace:*', '@zhin.js/x': '1.0.0' } })).toBe(true);
    expect(projectPinsExactZhinVersions({ dependencies: { 'zhin.js': 'workspace:*', '@zhin.js/x': 'latest', lodash: '4.17.21' } })).toBe(false);
    expect(projectPinsExactZhinVersions({ dependencies: { 'zhin-like': '1.0.0' } })).toBe(false);
    expect(projectPinsExactZhinVersions(undefined)).toBe(false);
    expect(isRegistryPackageRequest('@zhin.js/plugin-nettools@1.2.3')).toBe(true);
    expect(isRegistryPackageRequest('reminder')).toBe(true);
    expect(isRegistryPackageRequest('github:user/repo')).toBe(false);
    expect(isRegistryPackageRequest('./plugins/local')).toBe(false);
    expect(isRegistryPackageRequest('git+https://example.test/x.git')).toBe(false);
  });
});
