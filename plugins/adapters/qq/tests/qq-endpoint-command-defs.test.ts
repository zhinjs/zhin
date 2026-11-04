import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adapterFeatureId } from 'zhin.js/adapter';
import { CommandIndex, commandFeatureId, parseCommandDefinition } from 'zhin.js/command';
import { createCapabilitySlot, createSnapshotView, rootPluginId } from 'zhin.js/plugin-runtime';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import { MemoryDesiredRepository } from '../../test-utils/desired-repository.js';
import definition from '../adapters/qq/index.js';
import listCommand from '../commands/qq/endpoint/list/index.js';
import addCommand from '../commands/qq/endpoint/add/[[id]]/index.js';
import cancelCommand from '../commands/qq/endpoint/cancel/index.js';
import removeCommand from '../commands/qq/endpoint/remove/[id]/index.js';
import { createQqRuntimeState, qqRuntimeStateToken } from '../src/qq-runtime-state.js';
import type { QqBindCallbacks } from '../src/qq-bind-flow.js';
import { completeQqPendingBotKind } from '../commands/qq/endpoint/definition.js';

const { startFlow } = vi.hoisted(() => ({ startFlow: vi.fn() }));
vi.mock('../src/qq-bind-flow.js', () => ({ startQqBindFlow: startFlow }));
const fixtures: Awaited<ReturnType<typeof createAdapterHarness>>[] = [];
beforeEach(() => { startFlow.mockReset(); startFlow.mockImplementation((callbacks: QqBindCallbacks) => { queueMicrotask(() => callbacks.onQrDisplayed?.('https://example.test/synthetic-qr')); return vi.fn(); }); });
afterEach(async () => { for (const f of fixtures.splice(0)) await f.stop(); });
async function fixture(config: Record<string, unknown> = {}) {
  const owner = rootPluginId(), state = createQqRuntimeState(), repository = new MemoryDesiredRepository();
  const runtime = await createAdapterHarness(definition, { id: 'deferred', appid: 'synthetic-placeholder', secret: 'synthetic-placeholder' }, { name: 'qq', repository, resources: new Map([[qqRuntimeStateToken.id, state]]) });
  fixtures.push(runtime); await runtime.start(); runtime.open();
  const slots = [
    createCapabilitySlot({ owner, feature: commandFeatureId, localName: 'qq/endpoint/list', source: '/commands/qq/endpoint/list/index.ts', definition: listCommand }),
    createCapabilitySlot({ owner, feature: commandFeatureId, localName: 'qq/endpoint/cancel', source: '/commands/qq/endpoint/cancel/index.ts', definition: cancelCommand }),
    createCapabilitySlot({ owner, feature: commandFeatureId, localName: 'qq/endpoint/add/$id', source: '/commands/qq/endpoint/add/[[id]]/index.ts', definition: { ...addCommand, $parameter: { name: 'id', type: 'string', optional: true } as const } }),
    createCapabilitySlot({ owner, feature: commandFeatureId, localName: 'qq/endpoint/remove/$id', source: '/commands/qq/endpoint/remove/[id]/index.ts', definition: { ...removeCommand, $parameter: { name: 'id', type: 'string' } as const } }),
  ];
  const snapshot = createSnapshotView(1, { root: owner, tree: new Map([[owner, { id: owner, instanceKey: 'root', packageName: '@test/qq', packageRoot: '/project', children: [] }]]),
    config: new Map([[owner, { commandNamespace: 'account', ...config }]]), resources: new Map([[owner, new Map([[qqRuntimeStateToken.id, state]])]]), capabilities: new Map(slots.map(slot => [slot.id, slot])), projections: new Map([[adapterFeatureId, runtime.index]]) });
  const commands = new CommandIndex(slots, snapshot), knownCommand = (path: string) => commands.formatCommand(owner, path, '!', 'zh-CN');
  const use = vi.fn((token: unknown) => { if (token === qqRuntimeStateToken) return state; throw new Error('No file/env writer is available'); });
  const context = (knownEnvironment = true, overrides: Record<string, unknown> = {}) => ({ owner: { id: owner }, generation: 1, config, locale: 'zh-CN', project: () => runtime.index,
    formatCommand: knownEnvironment ? knownCommand : () => undefined, use, params: {}, args: [], input: undefined, ...overrides }) as never;
  return { runtime, repository, state, commands, knownCommand, context, use };
}

describe('QQ actual convention command definitions and runtime authority', () => {
  it('retains all four valid modules', () => { for (const command of [listCommand, addCommand, cancelCommand, removeCommand]) expect(() => parseCommandDefinition(command)).not.toThrow(); });
  it('lists desired accounts from the actual Adapter instead of a separate running Map', async () => {
    const f = await fixture(); await f.runtime.adapter.add(f.runtime.adapter.revision, { endpointId: 'bot-1', config: { id: 'bot-1', appid: 'synthetic-app', secret: 'synthetic-secret' } });
    const text = await listCommand.execute(f.context()); expect(text).toContain('bot-1'); expect(text).toContain('持久账号配置'); expect(text).not.toContain('synthetic-secret'); expect(f.state).not.toHaveProperty('endpoints');
  });
  it('keeps the captured, verified cancellation command in the active-flow footer', async () => {
    const f = await fixture(); f.state.bindFlow = { id: 'a', stop: vi.fn(), locale: 'zh-CN', cancelCommand: f.knownCommand('qq endpoint cancel') };
    expect(await listCommand.execute(f.context())).toContain('!account qq endpoint cancel');
  });
  it('does not invent invocations when the flow or command environment has none', async () => {
    const f = await fixture(); f.state.bindFlow = { id: 'unscoped', stop: vi.fn(), locale: 'zh-CN' };
    const text = await listCommand.execute(f.context(false)); expect(text).toContain('进行中'); expect(text).not.toContain('qq endpoint cancel');
    const remove = await removeCommand.execute(f.context(false)); expect(remove).not.toContain('qq endpoint remove'); expect(remove).toContain('命令'); expect(f.knownCommand('qq endpoint unknown')).toBeUndefined();
  });
  it('keeps the no-flow cancel message and the verified mounted remove usage', async () => {
    const f = await fixture(); expect(cancelCommand.execute(f.context())).toContain('没有进行中');
    expect(await removeCommand.execute(f.context())).toContain('用法：!account qq endpoint remove');
  });
  it('dispatches actual add, captures one CAS save port, and saves only after kind confirmation', async () => {
    const f = await fixture();
    expect(await f.commands.dispatch({ input: 'account qq endpoint add named', source: { sender: { id: 'alice' }, conversation: { endpoint: { id: 'source', adapter: 'sandbox' }, kind: 'private', id: 'alice' } } })).toMatchObject({ status: 'executed', value: expect.stringContaining('synthetic-qr') });
    expect(f.repository.writes).toHaveLength(0); expect(startFlow).toHaveBeenCalledOnce();
    await (startFlow.mock.calls[0]![0] as QqBindCallbacks).onSuccess([{ appId: 'synthetic-app', appSecret: 'synthetic-secret' }]);
    expect(f.state.pendingBotKind?.endpointId).toBe('named'); expect(f.repository.writes).toHaveLength(0);
    await f.state.pendingBotKind!.save({ id: 'named', appid: 'synthetic-app', secret: 'synthetic-secret', botKind: 'private' });
    expect(f.repository.writes).toHaveLength(1); expect(f.runtime.adapter.list()[0]?.desiredEnabled).toBe(false); expect(f.runtime.endpoint).toBeUndefined();
  });
  it('preserves the original real add master gate even when notify.id matches the caller', async () => {
    const f = await fixture({ master: 'alice', notify: { id: 'bob' } });
    const result = await f.commands.dispatch({ input: 'account qq endpoint add named', source: { sender: { id: 'bob' } } });
    expect(result).toMatchObject({ status: 'executed', value: '仅 master 可执行 QQ endpoint 管理命令' });
    expect(startFlow).not.toHaveBeenCalled(); expect(f.repository.writes).toHaveLength(0);
  });
  it('removes a saved account through the actual command route without requesting a restart or file writer', async () => {
    const f = await fixture(); await f.runtime.adapter.add(f.runtime.adapter.revision, { endpointId: 'bot', config: { id: 'bot', appid: 'synthetic-app', secret: 'synthetic-secret' } });
    expect(await f.commands.dispatch({ input: 'account qq endpoint remove bot', source: { sender: { id: 'alice' } } })).toMatchObject({ status: 'executed', value: expect.stringContaining('删除配置已保存') });
    expect(f.runtime.adapter.list()).toEqual([]); expect(f.repository.writes).toHaveLength(2);
  });
  it('does not replace the QR command’s captured CAS revision with the latest account document', async () => {
    const f = await fixture(), input = { sender: { id: 'alice' }, conversation: { endpoint: { id: 'source', adapter: 'sandbox' }, kind: 'private', id: 'alice' } };
    await f.commands.dispatch({ input: 'account qq endpoint add named', source: input });
    await (startFlow.mock.calls[0]![0] as QqBindCallbacks).onSuccess([{ appId: 'synthetic-app', appSecret: 'synthetic-secret' }]);
    await f.runtime.adapter.add(f.runtime.adapter.revision, { endpointId: 'other', config: { id: 'other', appid: 'other-app', secret: 'synthetic-other' } });
    await expect(completeQqPendingBotKind(f.state.pendingBotKind!, 'private')).rejects.toMatchObject({ code: 'conflict' });
    expect(f.repository.writes).toHaveLength(1); expect(f.runtime.adapter.list().map(row => row.endpointId)).toEqual(['other']); expect(f.state.pendingBotKind?.endpointId).toBe('named');
  });
  it('cannot save a QR command’s pending choice through a retired Adapter generation', async () => {
    const f = await fixture();
    await f.commands.dispatch({ input: 'account qq endpoint add named', source: { sender: { id: 'alice' }, conversation: { endpoint: { id: 'source', adapter: 'sandbox' }, kind: 'private', id: 'alice' } } });
    await (startFlow.mock.calls[0]![0] as QqBindCallbacks).onSuccess([{ appId: 'synthetic-app', appSecret: 'synthetic-secret' }]);
    await f.runtime.stop();
    await expect(completeQqPendingBotKind(f.state.pendingBotKind!, 'private')).rejects.toMatchObject({ code: 'closed' }); expect(f.repository.writes).toHaveLength(0);
  });

});
