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
async function fixture(options: { locale?: 'zh-CN' | 'en'; commands?: boolean; globalMasters?: readonly string[]; secondEndpoint?: boolean; store?: (real: ConsoleConfigurationStore) => Store } = {}) {
  const project = await realpath(await mkdtemp(join(tmpdir(), 'zhin-config-chat-')));
  const modules = new Modules();
  const setups = { root: 0 };
  const put = async (file: string, data: unknown) => { await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(data)); };
  const document: RuntimeConfigDocument = { configVersion: 2, locale: options.locale ?? 'en',
    ...(options.globalMasters ? { ai: { trigger: { masters: options.globalMasters } } } : {}),
    plugins: { bot: '@test/bot', other: '@test/bot' },
    bot: { master: 'alice', commandPrefix: '!!', nickname: 'Before', count: 1, tags: ['a'], token: 'DO_NOT_DISCLOSE',
      endpoints: [{ id: 'same' }, ...(options.secondEndpoint ? [{ id: 'second', master: 'carol' }] : [])] },
    other: { master: 'bob', commandPrefix: '#', nickname: 'Other', endpoints: [{ id: 'same' }] } };
  await put(join(project, 'package.json'), { name: '@test/root', dependencies: { '@test/command': 'workspace:*', '@test/bot': 'workspace:*' },
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: options.commands === false ? [] : [{ package: '@test/command' }] } });
  await put(join(project, 'plugin.ts'), {});
  modules.values.set(join(project, 'plugin.ts'), { default: definePlugin({ name: 'root', setup() { setups.root++; } }) });
  await put(join(project, 'plugins/bot/package.json'), { name: '@test/bot', dependencies: { '@test/adapter': 'workspace:*', '@test/command': 'workspace:*' },
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: [{ package: '@test/adapter' }, ...(options.commands === false ? [{ package: '@test/command' }] : [])] } });
  await put(join(project, 'plugins/bot/schema.json'), { type: 'object', additionalProperties: false, required: ['commandPrefix'], properties: {
    master: { type: 'string' }, commandPrefix: { type: 'string' }, nickname: { type: 'string' }, count: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } },
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
  const endpointOf = (owner: string, endpointId: string) => rows.find(item => item.owner === owner
    && index.adapterForEndpoint(item.id)?.find(item.id)?.desired.endpointId === endpointId);
  const row = endpointOf('root/bot', 'same')!;
  const second = options.secondEndpoint ? endpointOf('root/bot', 'second')! : undefined;
  const other = rows.find(item => item.owner === 'root/other')!;
  const client = index.clientById<Client>(row.id), otherClient = index.clientById<Client>(other.id);
  const secondClient = second ? index.clientById<Client>(second.id) : undefined;
  const receive = async (text: string, input: { sender?: string; kind?: 'private' | 'group' | 'channel'; other?: boolean; second?: boolean; metadata?: Record<string, unknown> } = {}) => {
    const selected = input.other ? other : input.second ? second! : row;
    const endpoint = input.other ? otherClient : input.second ? secondClient! : client;
    return endpoint[endpointSpec].events.message({ conversation: { endpoint: { id: selected.id, adapter: 'platform' }, kind: input.kind ?? 'private', id: 'conversation' },
      content: text, sender: { id: input.sender ?? 'alice' }, metadata: input.metadata });
  };
  return { project, runtime, realStore, store, document: config, client, otherClient, secondClient, index, row, receive, setups,
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

it('limits Host chat writes to HOST_CONFIG_PATCH_PATHS through the real message chain (C3)', async () => {
  const f = await fixture({ locale: 'en' });
  const patch = vi.spyOn(f.realStore, 'patchChat');
  try {
    const before = await f.document.readSource();
    for (const text of ['!!config set locale -- "zh-CN"', '!!config set http.port -- 1', '!!config get locale', '!!config set ai.trigger.enabled -- false']) {
      await f.receive(text);
      expect(lastReply(f.client)).toBe('This configuration is outside the chat-manageable scope. Use the local CLI.');
    }
    expect(patch).not.toHaveBeenCalled();
    expect(await f.document.readSource()).toEqual(before);
    await f.receive('!!config set ai.trigger.ambient.mode -- shadow');
    expect(lastReply(f.client)).toContain('Configuration saved.');
    expect((await f.document.readSource()).document).toMatchObject({ ai: { trigger: { ambient: { mode: 'shadow' } } } });
    await f.receive('!!config get ai.trigger.ambient.mode');
    expect(lastReply(f.client)).toContain('"shadow"');
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
    await expect(commands.execute('config fields')).rejects.toThrow('Permission denied');
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
    expect(lastReply(f.client)).toMatch(/!!config fields\n!!config get\n!!config set\n!!config unset/u);
    await f.receive('!!config set bot.count -- not-a-number');
    expect(lastReply(f.client)).toBe('配置值与字段类型不符，期望：integer');
    await f.receive('!!配置 get bot.nickname');
    expect(lastReply(f.client)).toContain('Before');
    await f.receive('!!配置');
    expect(lastReply(f.client)).toContain('!!config fields');
    await f.receive('#config', { sender: 'bob', other: true });
    expect(lastReply(f.otherClient)).toContain('#config get');
  } finally { await f.close(); }
});

it('does not accept ai.trigger.masters as chat configuration authority in v1 (C2)', async () => {
  const f = await fixture({ globalMasters: ['global'] });
  const read = vi.spyOn(f.realStore, 'readChat');
  try {
    await f.receive('!!config get other.nickname', { sender: 'global' });
    expect(lastReply(f.client)).toBe('Configuration management requires a real Bot owner in a private chat.');
    await f.receive('#config get bot.nickname', { sender: 'global', other: true });
    expect(lastReply(f.otherClient)).toBe('Configuration management requires a real Bot owner in a private chat.');
    expect(read).not.toHaveBeenCalled();
    await f.receive('!!config get other.nickname', { sender: 'alice' });
    expect(lastReply(f.client)).toContain('Other');
  } finally { await f.close(); }
});

it('accepts the master of any configured endpoint on the same Adapter in private chat (C2 widen)', async () => {
  const f = await fixture({ secondEndpoint: true });
  const read = vi.spyOn(f.realStore, 'readChat');
  try {
    // carol is the leaf master of bot/second only; she may manage via bot/same.
    await f.receive('!!config get bot.nickname', { sender: 'carol' });
    expect(lastReply(f.client)).toContain('Before');
    // alice is bot/same's inherited Plugin-level master; she may manage via bot/second.
    await f.receive('!!config get bot.nickname', { sender: 'alice', second: true });
    expect(lastReply(f.secondClient!)).toContain('Before');
    expect(read).toHaveBeenCalledTimes(2);
    // Still private chat only, even for a same-Adapter master.
    await f.receive('!!config get bot.nickname', { sender: 'carol', kind: 'group' });
    expect(lastReply(f.client)).not.toContain('Before');
    expect(read).toHaveBeenCalledTimes(2);
  } finally { await f.close(); }
});

it('denies masters of a different Adapter and ai.trigger.masters even with several endpoints (C2 widen)', async () => {
  const f = await fixture({ secondEndpoint: true, globalMasters: ['global'] });
  const read = vi.spyOn(f.realStore, 'readChat');
  try {
    const denied = 'Configuration management requires a real Bot owner in a private chat.';
    // Cross-Adapter: bot's masters (base and leaf) on other's endpoint, and other's master on bot's endpoints.
    for (const sender of ['alice', 'carol']) {
      await f.receive('#config get other.nickname', { sender, other: true });
      expect(lastReply(f.otherClient)).toBe(denied);
    }
    await f.receive('!!config get bot.nickname', { sender: 'bob' });
    expect(lastReply(f.client)).toBe(denied);
    await f.receive('!!config get bot.nickname', { sender: 'bob', second: true });
    expect(lastReply(f.secondClient!)).toBe(denied);
    // Global masters are never consulted.
    await f.receive('!!config get bot.nickname', { sender: 'global' });
    expect(lastReply(f.client)).toBe(denied);
    await f.receive('!!config get bot.nickname', { sender: 'global', second: true });
    expect(lastReply(f.secondClient!)).toBe(denied);
    expect(read).not.toHaveBeenCalled();
  } finally { await f.close(); }
});

it('does not register root commands merely because a child mounts the Command Feature', async () => {
  const f = await fixture({ commands: false });
  try {
    expect(f.runtime.snapshot.projections.has(commandFeatureId)).toBe(true);
    expect([...f.runtime.snapshot.capabilities.values()].some(slot => slot.owner === 'root' && slot.localName.startsWith('config'))).toBe(false);
  } finally { await f.close(); }
});

it('parses values by leaf type across the actual command parser and never accepts objects', async () => {
  const patches: unknown[] = [];
  const f = await fixture({ store: real => ({ readChat: (...args) => real.readChat(...args), patchChat: async request => {
    patches.push(request.patches[0]); return { status: 'saved', revision: request.expectedRevision, paths: [], restartRequired: false };
  } }) });
  try {
    const cases: [string, string, unknown][] = [
      ['nickname', JSON.stringify('line\n say "hi" \\ end'), 'line\n say "hi" \\ end'],
      ['nickname', 'plain words', 'plain words'], ['nickname', '123', '123'], ['nickname', '{"a":1}', '{"a":1}'],
      ['count', '5', 5], ['tags', '["x","y"]', ['x', 'y']],
    ];
    for (const [key, text] of cases) await f.receive(`!!config set bot.${key} -- ${text}`);
    expect(patches).toEqual(cases.map(([key, , value]) => ({ op: 'set', path: ['bot', key], value })));
    for (const text of ['!!config set bot.count -- 1.5', '!!config set bot.count -- {"n":1}', '!!config set bot.tags -- {"a":1}']) {
      await f.receive(text);
      expect(lastReply(f.client)).toContain('does not match the field type');
    }
    expect(patches).toHaveLength(cases.length);
  } finally { await f.close(); }
});

it('never reads or mutates sensitive or unknown fields, including parent replacement and deletion', async () => {
  const f = await fixture();
  try {
    const revision = (await f.realStore.readSource()).revision;
    for (const text of ['!!config get bot.token', '!!config unset bot', '!!config set bot -- {"nickname":"new"}',
      '!!config set bot.token -- "SHOULD_NOT_APPEAR"', '!!config get bot.absent', '!!config get bot.master', '!!config set bot.master -- mallory',
      '!!config unset bot.master', '!!config set bot.endpoints.0.master -- mallory', '!!config get bot', '!!config unset bot.commandPrefix',
      '!!config set plugins.bot -- "@test/other"']) {
      await f.receive(text);
      expect(lastReply(f.client)).not.toMatch(/DO_NOT_DISCLOSE|SHOULD_NOT_APPEAR/);
      expect(lastReply(f.client)).not.toContain('Configuration saved.');
    }
    expect((await f.realStore.readSource()).revision).toBe(revision);
  } finally { await f.close(); }
});

it('lists only manageable leaves and types and registers exactly fields/get/set/unset (C1)', async () => {
  const f = await fixture();
  try {
    await f.receive('!!config fields bot');
    const listed = lastReply(f.client);
    expect(listed).toContain('bot.nickname: string');
    expect(listed).toContain('bot.count: integer');
    expect(listed).not.toMatch(/token|master|endpoints|DO_NOT_DISCLOSE|Before/);
    await f.receive('!!config fields');
    expect(lastReply(f.client)).toContain('ai.trigger.ambient.mode: string');
    expect(lastReply(f.client)).not.toMatch(/^locale|^http|DO_NOT_DISCLOSE/mu);
    await f.receive('!!config fields locale');
    expect(lastReply(f.client)).toBe('This configuration is outside the chat-manageable scope. Use the local CLI.');
    const commands = f.runtime.snapshot.projections.get(commandFeatureId) as CommandIndex;
    const names = commands.list().map(command => command.name).filter(name => name.startsWith('config'));
    expect(names.sort()).toEqual(['config', 'config fields', 'config get', 'config set', 'config unset']);
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

it.each([
  { locale: 'en' as const, action: 'set' }, { locale: 'zh-CN' as const, action: 'set' },
  { locale: 'en' as const, action: 'unset' }, { locale: 'zh-CN' as const, action: 'unset' },
])('reports a definite prepare rejection as not saved through the real SDK/store boundary ($locale/$action)', async ({ locale, action }) => {
  const f = await fixture({ locale });
  const prepare = vi.spyOn(f.document, 'prepare').mockRejectedValueOnce(new Error('DO_NOT_DISCLOSE_prepare_detail'));
  const apply = vi.spyOn(f.runtime, 'applyConfiguration');
  try {
    const before = await f.document.readSource();
    const generation = f.runtime.snapshot.generation;
    await f.receive(action === 'set' ? '!!config set bot.nickname -- "Not saved"' : '!!config unset bot.count');
    expect(lastReply(f.client)).toContain(locale === 'en' ? 'not saved' : '未保存');
    expect(lastReply(f.client)).not.toMatch(/unconfirmed|未确认|DO_NOT_DISCLOSE/);
    expect(prepare).toHaveBeenCalledOnce();
    expect(apply).not.toHaveBeenCalled();
    expect(await f.document.readSource()).toEqual(before);
    expect(f.runtime.snapshot.generation).toBe(generation);
    expect(f.client.sendNative).toHaveBeenCalledOnce();
  } finally { prepare.mockRestore(); apply.mockRestore(); await f.close(); }
});

it.each(['en', 'zh-CN'] as const)('keeps a genuinely lost commit acknowledgement unconfirmed without retry, rollback or apply (%s)', async locale => {
  const f = await fixture({ locale });
  const realPrepare = f.document.prepare.bind(f.document);
  const commit = vi.fn();
  const rollback = vi.fn();
  const prepare = vi.spyOn(f.document, 'prepare').mockImplementationOnce(async (...args) => {
    const prepared = await realPrepare(...args);
    commit.mockImplementation(async () => { await prepared.commit(); throw new Error('DO_NOT_DISCLOSE_lost_ack'); });
    rollback.mockImplementation(() => prepared.rollback());
    return { ...prepared, commit, rollback };
  });
  const apply = vi.spyOn(f.runtime, 'applyConfiguration');
  try {
    const before = await f.document.readSource();
    await f.receive('!!config set bot.nickname -- "Persisted without acknowledgement"');
    expect(lastReply(f.client)).toContain(locale === 'en' ? 'unconfirmed' : '未确认');
    expect(lastReply(f.client)).not.toMatch(/not saved|未保存|DO_NOT_DISCLOSE/);
    expect(prepare).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
    expect(rollback).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    const saved = await f.document.readSource();
    expect(saved.revision).not.toBe(before.revision);
    expect(saved.document.bot).toMatchObject({ nickname: 'Persisted without acknowledgement' });
    expect(f.client.sendNative).toHaveBeenCalledOnce();
  } finally { prepare.mockRestore(); apply.mockRestore(); await f.close(); }
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
