import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PermissionHost, permissionHostToken } from '../../../../packages/im/permission/src/index.js';
import commandFeature, { CommandIndex, commandFeatureId } from '@zhin.js/command';
import { defineFeatureProvider } from '@zhin.js/feature-kit';
import { capabilityId, childPluginId, definePlugin, featureId, pluginConsoleRpcToken, rootPluginId, type PluginConsoleRpc } from 'zhin.js';
import { RootRuntime, type ModuleRuntime } from '../../../../packages/im/runtime/src/index.js';
import plugin from '../plugin.js';
import listCommand from '../commands/bili-draft/list/index.js';
import showCommand from '../commands/bili-draft/show/[id]/index.js';
import editCommand from '../commands/bili-draft/edit/[id]/index.js';
import sendCommand from '../commands/bili-draft/send/[id]/index.js';
import dropCommand from '../commands/bili-draft/drop/[id]/index.js';
import loginStartCommand from '../commands/bili-login/start/index.js';
import loginStatusCommand from '../commands/bili-login/status/index.js';
import { adapterFeature, AdapterIndex, adapterFeatureId, endpointEventGatewayToken } from 'zhin.js/adapter';
import { BilibiliAdapter } from '../src/adapter.js';
import adapterDefinition from '../adapters/bilibili/index.js';

const definitions = new Map([
  ['bili-draft/list', listCommand], ['bili-draft/show/[id]', showCommand], ['bili-draft/edit/[id]', editCommand],
  ['bili-draft/send/[id]', sendCommand], ['bili-draft/drop/[id]', dropCommand],
  ['bili-login/start', loginStartCommand], ['bili-login/status', loginStatusCommand],
]);
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
it('discovers the published plugin entry and protects localized review commands in an actual Runtime', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  expect(manifest.zhin.entry).toBe('./plugin.js');
  expect(manifest.files).toContain('plugin.js');
  await expect(readFile(new URL('../plugin.ts', import.meta.url), 'utf8')).resolves.toContain('definePlugin');
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'bili-localization-')));
  const modules = new Modules();
  const write = async (path: string, value: unknown) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value));
  };
  await write(join(directory, 'package.json'), { name: '@test/root', dependencies: {
    '@zhin.js/adapter-bilibili': 'workspace:*', '@zhin.js/adapter': 'workspace:*', '@zhin.js/command': 'workspace:*',
    '@zhin.js/page': 'workspace:*',
  }, zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } });
  await write(join(directory, 'plugin.ts'), '');
  modules.values.set(join(directory, 'plugin.ts'), { default: definePlugin({ name: 'root' }) });
  await write(join(directory, 'plugins/bilibili/package.json'), manifest);
  await write(join(directory, 'plugins/bilibili/schema.json'), await readFile(new URL('../schema.json', import.meta.url), 'utf8'));
  await write(join(directory, 'plugins/bilibili/plugin.js'), '');
  modules.values.set(join(directory, 'plugins/bilibili/plugin.js'), { default: plugin });
  for (const [path, definition] of definitions) {
    const source = join(directory, `plugins/bilibili/commands/${path}/index.ts`);
    await write(source, ''); modules.values.set(source, { default: definition });
  }
  const syntheticPage = defineFeatureProvider({ protocol: 1, id: featureId('zhin.page'),
    authoring: { conventions: [], validate(value) { return value; } }, runtime: { project() { return { value: undefined }; } } });
  for (const [name, definition] of [['adapter', adapterFeature], ['command', commandFeature], ['page', syntheticPage]] as const) {
    await write(join(directory, `packages/${name}/package.json`), { name: `@zhin.js/${name}`, zhin: { protocol: 1, type: 'feature', featureApi: '1.0.0', entry: './index.ts' } });
    await write(join(directory, `packages/${name}/index.ts`), '');
    modules.values.set(join(directory, `packages/${name}/index.ts`), { default: definition });
  }
  const adapterSource = join(directory, 'plugins/bilibili/adapters/bilibili/index.ts');
  await write(adapterSource, ''); modules.values.set(adapterSource, { default: adapterDefinition });
  const runtime = new RootRuntime({ projectRoot: directory, modules,
    config: { configVersion: 2, plugins: { bilibili: '@zhin.js/adapter-bilibili' }, bilibili: { commandNamespace: 'review', endpoints: [{ id: 'bili', videos: [], sessdata: 'synthetic', biliJct: 'synthetic', dataDir: join(directory, 'data') }] } },
    environment: { name: 'test', mode: 'test', platform: 'node' },
    installResources(context) {
      context.resources.provide(permissionHostToken, new PermissionHost());
      context.resources.provide(endpointEventGatewayToken, { receive: async () => undefined });
    } });
  const posts: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/x/web-interface/nav')) return new Response(JSON.stringify({ code: 0, data: { isLogin: true, mid: 99 } }));
    if (!url.includes('/x/v2/reply/add')) throw new Error('Unexpected offline Bilibili request');
    posts.push(String(init?.body)); return new Response(JSON.stringify({ code: 0, data: { rpid_str: '777' } }));
  }));
  const input = (locale: 'zh-CN' | 'en', master = true) => ({ locale,
    conversation: { endpoint: { adapter: 'chat', id: 'chat-bot' }, kind: 'private' as const, id: 'reviewer' },
    sender: { id: 'reviewer', roles: master ? ['master'] : [] } });
  try {
    await runtime.start();
    const commands = runtime.snapshot.projections.get(commandFeatureId);
    expect(commands).toBeInstanceOf(CommandIndex);
    const index = commands as CommandIndex;
    expect(index.list()).toHaveLength(7);
    const resources = runtime.snapshot.resources.get(childPluginId(rootPluginId(), 'bilibili'));
    const rpc = resources?.get(pluginConsoleRpcToken.id) as PluginConsoleRpc;
    expect([...rpc.methods.keys()].sort()).toEqual(['drop', 'edit', 'login', 'login-cancel', 'logout', 'send', 'status']);
    for (const [name, method] of rpc.methods) {
      expect(method.page).toBe('index');
      expect(method.requiredPermissions.length, name).toBeGreaterThan(0);
    }
    const adapters = runtime.snapshot.projections.get(adapterFeatureId);
    if (!(adapters instanceof AdapterIndex)) throw new Error('Real AdapterIndex is missing');
    const adapter = adapters.adapters().find(candidate => candidate instanceof BilibiliAdapter);
    if (!(adapter instanceof BilibiliAdapter)) throw new Error('Real Bilibili Adapter is missing');
    const endpoint = adapter.getEndpoint(adapter.list()[0]!.instanceId);
    if (!endpoint) throw new Error('Real Bilibili Endpoint is missing');
    const draft = endpoint.drafts.add({ oid: '123', root: '1', parent: '1', message: '回复原文 保持不变', context: { author: '原作者', text: '原评论 {command}' } });
    const denied = await index.dispatch(`review bili-draft send ${draft.id}`, input('en', false), undefined, '!');
    expect(denied.status).toBe('denied');
    expect(posts).toHaveLength(0);
    expect(endpoint.drafts.get(draft.id)).toBeDefined();
    const english = await index.dispatch('review bili-draft list', input('en'), undefined, '!');
    expect(english.value).toContain('drafts awaiting review');
    expect(english.value).toContain('!review bili-draft send <id>');
    expect(english.value).toContain('!review bili-draft edit <id> <new content>');
    expect(english.value).toContain('原评论 {command}');
    const chinese = await index.dispatch('review bili-draft list', input('zh-CN'), undefined, '##');
    expect(chinese.value).toContain('待审草稿');
    expect(chinese.value).toContain('##review bili-draft drop <id>');
    const unknown = await index.dispatch('review bili-draft list', input('en'));
    expect(unknown.value).not.toContain('bili-draft send');
    const missingText = await index.dispatch(`review bili-draft edit ${draft.id}`, input('en'));
    expect(missingText.value).toContain('invocation is unavailable');
    expect(missingText.value).not.toContain('undefined');
    const usage = await index.dispatch(`review bili-draft edit ${draft.id}`, input('en'), undefined, '!');
    expect(usage.value).toBe('Usage: !review bili-draft edit <id> <new content>');
    const edited = await index.dispatch(`review bili-draft edit ${draft.id} 最终 用户文案`, input('en'), undefined, '!');
    expect(edited.value).toContain('Updated; not sent yet');
    expect(edited.value).toContain(`!review bili-draft send ${draft.id}`);
    expect(endpoint.drafts.get(draft.id)?.message).toBe('最终 用户文案');
    expect(posts).toHaveLength(0);
    expect((await index.dispatch(`review bili-draft send ${draft.id}`, input('en'), undefined, '!')).value).toContain('Posted to Bilibili:');
    expect(posts).toHaveLength(1);
    expect(new URLSearchParams(posts[0]).get('message')).toBe('最终 用户文案');
    expect((await index.dispatch(`review bili-draft send ${draft.id}`, input('en'), undefined, '!')).value).toContain('was not found');
    expect(posts).toHaveLength(1);
    expect((await index.dispatch('review bili-login status', input('zh-CN'), undefined, '!')).value).toContain('[bili]');
    const group = { ...input('zh-CN'), conversation: { ...input('zh-CN').conversation, kind: 'group' as const, id: 'g1' } };
    expect((await index.dispatch('review bili-login start', group, undefined, '!')).value).toContain('只能在私聊');
    expect((await index.dispatch('review bili-login status', input('en', false), undefined, '!')).status).toBe('denied');
  } finally { await runtime.stop(); vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }); }
});
