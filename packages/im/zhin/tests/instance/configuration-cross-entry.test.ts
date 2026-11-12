import { EventEmitter } from 'node:events';
import { withTestUsers } from './utils/console-users.js';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import adapterFeature, { Adapter, AdapterIndex, adapterFeatureId, createEndpointSpecification, defineAdapter, endpointSpec,
  type EndpointSendRequest } from '@zhin.js/adapter';
import commandFeature from '@zhin.js/command';
import type { ConsoleConfigApplyResult, ConsoleConfigPatchResult, ConsoleConfigSource } from '@zhin.js/console-protocol';
import { ImRuntime } from '@zhin.js/core/runtime';
import { createConsoleEventHub } from '@zhin.js/host-http';
import { createHttpHost } from '@zhin.js/host-http/node';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import { definePlugin, type RuntimeConfigDocument } from '@zhin.js/plugin-runtime';
import { createConfigDocument, RootRuntime, type ModuleRuntime } from '@zhin.js/runtime';
import { CONFIG_EXIT_CODES, createConfigCommand } from '../../../../../basic/cli/src/commands/config.js';
import { requestPluginConsole } from '../../../../../basic/cli/src/plugin-management/console-client.js';
import { ConsoleConfigurationStore } from '../../src/instance/console/module.js';
import { registerConsoleRpcRoute } from '../../src/instance/console/rpc-route.js';
import { installConfigurationHost } from '../../src/instance/configuration-host-installer.js';
import { createPluginLifecycleStore, resolvePluginLifecycleFile } from '@zhin.js/runtime';
import { createConfigurationChatAuthorizer, createSenderEnricher } from '@zhin.js/core/runtime';
import { chatRolesFromDocument } from './chat-role-fixture.js';

/**
 * #1139 P4: cross-entry regression. Console (`config:patch` over the real HTTP RPC route),
 * CLI (`zhin config` against the same Host, or `--offline` on the same file) and IM
 * (owner private chat through the real adapter → command dispatch) all share ONE
 * ConsoleConfigurationStore and ONE RootRuntime, mirroring how `zhin start` wires them.
 *
 * `--offline` normally validates by importing the project's declarations from disk; this
 * fixture's modules are in memory, so the offline store below keeps the shared
 * ConsoleConfigurationStore CAS/schema authority and only swaps declaration loading for the
 * same in-memory schemas. Offline composition itself is covered by config-offline.test.ts.
 */
const offline = vi.hoisted(() => ({ declarations: undefined as undefined | (() => ReadonlyMap<string, Readonly<Record<string, unknown>>>) }));
vi.mock('../../../../../basic/cli/src/utils/config-offline.js', async importOriginal => {
  const original = await importOriginal<typeof import('../../../../../basic/cli/src/utils/config-offline.js')>();
  return { ...original, createOfflineConfigurationStore: (root: string, environment: string) => new ConsoleConfigurationStore({
    projectRoot: root, document: createConfigDocument(original.requireConfigFile(root)), environmentName: environment,
    configDeclarations: () => offline.declarations!(),
  }) };
});

const token = 'synthetic-full-token';
const previousExitCode = process.exitCode;

class Client extends EventEmitter {
  readonly sendNative = vi.fn(async (_request: EndpointSendRequest) => 'sent');
  readonly [endpointSpec] = createEndpointSpecification(this, {
    start() {}, open() {}, close() {}, stop() {}, send: request => this.sendNative(request),
  });
}
class Platform extends Adapter<Client> { protected createEndpoint() { return new Client(); } }
class Modules implements ModuleRuntime {
  readonly values = new Map<string, unknown>();
  async load<T>(source: string): Promise<T> { if (!this.values.has(source)) throw new Error('Missing fixture module'); return this.values.get(source) as T; }
  invalidate() {} async close() {}
}
type Store = Pick<ConsoleConfigurationStore, 'readChat' | 'patchChat'>;

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  process.exitCode = previousExitCode;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch(() => {});
});

async function fixture(options: { store?: (real: ConsoleConfigurationStore) => Store } = {}) {
  const project = await realpath(await mkdtemp(join(tmpdir(), 'zhin-config-cross-entry-')));
  cleanups.push(() => rm(project, { recursive: true, force: true }));
  const modules = new Modules();
  const put = async (file: string, data: unknown) => { await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(data)); };
  const document: RuntimeConfigDocument = { configVersion: 2, locale: 'en', plugins: { bot: '@test/bot' },
    bot: { master: 'alice', commandPrefix: '!!', nickname: 'Before', token: 'DO_NOT_DISCLOSE', endpoints: [{ id: 'same' }] } };
  await put(join(project, 'package.json'), { name: '@test/root', dependencies: { '@test/command': 'workspace:*', '@test/bot': 'workspace:*' },
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: [{ package: '@test/command' }] } });
  await put(join(project, 'plugin.ts'), {});
  modules.values.set(join(project, 'plugin.ts'), { default: definePlugin({ name: 'root' }) });
  await put(join(project, 'plugins/bot/package.json'), { name: '@test/bot', dependencies: { '@test/adapter': 'workspace:*' },
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: [{ package: '@test/adapter' }] } });
  await put(join(project, 'plugins/bot/schema.json'), { type: 'object', additionalProperties: false, required: ['commandPrefix'], properties: {
    master: { type: 'string' }, commandPrefix: { type: 'string' }, nickname: { type: 'string' },
    token: { type: 'string', writeOnly: true }, endpoints: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } },
  } });
  await put(join(project, 'plugins/bot/plugin.ts'), {});
  modules.values.set(join(project, 'plugins/bot/plugin.ts'), { default: definePlugin({ name: 'bot', configUpdate: { featurePaths: [['nickname'], ['endpoints']] } }) });
  const source = join(project, 'plugins/bot/adapters/platform/index.ts'); await put(source, {});
  modules.values.set(source, { default: defineAdapter({ capabilities: ['inbound', 'outbound'], createAdapter: () => new Platform() }) });
  for (const [name, feature] of [['command', commandFeature], ['adapter', adapterFeature]] as const) {
    await put(join(project, `packages/${name}/package.json`), { name: `@test/${name}`, zhin: { protocol: 1, type: 'feature', entry: './index.ts' } });
    await put(join(project, `packages/${name}/index.ts`), {}); modules.values.set(join(project, `packages/${name}/index.ts`), { default: feature });
  }
  const file = join(project, 'zhin.config.json'); await put(file, document);
  const config = createConfigDocument(file);
  const roles = await chatRolesFromDocument(document);
  const im = new ImRuntime({ enrichSender: createSenderEnricher({ roles: () => roles }) });
  // One store for every entry, as in `zhin start`.
  const store = new ConsoleConfigurationStore({ projectRoot: project, document: config,
    configDeclarations: () => runtime.configurationSchemas,
    validateConfiguration: next => runtime.validateConfiguration(next),
    applyConfiguration: revision => runtime.applyConfiguration(revision), readApplication: () => runtime.configurationApplication });
  const chatStore = options.store?.(store) ?? store;
  // No config watcher: nothing applies a file change unless an entry asks for it.
  const runtime = new RootRuntime({ projectRoot: project, config, modules, environment: { name: 'test', mode: 'test', platform: 'node' },
    installResources(context) { im.install(context.resources); installConfigurationHost({ store: chatStore, authorize: createConfigurationChatAuthorizer(() => roles, () => runtime.snapshot) })(context); } });
  await runtime.start();
  cleanups.push(() => runtime.stop());
  im.attach(runtime.snapshots);
  offline.declarations = () => runtime.configurationSchemas;

  const http = withTestUsers(createHttpHost({ host: '127.0.0.1', port: 0 }), { [token]: 'owner' });
  registerConsoleRpcRoute({ http, base: '/api', projectRoot: project, consoleRuntime: { runView: async () => ({ pages: [] }) } as unknown as ConsoleRuntime,
    hub: createConsoleEventHub(), pluginLifecycleFile: resolvePluginLifecycleFile(project), pluginLifecycleStore: createPluginLifecycleStore(project),
    configuration: store } as Parameters<typeof registerConsoleRpcRoute>[0]);
  const host = `http://127.0.0.1:${(await http.listen()).port}`;
  cleanups.push(() => http.close());
  vi.stubEnv('ZHIN_CONSOLE_TOKEN', token);
  vi.spyOn(process, 'cwd').mockReturnValue(project);
  const stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
  const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});

  const index = runtime.snapshot.projections.get(adapterFeatureId) as AdapterIndex;
  const row = index.list().find(item => item.owner === 'root/bot')!;
  const client = index.clientById<Client>(row.id)!;
  /** Owner private chat on the real adapter → command dispatch → store → Root apply → outbound reply. */
  const chat = async (text: string): Promise<string> => {
    const sent = client.sendNative.mock.calls.length;
    await client[endpointSpec].events.message({ conversation: { endpoint: { id: row.id, adapter: 'platform' }, kind: 'private', id: 'conversation' },
      content: text, sender: { id: 'alice' } });
    expect(client.sendNative.mock.calls.length).toBe(sent + 1);
    return String(client.sendNative.mock.calls.at(-1)?.[0].payload);
  };
  /** The Console page's control-plane calls over the same HTTP route the browser uses. */
  const consoleRpc = <T>(request: Record<string, unknown>) => requestPluginConsole<T>(host, request);
  /** `zhin config …` against the running Host (or `--offline`). Returns the exit code and its single JSON line. */
  const cli = async (args: readonly string[], mode: { offline?: boolean; json?: boolean } = {}) => {
    const printed = stdout.mock.calls.length; const errors = stderr.mock.calls.length;
    process.exitCode = undefined;
    await createConfigCommand().parseAsync(['node', 'zhin', ...(mode.json === false ? [] : ['--json']),
      ...(mode.offline ? ['--offline'] : ['--host', host]), ...args]);
    const lines = stdout.mock.calls.slice(printed).map(call => String(call[0]));
    const parsed = mode.json === false ? undefined : JSON.parse(lines.at(-1)!) as Record<string, unknown>;
    return { code: (process.exitCode ?? 0) as number, data: parsed, stdout: lines, stderr: stderr.mock.calls.slice(errors).map(call => String(call[0])) };
  };
  /** What the running Runtime actually uses (effective), as opposed to the file (desired). */
  const effectiveNickname = () => (runtime.snapshot.projections.get(adapterFeatureId) as AdapterIndex).profile(row.id)!.peek().values.nickname;
  const fileNickname = async () => (JSON.parse(await readFile(file, 'utf8')) as { bot: { nickname?: unknown } }).bot.nickname;
  return { project, runtime, store, document: config, host, chat, consoleRpc, cli, effectiveNickname, fileNickname };
}

type Entry = 'console' | 'cli' | 'im';

describe('three-way CAS: Console + CLI + IM interleave on the same leaf (#1139 P4)', () => {
  it.each<{ order: Entry[] }>([{ order: ['console', 'cli', 'im'] }, { order: ['cli', 'im', 'console'] }, { order: ['im', 'console', 'cli'] }])(
    'all read one revision, then commit in order $order: exactly one wins, the others conflict, nothing is silently overwritten', async ({ order }) => {
      const gates = Object.fromEntries((['console', 'cli', 'im'] as const).map(name => [name, {
        arrived: Promise.withResolvers<void>(), release: Promise.withResolvers<void>(), done: Promise.withResolvers<void>() }])) as
        Record<Entry, Record<'arrived' | 'release' | 'done', PromiseWithResolvers<void>>>;
      const hold = async <T>(name: Entry, write: () => Promise<T>): Promise<T> => {
        gates[name].arrived.resolve();
        await gates[name].release.promise;
        try { return await write(); } finally { gates[name].done.resolve(); }
      };
      const f = await fixture({ store: real => ({ readChat: (...args) => real.readChat(...args),
        patchChat: request => hold('im', () => real.patchChat(request)) }) });
      const realFetch = globalThis.fetch;
      const writes: string[] = [];
      vi.stubGlobal('fetch', vi.fn(async (url: URL, init?: RequestInit) => {
        const type = (JSON.parse(String(init?.body)) as { type?: string }).type;
        if (type === 'config:patch-project') { writes.push(type); return hold('cli', () => realFetch(url, init)); }
        if (type === 'config:patch') { writes.push(type); return hold('console', () => realFetch(url, init)); }
        return realFetch(url, init);
      }));
      const prepare = vi.spyOn(f.document, 'prepare');
      const apply = vi.spyOn(f.runtime, 'applyConfiguration');
      const base = await f.consoleRpc<ConsoleConfigSource>({ type: 'config:get-source' });

      const values: Record<Entry, string> = { console: 'From Console', cli: 'From CLI', im: 'From IM' };
      const results = {
        console: f.consoleRpc<ConsoleConfigPatchResult>({ type: 'config:patch', instanceKey: 'bot', expectedRevision: base.revision,
          patches: [{ op: 'set', path: ['bot', 'nickname'], value: values.console }] }),
        cli: f.cli(['set', 'bot.nickname', values.cli]),
        im: f.chat(`!!config set bot.nickname -- ${JSON.stringify(values.im)}`),
      };
      // Every entry has read its CAS base and is about to write; nothing has been written yet.
      await Promise.all(Object.values(gates).map(gate => gate.arrived.promise));
      expect((await f.document.read()).revision).toBe(base.revision);
      for (const name of order) { gates[name].release.resolve(); await gates[name].done.promise; }
      const [consoleResult, cliResult, imReply] = await Promise.all([results.console, results.cli, results.im]);
      const [winner, ...losers] = order;

      const saved: Record<Entry, boolean> = { console: consoleResult.status === 'saved', cli: cliResult.data!.status === 'saved', im: imReply.startsWith('Configuration saved.') };
      expect(saved).toEqual({ console: winner === 'console', cli: winner === 'cli', im: winner === 'im' });
      for (const loser of losers) {
        if (loser === 'console') expect(consoleResult).toMatchObject({ status: 'conflict', current: [{ path: ['bot', 'nickname'], value: values[winner!] }] });
        if (loser === 'cli') expect(cliResult).toMatchObject({ code: CONFIG_EXIT_CODES.conflict, data: { status: 'conflict', current: [{ path: ['bot', 'nickname'], value: values[winner!] }] } });
        // IM never echoes values on conflict.
        if (loser === 'im') expect(imReply).toBe('Another operation changed the configuration. This change was not saved; read it again.');
      }
      if (winner === 'cli') expect(cliResult.code).toBe(CONFIG_EXIT_CODES.ok);
      // One commit, one Root application, one write request per HTTP entry; the winner is both desired and effective.
      expect(prepare).toHaveBeenCalledOnce();
      expect(apply).toHaveBeenCalledOnce();
      expect(writes.sort()).toEqual(['config:patch', 'config:patch-project']);
      expect(await f.fileNickname()).toBe(values[winner!]);
      expect(f.effectiveNickname()).toBe(values[winner!]);
      const after = await f.consoleRpc<ConsoleConfigSource>({ type: 'config:get-source' });
      expect(after.application?.sourceRevision).toBe(after.revision);
      expect(JSON.stringify([consoleResult, cliResult, imReply])).not.toContain('DO_NOT_DISCLOSE');
    });
});

describe('offline save while the Host runs without watch (#1139 P4)', () => {
  it('CLI --offline saves desired only → Console shows desired≠effective → Console apply → effective and IM get agree', async () => {
    const f = await fixture();
    // Establish an applied baseline through the Host so `application` evidence exists.
    expect(await f.chat('!!config set bot.nickname -- "Baseline"')).toContain('Configuration saved.');
    const baseline = await f.consoleRpc<ConsoleConfigSource>({ type: 'config:get-source' });
    expect(baseline.application?.sourceRevision).toBe(baseline.revision);
    const generation = f.runtime.snapshot.generation;
    const apply = vi.spyOn(f.runtime, 'applyConfiguration');
    const fetch = vi.spyOn(globalThis, 'fetch');

    const saved = await f.cli(['set', 'bot.nickname', 'Offline value'], { offline: true });
    expect(saved).toMatchObject({ code: CONFIG_EXIT_CODES.ok, data: { status: 'saved', application: 'not-requested', paths: [['bot', 'nickname']] } });
    expect(fetch).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    await new Promise(resolve => setTimeout(resolve, 50));

    // Desired (file) moved; effective (Runtime) did not: Console sees the gap from the same read.
    const pending = await f.consoleRpc<ConsoleConfigSource>({ type: 'config:get-source' });
    expect(pending.revision).not.toBe(baseline.revision);
    expect(pending.application?.sourceRevision).toBe(baseline.revision);
    expect(pending.application?.sourceRevision).not.toBe(pending.revision);
    expect(pending.applicationError).toBeUndefined();
    expect(await f.fileNickname()).toBe('Offline value');
    expect(f.effectiveNickname()).toBe('Baseline');
    expect(f.runtime.snapshot.generation).toBe(generation);

    const applied = await f.consoleRpc<ConsoleConfigApplyResult>({ type: 'config:apply', expectedRevision: pending.revision });
    expect(applied).toMatchObject({ status: 'applied', application: { sourceRevision: pending.revision } });
    expect(apply).toHaveBeenCalledOnce();
    expect(f.effectiveNickname()).toBe('Offline value');
    expect(f.runtime.snapshot.generation).toBeGreaterThan(generation);
    const settled = await f.consoleRpc<ConsoleConfigSource>({ type: 'config:get-source' });
    expect(settled.application?.sourceRevision).toBe(settled.revision);
    expect(await f.chat('!!config get bot.nickname')).toBe('Safe configuration read.\n"Offline value"');
    expect(await f.cli(['get', 'bot.nickname'])).toMatchObject({ code: CONFIG_EXIT_CODES.ok, data: 'Offline value' });
  });

  it('a stale Console apply after another offline save is a conflict, not an application of the wrong revision', async () => {
    const f = await fixture();
    const first = await f.cli(['set', 'bot.nickname', 'Offline one'], { offline: true });
    expect(first.code).toBe(CONFIG_EXIT_CODES.ok);
    const seen = await f.consoleRpc<ConsoleConfigSource>({ type: 'config:get-source' });
    expect((await f.cli(['set', 'bot.nickname', 'Offline two'], { offline: true })).code).toBe(CONFIG_EXIT_CODES.ok);
    const apply = vi.spyOn(f.runtime, 'applyConfiguration');
    expect(await f.consoleRpc<ConsoleConfigApplyResult>({ type: 'config:apply', expectedRevision: seen.revision })).toMatchObject({ status: 'conflict' });
    expect(apply).not.toHaveBeenCalled();
    expect(f.effectiveNickname()).toBe('Before');
  });
});

describe('unknown consistency across entries when Root apply throws mid-way (#1139 P4)', () => {
  it.each([
    { when: 'before publishing a generation', publish: false, json: true },
    { when: 'before publishing a generation', publish: false, json: false },
    { when: 'after publishing a generation (acknowledgement lost)', publish: true, json: true },
    { when: 'after publishing a generation (acknowledgement lost)', publish: true, json: false },
  ])('saved + unconfirmed everywhere, with evidence and no automatic replay ($when, json=$json)', async ({ publish, json }) => {
    const f = await fixture();
    // Fake only setTimeout so a delayed automatic retry cannot slip past the replay checks below.
    vi.useFakeTimers({ toFake: ['setTimeout'], shouldAdvanceTime: true });
    const realApply = f.runtime.applyConfiguration.bind(f.runtime);
    const apply = vi.spyOn(f.runtime, 'applyConfiguration').mockImplementation(async revision => {
      if (publish) await realApply(revision);
      throw new Error('DO_NOT_DISCLOSE synthetic apply failure');
    });
    const prepare = vi.spyOn(f.document, 'prepare');
    const patchChat = vi.spyOn(f.store, 'patchChat');
    const realFetch = globalThis.fetch;
    const writes: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init?: RequestInit) => {
      const type = (JSON.parse(String(init?.body)) as { type?: string }).type!;
      if (type.startsWith('config:patch') || type === 'config:apply') writes.push(type);
      return realFetch(url, init);
    }));

    // CLI: exit 6 carrying requestId + expectedRevision.
    const before = await f.document.read();
    const cliResult = await f.cli(['set', 'bot.nickname', 'From CLI'], { json });
    expect(cliResult.code).toBe(CONFIG_EXIT_CODES.unknown);
    if (json) {
      expect(cliResult.data).toMatchObject({ status: 'saved', applicationError: 'unconfirmed', requestId: expect.any(String), expectedRevision: before.revision });
    } else {
      expect(cliResult.stdout.join('\n')).toContain('生效结果未知');
      expect(cliResult.stderr.join('\n')).toMatch(new RegExp(`requestId=\\S+ expectedRevision=${before.revision}`, 'u'));
    }
    expect(JSON.stringify(cliResult)).not.toContain('DO_NOT_DISCLOSE');
    expect(writes).toEqual(['config:patch-project']);
    expect(apply).toHaveBeenCalledTimes(1);

    // Console: the same Host now reports the unconfirmed application.
    const afterCli = await f.consoleRpc<ConsoleConfigSource>({ type: 'config:get-source' });
    expect(afterCli).toMatchObject({ applicationError: 'unconfirmed' });
    expect(afterCli.revision).not.toBe(before.revision);

    // IM: saved + unconfirmed copy; no value or exception leaks.
    const imReply = await f.chat('!!config set bot.nickname -- "From IM"');
    expect(imReply).toBe('Configuration saved. The configuration outcome is unconfirmed. Do not resend; check the current value read-only first. No automatic retry is made.');
    expect(patchChat).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledTimes(2);

    // Console write: same classification on the receipt.
    const consoleRevision = (await f.consoleRpc<ConsoleConfigSource>({ type: 'config:get-source' })).revision;
    const consoleResult = await f.consoleRpc<ConsoleConfigPatchResult>({ type: 'config:patch', instanceKey: 'bot', expectedRevision: consoleRevision,
      patches: [{ op: 'set', path: ['bot', 'nickname'], value: 'From Console' }] });
    expect(consoleResult).toMatchObject({ status: 'saved', applicationError: 'unconfirmed' });
    expect(JSON.stringify(consoleResult)).not.toContain('DO_NOT_DISCLOSE');
    expect(await f.consoleRpc<ConsoleConfigSource>({ type: 'config:get-source' })).toMatchObject({ applicationError: 'unconfirmed' });

    // No entry replays anything on its own: one commit and one apply per user action,
    // even after every pending timer (any delayed retry) has run.
    await vi.runAllTimersAsync();
    expect(prepare).toHaveBeenCalledTimes(3);
    expect(apply).toHaveBeenCalledTimes(3);
    expect(patchChat).toHaveBeenCalledOnce();
    expect(writes).toEqual(['config:patch-project', 'config:patch']);
    expect(await f.fileNickname()).toBe('From Console');

    // Recovery is explicit: a Console apply of the verified revision clears the unknown state.
    apply.mockImplementation(realApply);
    const current = await f.consoleRpc<ConsoleConfigSource>({ type: 'config:get-source' });
    expect(await f.consoleRpc<ConsoleConfigApplyResult>({ type: 'config:apply', expectedRevision: current.revision })).toMatchObject({ status: 'applied' });
    const recovered = await f.consoleRpc<ConsoleConfigSource>({ type: 'config:get-source' });
    expect(recovered.applicationError).toBeUndefined();
    expect(recovered.application?.sourceRevision).toBe(recovered.revision);
    expect(f.effectiveNickname()).toBe('From Console');
  });

  it.each([
    { when: 'before publishing a generation', publish: false },
    { when: 'after publishing a generation (acknowledgement lost)', publish: true },
  ])('an explicit Console apply that throws is unconfirmed and is not retried ($when)', async ({ publish }) => {
    const f = await fixture();
    const saved = await f.cli(['set', 'bot.nickname', 'Offline value'], { offline: true });
    expect(saved.code).toBe(CONFIG_EXIT_CODES.ok);
    const pending = await f.consoleRpc<ConsoleConfigSource>({ type: 'config:get-source' });
    vi.useFakeTimers({ toFake: ['setTimeout'], shouldAdvanceTime: true });
    const realApply = f.runtime.applyConfiguration.bind(f.runtime);
    const apply = vi.spyOn(f.runtime, 'applyConfiguration').mockImplementation(async revision => {
      if (publish) await realApply(revision);
      throw new Error('DO_NOT_DISCLOSE synthetic apply failure');
    });
    const prepare = vi.spyOn(f.document, 'prepare');

    const applied = await f.consoleRpc<ConsoleConfigApplyResult>({ type: 'config:apply', expectedRevision: pending.revision });
    expect(applied).toMatchObject({ status: 'unconfirmed' });
    expect(JSON.stringify(applied)).not.toContain('DO_NOT_DISCLOSE');
    const afterApply = await f.consoleRpc<ConsoleConfigSource>({ type: 'config:get-source' });
    expect(afterApply).toMatchObject({ applicationError: 'unconfirmed', revision: pending.revision });

    // Nothing replays the apply on its own, even after every pending timer has run; applying never commits.
    await vi.runAllTimersAsync();
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith(pending.revision);
    expect(prepare).not.toHaveBeenCalled();
    expect(await f.fileNickname()).toBe('Offline value');
    expect(f.effectiveNickname()).toBe(publish ? 'Offline value' : 'Before');
  });
});
