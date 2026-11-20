/**
 * zhinjs/zhin#1250 第 84 批: an Agent management Root command a plugin middleware forwards with
 * `CommandIndex.dispatch` runs through the production path — the IM runtime, the inbound middleware,
 * the Agent Host's real IM operation resources (`createHostOperationResources`) — and is refused with a
 * request to send it directly: the prompt names the command with the message's prefix, goes out
 * through the outbound chain, and the message's outcome is `refused` / `direct_command_required`.
 * A caller-built `operation` that claims the dispatch lease gets no further.
 */
import { describe, expect, it, vi } from 'vitest';
import { Adapter, AdapterIndex, adapterFeatureId, createEndpointSpecification, defineAdapter, endpointEventGatewayToken, endpointSpec,
  type Endpoint, type EndpointSendRequest } from '@zhin.js/adapter';
import { CommandIndex, commandFeatureId, type CommandDispatchResult } from '@zhin.js/command';
import { ImRuntime, imOperationResourcesToken, type Message } from '@zhin.js/core/runtime';
import { MiddlewareIndex, defineMiddleware, middlewareFeatureId } from '@zhin.js/middleware';
import { PermissionHost, permissionHostToken } from '@zhin.js/permission';
import { SnapshotStore, childPluginId, createCapabilitySlot, createSnapshotView, primaryConfigToken, rootPluginId,
  type PrimaryConfig, type SnapshotState } from '@zhin.js/plugin-runtime';
import { createHostOperationResources } from '@zhin.js/agent/runtime';
import { createRuntimeManagementCommands, type RuntimeManagementDispatch } from '@zhin.js/agent';

class TestEndpoint implements Endpoint {
  readonly sent: EndpointSendRequest[] = [];
  readonly [endpointSpec] = createEndpointSpecification(this, { start() {}, open() {}, close() {}, stop() {},
    send: async (request: EndpointSendRequest) => { this.sent.push(request); return `sent-${this.sent.length}`; } });
}
class TestAdapter extends Adapter<TestEndpoint> { protected createEndpoint() { return new TestEndpoint(); } }

type Forward = (commands: CommandIndex, input: Message) => Promise<CommandDispatchResult>;

async function fixture(forward: Forward) {
  const root = rootPluginId();
  const buttons = childPluginId(root, 'buttons');
  const im = new ImRuntime();
  const adapter = new TestAdapter();
  const results: CommandDispatchResult[] = [];
  const errors: unknown[] = [];
  const open = vi.fn(async (_message: Message, _dispatch: RuntimeManagementDispatch, run: (operation: never) => Promise<unknown>) =>
    run({ sessionKey: 'session' } as never));
  const clear = vi.fn(async (_message: Message, _dispatch: RuntimeManagementDispatch) => undefined);
  const archiveSession = vi.fn(async () => true);
  const management = createRuntimeManagementCommands({ zhinAgent: { archiveSession } as never, open: open as never, clear })
    .map(command => createCapabilitySlot({ owner: root, feature: commandFeatureId, localName: command.name,
      source: `/agent/${command.name}`, definition: command.definition }));
  const adapterSlot = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'forward-test', source: '/adapters/forward-test',
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], createAdapter: () => adapter }) });
  // docs/authoring/commands.md#dispatch-from-middleware: the middleware replies with the command's reply.
  const middleware = createCapabilitySlot({ owner: buttons, feature: middlewareFeatureId, localName: 'buttons', source: '/middlewares/buttons',
    definition: defineMiddleware<Message>({ async handle(context, next) {
      if (!context.input.content.startsWith('btn:')) return next();
      try {
        const result = await forward(context.project<CommandIndex>(commandFeatureId), context.input);
        results.push(result);
        if (!result.matched) return next();
        return result.value;
      } catch (error) { errors.push(error); return undefined; }
    } }) });
  const document = { configVersion: 2, plugins: { buttons: 'buttons' } };
  const primary: PrimaryConfig = { document, expanded: document, get: () => undefined };
  // The Agent Host's IM operation resources, as `host-installer.ts` provides them.
  const host = createHostOperationResources({ host: {} as never, quota: {} as never }).im;
  const state: SnapshotState = { root, tree: new Map([
    [root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [buttons] }],
    [buttons, { id: buttons, parent: root, instanceKey: 'buttons', packageName: 'buttons', packageRoot: '/fixture/buttons', children: [] }],
  ]), config: new Map([[root, { commandPrefix: '/', endpoints: [{ id: 'one' }] }]]),
  resources: new Map([[root, new Map<string, unknown>([
    [endpointEventGatewayToken.id, im.endpointEvents], [permissionHostToken.id, new PermissionHost()], [primaryConfigToken.id, primary],
    [imOperationResourcesToken.id, host],
  ])], [buttons, new Map()]]),
  capabilities: new Map([adapterSlot, ...management, middleware].map(slot => [slot.id, slot])), projections: new Map() };
  const view = createSnapshotView(0, state);
  const index = await AdapterIndex.create([adapterSlot], view, new AbortController().signal);
  const store = new SnapshotStore({ ...state, projections: new Map<string, unknown>([
    [adapterFeatureId, index], [commandFeatureId, new CommandIndex(management, view)], [middlewareFeatureId, new MiddlewareIndex([middleware], view)],
  ]) as SnapshotState['projections'] });
  im.attach(store); await index.start(); index.open();
  const row = adapter.list()[0]!;
  const endpoint = adapter.getEndpoint(row.instanceId)!;
  const receive = async (content: string) => {
    await endpoint[endpointSpec].events.message({ conversation: { endpoint: { id: row.canonicalId, adapter: 'forward-test' }, kind: 'private', id: 'alice' },
      content, sender: { id: 'alice', name: 'Alice' }, platformSentAt: Date.now() });
    await vi.waitFor(() => expect(im.messageOutcomes.list().length).toBeGreaterThan(0));
  };
  const outcomes = () => im.messageOutcomes.list().map(record => [record.outcome, record.reason, record.stage, record.command]);
  return { root, endpoint, results, errors, open, clear, archiveSession, receive, outcomes,
    close: async () => { await index.stop(); await store.close(); } };
}

describe('an Agent management command a plugin middleware forwards (#1250 第 84 批)', () => {
  it('replies the direct-send request (with the message\'s prefix) through the outbound chain and records refused', async () => {
    const f = await fixture((commands, input) => commands.dispatch({ input: 'reset', source: input }));
    try {
      await f.receive('btn:reset');
      expect(f.errors).toEqual([]);
      expect(f.results).toEqual([expect.objectContaining({ status: 'executed', refused: true, refusalReason: 'direct_command_required' })]);
      expect(f.endpoint.sent.map(request => request.payload)).toEqual(['ℹ️ 该命令不能经插件转发执行，请直接发送 /reset。']);
      expect(f.outcomes()).toEqual([['refused', 'direct_command_required', 'command', 'reset']]);
      expect(f.clear).not.toHaveBeenCalled();
      expect(f.open).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });

  it('runs the same command sent directly with the Host-issued dispatch lease', async () => {
    const f = await fixture((commands, input) => commands.dispatch({ input: 'reset', source: input }));
    try {
      await f.receive('/reset');
      expect(f.clear).toHaveBeenCalledOnce();
      expect(typeof f.clear.mock.calls[0]![1].retainLease).toBe('function');
      expect(f.outcomes()).toEqual([['command_replied', 'executed', 'command', 'reset']]);
    } finally { await f.close(); }
  });

  it('gives a caller-built operation that claims the dispatch lease no lease: the command does not run', async () => {
    const snapshotHook = Symbol.for('zhin.operation-input-snapshot/1');
    const retain = vi.fn();
    const f = await fixture((commands, input) => commands.dispatch({ input: 'reset', source: input, operation: {
      signal: new AbortController().signal,
      create: ({ signal }) => ({ signal, resources: {
        // The token id is readable without importing anything internal.
        has: token => token?.id === 'zhin.agent.dispatch-lease',
        use: () => ({ retain: () => { retain(); return { value: (input as unknown as Record<symbol, () => unknown>)[snapshotHook]!(), release() {} }; } }) as never,
        close: async () => undefined,
      } }),
    } }));
    try {
      await f.receive('btn:reset');
      expect(f.errors).toEqual([]);
      expect(f.results).toEqual([expect.objectContaining({ status: 'executed', refused: true, refusalReason: 'direct_command_required' })]);
      expect(f.endpoint.sent.map(request => request.payload)).toEqual(['ℹ️ 该命令不能经插件转发执行，请直接发送 /reset。']);
      expect(retain).not.toHaveBeenCalled();
      expect(f.clear).not.toHaveBeenCalled();
      expect(f.open).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });
});
