import { describe, expect, it } from 'vitest';
import {
  childPluginId, createCapabilitySlot, featureId, primaryConfigToken, rootPluginId,
  type CapabilitySlot, type PluginId, type PluginNodeSnapshot, type PrimaryConfig, type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import { CommandIndex, commandFeatureId, defineCommand } from '@zhin.js/command';
import { MiddlewareIndex, defineMiddleware, middlewareFeatureId } from '@zhin.js/middleware';
import { HandlerIndex, defineHandler, handlerFeatureId } from '@zhin.js/handler';
import {
  disabledOwnersOf, featureKeyOf, gatedCommandIndex, gatedHandlerIndex, gatedMiddlewareIndex,
} from '../../src/plugin-runtime/im/feature-gate.js';
import { MessageDispatcher } from '../../src/plugin-runtime/im/message-dispatcher.js';
import { dispatchInboundHandlers, runRuntimeMiddleware } from '../../src/plugin-runtime/im/inbound-spine.js';

const root = rootPluginId();
const rss = childPluginId(root, 'rss');
const weather = childPluginId(root, 'weather');
const qq = childPluginId(root, 'qq');

function node(id: PluginId, instanceKey: string, children: PluginId[] = []): PluginNodeSnapshot {
  return { id, instanceKey, packageName: `@x/${instanceKey}`, packageRoot: `/x/${instanceKey}`, parent: id === root ? undefined : root, children } as unknown as PluginNodeSnapshot;
}

function fixture(document: Record<string, unknown>) {
  const events: string[] = [];
  const slots: CapabilitySlot[] = [
    createCapabilitySlot({ owner: rss, feature: commandFeatureId, localName: 'rss', source: '/rss/commands/rss/index.ts',
      definition: defineCommand({ async execute() { events.push('command:rss'); return 'rss!'; } }) }),
    createCapabilitySlot({ owner: weather, feature: commandFeatureId, localName: 'weather', source: '/weather/commands/weather/index.ts',
      definition: defineCommand({ async execute() { events.push('command:weather'); return 'sunny'; } }) }),
    createCapabilitySlot({ owner: rss, feature: middlewareFeatureId, localName: 'audit', source: '/rss/middlewares/audit/index.ts',
      definition: defineMiddleware({ async handle(_context, next) { events.push('middleware:rss'); await next(); } }) }),
    createCapabilitySlot({ owner: weather, feature: middlewareFeatureId, localName: 'audit', source: '/weather/middlewares/audit/index.ts',
      definition: defineMiddleware({ async handle(_context, next) { events.push('middleware:weather'); await next(); } }) }),
    createCapabilitySlot({ owner: rss, feature: handlerFeatureId, localName: 'message/receive', source: '/rss/handlers/message/receive/index.ts',
      definition: defineHandler({ handle() { events.push('handler:rss'); } }) }),
    createCapabilitySlot({ owner: weather, feature: handlerFeatureId, localName: 'message/receive', source: '/weather/handlers/message/receive/index.ts',
      definition: defineHandler({ handle() { events.push('handler:weather'); } }) }),
  ] as CapabilitySlot[];
  const primary: PrimaryConfig = { document, expanded: document, get: () => undefined };
  const projections = new Map<ReturnType<typeof featureId>, unknown>();
  const snapshot: RuntimeSnapshot = {
    generation: 1, root,
    tree: new Map([[root, node(root, 'root', [rss, weather, qq])], [rss, node(rss, 'rss')], [weather, node(weather, 'weather')], [qq, node(qq, 'qq')]]),
    config: new Map(), resources: new Map([[root, new Map([[primaryConfigToken.id, primary]])], [rss, new Map()], [weather, new Map()], [qq, new Map()]]),
    capabilities: new Map(slots.map(slot => [slot.id, slot])), projections,
  };
  // Duck-typed AdapterIndex surface used for endpoint → `<alias>/<endpointId>` resolution.
  projections.set(featureId('zhin.adapter'), {
    owner: (id: string) => { if (!id.startsWith('ep:')) throw new Error('unknown endpoint'); return qq; },
    endpointEntry: (id: string) => ({ desired: { endpointId: id.slice(3) } }),
  });
  projections.set(commandFeatureId, new CommandIndex(slots.filter(slot => slot.feature === commandFeatureId) as never, snapshot, {}));
  projections.set(middlewareFeatureId, new MiddlewareIndex(slots.filter(slot => slot.feature === middlewareFeatureId) as never, snapshot));
  projections.set(handlerFeatureId, new HandlerIndex(slots.filter(slot => slot.feature === handlerFeatureId) as never, snapshot));
  return { snapshot, events };
}

const document = {
  configVersion: 2, plugins: { rss: '@x/rss', weather: '@x/weather', qq: '@x/qq' },
  rss: { overrides: { endpoints: { 'qq/news': { enabled: false } } } },
  weather: { overrides: { adapters: { qq: { enabled: false } }, endpoints: { 'qq/main': { enabled: true } } } },
};

const message = (endpoint: string, content: string) => ({
  content, conversation: { kind: 'group', id: 'g1', endpoint: { id: endpoint, adapter: 'qq' } },
}) as never;

describe('ADR 0050 dispatch gate', () => {
  it('resolves the endpoint key of messages and endpoint events', () => {
    const { snapshot } = fixture(document);
    expect(featureKeyOf(message('ep:news', ''), snapshot)).toBe('qq/news');
    expect(featureKeyOf({ endpoint: { id: 'ep:main' }, payload: {} }, snapshot)).toBe('qq/main');
    expect(featureKeyOf({ payload: { conversation: { endpoint: { id: 'ep:x' } } } }, snapshot)).toBe('qq/x');
    expect(featureKeyOf({ name: 'system' }, snapshot)).toBeUndefined();
    expect([...disabledOwnersOf(message('ep:news', ''), snapshot)].sort()).toEqual([rss, weather]);
    // An endpoint-level `enabled: true` cannot re-enable an adapter-level disable.
    expect([...disabledOwnersOf(message('ep:main', ''), snapshot)]).toEqual([weather]);
  });

  it('keeps the projected index when nothing is disabled and caches derived indexes', () => {
    const { snapshot } = fixture({ configVersion: 2, plugins: {} });
    expect(gatedCommandIndex(message('ep:news', ''), snapshot)).toBe(snapshot.projections.get(commandFeatureId));
    const gated = fixture(document);
    const first = gatedCommandIndex(message('ep:news', ''), gated.snapshot);
    expect(first).not.toBe(gated.snapshot.projections.get(commandFeatureId));
    expect(gatedCommandIndex(message('ep:news', 'x'), gated.snapshot)).toBe(first);
    const other = gatedCommandIndex(message('ep:other', ''), gated.snapshot);
    expect(other).not.toBe(first);
    expect(gatedCommandIndex(message('ep:main', ''), gated.snapshot)).toBe(other);
    expect(gatedCommandIndex({ name: 'system' }, gated.snapshot)).toBe(gated.snapshot.projections.get(commandFeatureId));
  });

  it('drops commands of disabled owners: no match, no "disabled" reply, hidden from the menu', async () => {
    const { snapshot, events } = fixture(document);
    const dispatcher = new MessageDispatcher(() => '');
    expect(await dispatcher.dispatch(message('ep:news', 'rss'), snapshot)).toMatchObject({ matched: false });
    expect(await dispatcher.dispatch(message('ep:news', 'weather'), snapshot)).toMatchObject({ matched: false });
    expect(await dispatcher.dispatch(message('ep:main', 'rss'), snapshot)).toMatchObject({ matched: true, owner: rss });
    expect(await dispatcher.dispatch(message('ep:main', 'weather'), snapshot)).toMatchObject({ matched: false });
    expect(events).toEqual(['command:rss']);
    const menu = gatedCommandIndex(message('ep:main', ''), snapshot)!.list().map(command => command.name);
    expect(menu).toEqual(['rss']);
  });

  it('skips middleware of disabled owners', async () => {
    const { snapshot, events } = fixture(document);
    await runRuntimeMiddleware(snapshot, message('ep:main', 'hi'), async () => { events.push('terminal'); }, 'inbound');
    expect(events).toEqual(['middleware:rss', 'terminal']);
    events.length = 0;
    const index = gatedMiddlewareIndex(message('ep:news', 'hi'), snapshot)!;
    await index.runInbound(message('ep:news', 'hi'), async () => { events.push('terminal'); }, { stop: () => undefined, replace: () => undefined }, snapshot);
    expect(events).toEqual(['terminal']);
  });

  it('skips handlers of disabled owners for endpoint events only', async () => {
    const { snapshot, events } = fixture(document);
    const event = { name: 'message.receive', endpoint: { id: 'ep:main', adapter: 'qq' }, payload: message('ep:main', 'hi') };
    await gatedHandlerIndex(event, snapshot)!.dispatch('message.receive', [event], { snapshot });
    expect(events).toEqual(['handler:rss']);
    events.length = 0;
    await gatedHandlerIndex({ name: 'system' }, snapshot)!.dispatch('message.receive', [], { snapshot });
    expect(events).toEqual(['handler:rss', 'handler:weather']);
    events.length = 0;
    const lease = { value: snapshot, stopSignal: new AbortController().signal } as never;
    const deliver = async () => { throw new Error('not used'); };
    await dispatchInboundHandlers({ lease, event: 'message.receive', args: [event], interactions: {} as never, deliver });
    expect(events).toEqual(['handler:rss']);
    await dispatchInboundHandlers({ lease, event: 'message.receive', args: [{ ...event, endpoint: { id: 'ep:news', adapter: 'qq' } }],
      interactions: {} as never, deliver });
    expect(events).toEqual(['handler:rss']);
  });
});
