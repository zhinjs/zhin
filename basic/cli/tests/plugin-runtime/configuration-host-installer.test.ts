import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import adapterFeature, { Adapter, AdapterIndex, adapterFeatureId, createEndpointSpecification, defineAdapter, endpointSpec,
  type EndpointSendRequest } from '@zhin.js/adapter';
import commandFeature, { commandFeatureId, type CommandIndex } from '@zhin.js/command';
import { createConfigDocument } from '@zhin.js/config-file';
import { ImRuntime } from '@zhin.js/core/runtime';
import { definePlugin, type RuntimeConfigDocument } from '@zhin.js/plugin-runtime';
import { RootRuntime, type ModuleRuntime } from '@zhin.js/runtime';
import { ConsoleConfigurationStore } from '../../src/plugin-runtime/console/module.js';
import { installConfigurationHost } from '../../src/plugin-runtime/configuration-host-installer.js';
import { createConfigurationChatAuthorizer, createEndpointRoleResolver, createSenderEnricher } from '../../src/plugin-runtime/sender-enrichment.js';

class Client extends EventEmitter {
  readonly sendNative = vi.fn(async (_request: EndpointSendRequest) => 'sent');
  readonly stopNative = vi.fn();
  readonly stopped = Promise.withResolvers<void>();
  readonly [endpointSpec] = createEndpointSpecification(this, {
    start() {}, open() {}, close() {}, stop: () => { this.stopNative(); this.stopped.resolve(); }, send: request => this.sendNative(request),
  });
}
class Platform extends Adapter<Client> { protected createEndpoint() { return new Client(); } }
class Modules implements ModuleRuntime {
  readonly values = new Map<string, unknown>();
  async load<T>(source: string): Promise<T> { if (!this.values.has(source)) throw new Error('Missing fixture module'); return this.values.get(source) as T; }
  invalidate() {} async close() {}
}
type Store = Pick<ConsoleConfigurationStore, 'readChat' | 'patchChat'>;
async function fixture(options: { locale?: 'zh-CN' | 'en'; commands?: boolean; globalMasters?: readonly string[]; store?: (real: ConsoleConfigurationStore) => Store } = {}) {
  const project = await realpath(await mkdtemp(join(tmpdir(), 'zhin-config-chat-')));
  const modules = new Modules();
  const setups = { root: 0 };
  const put = async (file: string, data: unknown) => { await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(data)); };
  const document: RuntimeConfigDocument = { configVersion: 2, locale: options.locale ?? 'en',
    ...(options.globalMasters ? { ai: { trigger: { masters: options.globalMasters } } } : {}),
    plugins: { bot: '@test/bot', other: '@test/bot' },
    bot: { master: 'alice', commandPrefix: '!!', nickname: 'Before', token: 'DO_NOT_DISCLOSE', endpoints: [{ id: 'same' }] },
    other: { master: 'bob', commandPrefix: '#', nickname: 'Other', endpoints: [{ id: 'same' }] } };
  await put(join(project, 'package.json'), { name: '@test/root', dependencies: { '@test/command': 'workspace:*', '@test/bot': 'workspace:*' },
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: options.commands === false ? [] : [{ package: '@test/command' }] } });
  await put(join(project, 'plugin.ts'), {});
  modules.values.set(join(project, 'plugin.ts'), { default: definePlugin({ name: 'root', setup() { setups.root++; } }) });
  await put(join(project, 'plugins/bot/package.json'), { name: '@test/bot', dependencies: { '@test/adapter': 'workspace:*', '@test/command': 'workspace:*' },
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: [{ package: '@test/adapter' }, ...(options.commands === false ? [{ package: '@test/command' }] : [])] } });
  await put(join(project, 'plugins/bot/schema.json'), { type: 'object', additionalProperties: false, properties: {
    master: { type: 'string' }, commandPrefix: { type: 'string' }, nickname: { type: 'string' },
    token: { type: 'string', writeOnly: true }, endpoints: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } },
  } });
  await put(join(project, 'plugins/bot/plugin.ts'), {});
  modules.values.set(join(project, 'plugins/bot/plugin.ts'), { default: definePlugin({ name: 'bot', configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] } }) });
  const source = join(project, 'plugins/bot/adapters/platform/index.ts'); await put(source, {});
  modules.values.set(source, { default: defineAdapter({ capabilities: ['inbound', 'outbound'], createAdapter: () => new Platform() }) });
  for (const [name, feature] of [['command', commandFeature], ['adapter', adapterFeature]] as const) {
    await put(join(project, `packages/${name}/package.json`), { name: `@test/${name}`, zhin: { protocol: 1, type: 'feature', entry: './index.ts' } });
    await put(join(project, `packages/${name}/index.ts`), {}); modules.values.set(join(project, `packages/${name}/index.ts`), { default: feature });
  }
  const file = join(project, 'zhin.config.json'); await put(file, document);
  const config = createConfigDocument(file);
  const roles = await createEndpointRoleResolver(document);
  const im = new ImRuntime({ enrichSender: await createSenderEnricher(document, roles) });
  const realStore = new ConsoleConfigurationStore({ projectRoot: project, document: config,
    configDeclarations: () => runtime.configurationSchemas,
    validateConfiguration: next => runtime.validateConfiguration(next),
    applyConfiguration: revision => runtime.applyConfiguration(revision), readApplication: () => runtime.configurationApplication });
  const store = options.store?.(realStore) ?? realStore;
  const runtime = new RootRuntime({ projectRoot: project, config, modules, environment: { name: 'test', mode: 'test', platform: 'node' },
    installResources(context) { im.install(context.resources); installConfigurationHost({ store, authorize: createConfigurationChatAuthorizer(document, roles) })(context); } });
  try { await runtime.start(); im.attach(runtime.snapshots); }
  catch (error) { await runtime.stop(); await rm(project, { recursive: true, force: true }); throw error; }
  const index = runtime.snapshot.projections.get(adapterFeatureId) as AdapterIndex;
  const rows = index.list();
  const row = rows.find(item => item.owner === 'root/bot')!;
  const other = rows.find(item => item.owner === 'root/other')!;
  const client = index.clientById<Client>(row.id), otherClient = index.clientById<Client>(other.id);
  const receive = async (text: string, input: { sender?: string; kind?: 'private' | 'group' | 'channel'; other?: boolean; metadata?: Record<string, unknown> } = {}) => {
    const selected = input.other ? other : row, endpoint = input.other ? otherClient : client;
    return endpoint[endpointSpec].events.message({ conversation: { endpoint: { id: selected.id, adapter: 'platform' }, kind: input.kind ?? 'private', id: 'conversation' },
      content: text, sender: { id: input.sender ?? 'alice' }, metadata: input.metadata });
  };
  return { project, runtime, realStore, store, client, otherClient, index, row, receive, setups,
    close: async () => { await runtime.stop(); await rm(project, { recursive: true, force: true }); } };
}
function lastReply(client: Client): string { return String(client.sendNative.mock.calls.at(-1)?.[0].payload); }

it('applies a safe nickname through real IM dispatch, store and Root without waiting for its own operation lease', async () => {
  const f = await fixture();
  try {
    const oldPort = f.index.profile(f.row.id)!;
    const generation = f.runtime.snapshot.generation;
    await f.receive('!!config set bot.nickname -- "After via chat"');
    expect(lastReply(f.client)).toContain('Configuration saved.');
    expect(f.runtime.snapshot.generation).toBeGreaterThan(generation);
    const next = f.runtime.snapshot.projections.get(adapterFeatureId) as AdapterIndex;
    expect(next.clientById(f.row.id)).toBe(f.client);
    expect(next.profile(f.row.id)!.peek().values.nickname).toBe('After via chat');
    expect(oldPort.peek().values.nickname).toBe('Before');
    expect(f.client.stopNative).not.toHaveBeenCalled();
    expect(f.otherClient.sendNative).not.toHaveBeenCalled();
    expect([...f.runtime.snapshot.projections.keys()]).not.toContain('zhin.agent');
  } finally { await f.close(); }
});

it('rebuilds Root from a real chat operation, replies once in its original language and admits new authorized messages', async () => {
  const f = await fixture({ locale: 'en' });
  const read = vi.spyOn(f.realStore, 'readChat');
  try {
    const generation = f.runtime.snapshot.generation;
    expect(f.setups.root).toBe(1);
    const changed = await f.receive('!!config set locale -- "zh-CN"');
    expect(changed).toMatchObject({ status: 'executed', value: expect.stringContaining('Configuration saved.') });
    expect(f.runtime.snapshot.generation).toBeGreaterThan(generation);
    expect(f.setups.root).toBe(2);
    expect(f.client.sendNative).toHaveBeenCalledOnce();
    expect(lastReply(f.client)).toContain('Configuration saved.');
    const next = f.runtime.snapshot.projections.get(adapterFeatureId) as AdapterIndex;
    const row = next.list().find(item => item.owner === 'root/bot')!;
    const client = next.clientById<Client>(row.id);
    expect(client).not.toBe(f.client);
    expect(client.sendNative).not.toHaveBeenCalled();
    const receive = (sender: string) => client[endpointSpec].events.message({
      conversation: { endpoint: { id: row.id, adapter: 'platform' }, kind: 'private', id: 'conversation' },
      content: '!!config status', sender: { id: sender },
    });
    await receive('alice');
    expect(lastReply(client)).toContain('此文件版本与当前运行配置一致。');
    expect(client.sendNative).toHaveBeenCalledOnce();
    expect(f.client.sendNative).toHaveBeenCalledOnce();
    const reads = read.mock.calls.length;
    await receive('stranger');
    expect(read).toHaveBeenCalledTimes(reads);
    expect(lastReply(client)).not.toContain('此文件版本与当前运行配置一致。');
    expect(f.otherClient.sendNative).not.toHaveBeenCalled();
    await f.client.stopped.promise;
    expect(f.client.stopNative).toHaveBeenCalledOnce();
  } finally { await f.close(); }
});

it('requires the owner of the actual source Bot in private chat, including same-named accounts', async () => {
  const f = await fixture(); const read = vi.spyOn(f.realStore, 'readChat');
  try {
    for (const input of [ { sender: 'stranger' }, { sender: 'alice', kind: 'group' as const }, { sender: 'alice', kind: 'channel' as const },
      { sender: 'alice', other: true, metadata: { endpoint: 'same', roles: ['master'] } } ]) {
      await f.receive(input.other ? '#config get bot.nickname' : '!!config get bot.nickname', input);
    }
    expect(read).not.toHaveBeenCalled();
    await f.receive('#config get bot.nickname', { sender: 'bob', other: true });
    expect(read).toHaveBeenCalledOnce();
    expect(lastReply(f.otherClient)).toContain('Before');
    const commands = f.runtime.snapshot.projections.get(commandFeatureId) as CommandIndex;
    await expect(commands.execute('config status')).rejects.toThrow('Permission denied');
    await commands.dispatch({ input: 'config get bot.nickname', source: { content: 'config get bot.nickname', sender: { id: 'alice', roles: ['master'] },
      conversation: { endpoint: { id: f.row.id, adapter: 'platform' }, kind: 'private', id: 'conversation' } } });
    expect(read).toHaveBeenCalledOnce();
  } finally { await f.close(); }
});

it('uses actual prefixes and both locales without inventing a command invocation', async () => {
  const f = await fixture({ locale: 'zh-CN' });
  try {
    await f.receive('!!config');
    expect(lastReply(f.client)).toContain('!!config set');
    await f.receive('!!config set bot.nickname -- invalid-json');
    expect(lastReply(f.client)).toBe('配置值必须是有效 JSON；字符串需要双引号。');
    await f.receive('#config', { sender: 'bob', other: true });
    expect(lastReply(f.otherClient)).toContain('#config get');
  } finally { await f.close(); }
});

it('retains existing global master authority only through a real source Bot operation', async () => {
  const f = await fixture({ globalMasters: ['global'] });
  try {
    await f.receive('!!config get other.nickname', { sender: 'global' });
    expect(lastReply(f.client)).toContain('Other');
    await f.receive('#config get bot.nickname', { sender: 'global', other: true });
    expect(lastReply(f.otherClient)).toContain('Before');
  } finally { await f.close(); }
});

it('does not register root commands merely because a child mounts the Command Feature', async () => {
  const f = await fixture({ commands: false });
  try {
    expect(f.runtime.snapshot.projections.has(commandFeatureId)).toBe(true);
    expect([...f.runtime.snapshot.capabilities.values()].some(slot => slot.owner === 'root' && slot.localName.startsWith('config'))).toBe(false);
  } finally { await f.close(); }
});

it('retains JSON text and types across the actual command parser and operation', async () => {
  const patches: unknown[] = [];
  const f = await fixture({ store: real => ({ readChat: (...args) => real.readChat(...args), patchChat: async request => {
    patches.push(request.patches[0]); return { status: 'saved', revision: request.expectedRevision, paths: [], restartRequired: false };
  } }) });
  try {
    const values = [{ text: 'line\n say "hi" \\ end', list: [false, 0, null] }, ['--help', true, { 'a.b': 'x/y' }], false, null, '  double  spaces  '];
    for (const value of values) await f.receive(`!!config set bot.nickname -- ${JSON.stringify(value)}`);
    expect(patches).toEqual(values.map(value => ({ op: 'set', path: ['bot', 'nickname'], value })));
  } finally { await f.close(); }
});

it('never reads or mutates sensitive or unknown fields, including parent replacement and deletion', async () => {
  const f = await fixture();
  try {
    const revision = (await f.realStore.readSource()).revision;
    for (const text of ['!!config get bot.token', '!!config delete bot', '!!config set bot -- {"nickname":"new"}',
      '!!config set bot.token -- "SHOULD_NOT_APPEAR"', '!!config get bot.absent']) {
      await f.receive(text);
      expect(lastReply(f.client)).not.toMatch(/DO_NOT_DISCLOSE|SHOULD_NOT_APPEAR/);
      expect(lastReply(f.client)).not.toContain('Configuration saved.');
    }
    expect((await f.realStore.readSource()).revision).toBe(revision);
  } finally { await f.close(); }
});

it('lists safe fields and exposes status without an independent whole-document apply command', async () => {
  const f = await fixture();
  try {
    await f.receive('!!config list bot');
    expect(lastReply(f.client)).toContain('nickname');
    expect(lastReply(f.client)).not.toMatch(/token|DO_NOT_DISCLOSE/);
    await f.receive('!!config schema bot.nickname');
    expect(lastReply(f.client)).toContain('string');
    await f.receive('!!config status');
    expect(lastReply(f.client)).toContain('matches the active configuration');
    expect(lastReply(f.client)).not.toContain('DO_NOT_DISCLOSE');
    const commands = f.runtime.snapshot.projections.get(commandFeatureId) as CommandIndex;
    expect(commands.list().some(command => command.name === 'config apply')).toBe(false);
  } finally { await f.close(); }
});

it('does not disclose raw service exceptions or conflict values', async () => {
  const f = await fixture({ store: real => ({ readChat: (...args) => real.readChat(...args),
    patchChat: vi.fn().mockRejectedValueOnce(new Error('DO_NOT_DISCLOSE')).mockResolvedValueOnce({ status: 'conflict',
      revision: 'conflict', current: [{ path: ['bot', 'nickname'], value: 'DO_NOT_DISCLOSE' }] }),
  }) });
  try {
    await f.receive('!!config set bot.nickname -- "safe"');
    expect(lastReply(f.client)).toContain('outcome is unconfirmed');
    expect(lastReply(f.client)).not.toContain('DO_NOT_DISCLOSE');
    await f.receive('!!config set bot.nickname -- "safe"');
    expect(lastReply(f.client)).toContain('not saved');
    expect(lastReply(f.client)).not.toContain('DO_NOT_DISCLOSE');
  } finally { await f.close(); }
});

it('does not convert reply delivery failure into a configuration failure or replay the write', async () => {
  const f = await fixture(); const patch = vi.spyOn(f.realStore, 'patchChat');
  try {
    f.client.sendNative.mockRejectedValueOnce(new Error('synthetic delivery failure'));
    const result = await f.receive('!!config set bot.nickname -- "Saved once"');
    expect(result).toMatchObject({ status: 'executed', value: expect.stringContaining('Configuration saved.') });
    await expect(f.client.sendNative.mock.results[0].value).rejects.toThrow('synthetic delivery failure');
    expect(patch).toHaveBeenCalledOnce();
    expect(f.client.sendNative).toHaveBeenCalledOnce();
    expect((await f.realStore.readChat(['bot', 'nickname'], 'get')).value).toBe('Saved once');
  } finally { await f.close(); }
});
