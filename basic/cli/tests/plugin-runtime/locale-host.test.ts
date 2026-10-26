import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import commandFeature, { CommandIndex, commandFeatureId, defineCommand } from '@zhin.js/command';
import { definePlugin, projectLocaleToken, rootPluginId, userLocalePreferencesToken,
  type DatabaseHost, type RuntimeSnapshot, type UserLocalePreferences } from '@zhin.js/plugin-runtime';
import { RootRuntime, type ModuleRuntime } from '@zhin.js/runtime';
import { messageLocale } from '../../../../packages/im/core/src/plugin-runtime/im/locale.js';
import { createDatabaseHost, installDatabaseHost } from '../../src/plugin-runtime/database-host-installer.js';
import { installLocaleHost } from '../../src/plugin-runtime/locale-host-installer.js';
import { sqliteAvailable } from './sqlite-availability.js';

const endpoint = { adapter: 'test', id: 'root/test\0zhin.adapter\0one' };
const privateChat = { endpoint, kind: 'private' as const, id: 'alice' };
const group = { endpoint, kind: 'group' as const, id: 'group' };
const channel = { endpoint, kind: 'channel' as const, id: 'channel', parent: { kind: 'channel' as const, id: 'guild' }, threadId: 'thread' };

class Modules implements ModuleRuntime {
  readonly values = new Map<string, unknown>();
  async load<T>(source: string): Promise<T> {
    if (!this.values.has(source)) throw new Error(`Missing fixture ${source}`);
    return this.values.get(source) as T;
  }
  affectedSources(source: string): readonly string[] { return [source]; }
  invalidate(): void {}
  async close(): Promise<void> {}
}
async function write(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value));
}
async function fixture(withCommands = true) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'zhin-locale-')));
  const modules = new Modules();
  await write(join(directory, 'package.json'), { name: '@test/root',
    dependencies: withCommands ? { '@test/command': 'workspace:*' } : {},
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: withCommands ? [{ package: '@test/command' }] : [] } });
  await write(join(directory, 'plugin.ts'), '');
  modules.values.set(join(directory, 'plugin.ts'), { default: definePlugin({ name: 'root' }) });
  if (withCommands) {
    await write(join(directory, 'packages/command/package.json'), { name: '@test/command',
      zhin: { protocol: 1, type: 'feature', entry: './index.ts' } });
    await write(join(directory, 'packages/command/index.ts'), '');
    modules.values.set(join(directory, 'packages/command/index.ts'), { default: commandFeature });
    await write(join(directory, 'commands/check/index.ts'), '');
    modules.values.set(join(directory, 'commands/check/index.ts'), { default: defineCommand({ execute: ({ locale }) => locale }) });
  }
  return { directory, modules };
}
function preferences(snapshot: RuntimeSnapshot) {
  return snapshot.resources.get(snapshot.root)?.get(userLocalePreferencesToken.id) as UserLocalePreferences | undefined;
}
function commands(snapshot: RuntimeSnapshot) {
  const value = snapshot.projections.get(commandFeatureId);
  if (!(value instanceof CommandIndex)) throw new Error('Missing command index');
  return value;
}
const noDatabase: DatabaseHost = { dialect: 'memory', started: false, define: vi.fn(), tables: () => [],
  models: { get: () => undefined }, getRawDatabase: () => undefined, start: async () => {}, stop: async () => {} };

it('registers a real language command with actual prefixes, and keeps project language without SQL', async () => {
  const f = await fixture();
  const runtime = new RootRuntime({ projectRoot: f.directory, modules: f.modules,
    config: { configVersion: 2, locale: 'en' }, environment: { name: 'test', mode: 'test', platform: 'node' },
    installResources: installLocaleHost(noDatabase) });
  try {
    await runtime.start();
    expect(preferences(runtime.snapshot)).toBeUndefined();
    expect(runtime.snapshot.resources.get(rootPluginId())?.get(projectLocaleToken.id)).toBe('en');
    const index = commands(runtime.snapshot);
    expect(index.list('en').some(item => item.name === 'language')).toBe(true);
    const input = { conversation: privateChat, sender: { id: 'alice' }, locale: 'en' };
    expect(await index.dispatch('language', input, undefined, '##')).toMatchObject({ value: 'Usage: ##language zh-CN or ##language en' });
    expect(await index.dispatch('language zh-CN', input, undefined, '##')).toMatchObject({ value: expect.stringContaining('require SQLite') });
    expect(await messageLocale(runtime.snapshot, privateChat, 'alice')).toBe('en');
  } finally { await runtime.stop(); await rm(f.directory, { recursive: true, force: true }); }
});

it('does not create a command capability when the command feature is absent', async () => {
  const f = await fixture(false);
  const runtime = new RootRuntime({ projectRoot: f.directory, modules: f.modules,
    config: { configVersion: 2 }, environment: { name: 'test', mode: 'test', platform: 'node' },
    installResources: installLocaleHost(noDatabase) });
  try {
    await runtime.start();
    expect([...runtime.snapshot.capabilities.values()].some(slot => slot.localName === 'language')).toBe(false);
  } finally { await runtime.stop(); await rm(f.directory, { recursive: true, force: true }); }
});

it.skipIf(!sqliteAvailable)('keeps endpoint and sender isolation across chats, HMR and a SQL restart', async () => {
  const f = await fixture();
  const databaseConfig = { dialect: 'sqlite' as const, filename: join(f.directory, 'preferences.sqlite') };
  let database = createDatabaseHost(databaseConfig);
  const create = () => new RootRuntime({ projectRoot: f.directory, modules: f.modules,
    config: { configVersion: 2 }, environment: { name: 'test', mode: 'test', platform: 'node' },
    installResources(context) { installDatabaseHost(database)(context); installLocaleHost(database)(context); } });
  let runtime = create();
  try {
    await runtime.start();
    const command = commands(runtime.snapshot);
    expect(await command.dispatch('language en', { conversation: group, sender: { id: 'alice' }, locale: 'zh-CN' }, undefined, '!'))
      .toMatchObject({ value: expect.stringContaining('Your language is now English') });
    for (const conversation of [privateChat, group, channel]) {
      expect(await messageLocale(runtime.snapshot, conversation, 'alice')).toBe('en');
      expect(await messageLocale(runtime.snapshot, conversation, 'bob')).toBe('zh-CN');
    }
    expect(await messageLocale(runtime.snapshot, { ...privateChat, endpoint: { ...endpoint, id: 'root/test\0zhin.adapter\0two' } }, 'alice')).toBe('zh-CN');
    expect(await messageLocale(runtime.snapshot, { ...privateChat, endpoint: { ...endpoint, adapter: 'other-platform' } }, 'alice')).toBe('zh-CN');
    const oldPreferences = preferences(runtime.snapshot)!;
    const previousGeneration = runtime.snapshot.generation;
    const hmr = runtime.createHmrCoordinator({ onRestartRequired() { throw new Error('Unexpected process restart'); }, onError(error) { throw error; } });
    await hmr.enqueue(join(f.directory, 'commands/check/index.ts'));
    expect(runtime.snapshot.generation).toBeGreaterThan(previousGeneration);
    expect(await messageLocale(runtime.snapshot, group, 'alice')).toBe('en');
    expect(await oldPreferences.get(endpoint, 'alice')).toBe('en');
    await hmr.stop();
    await runtime.stop();
    await expect(oldPreferences.set(endpoint, 'alice', 'zh-CN')).rejects.toThrow('inactive generation');
    await database.stop();
    database = createDatabaseHost(databaseConfig);
    runtime = create();
    await runtime.start();
    expect(await messageLocale(runtime.snapshot, channel, 'alice')).toBe('en');
    expect(await commands(runtime.snapshot).dispatch('language zh-CN', { conversation: privateChat, sender: { id: 'alice' }, locale: 'en' }, undefined, ''))
      .toMatchObject({ value: expect.stringContaining('个人语言已设置') });
    expect(await messageLocale(runtime.snapshot, group, 'alice')).toBe('zh-CN');
  } finally { await runtime.stop(); await database.stop(); await rm(f.directory, { recursive: true, force: true }); }
});
