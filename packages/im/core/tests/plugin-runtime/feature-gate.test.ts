import { describe, expect, it } from 'vitest';
import {
  childPluginId, createCapabilitySlot, featureConversationOverridesToken, featureId, primaryConfigToken, rootPluginId,
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

/** ADR 0057 §2: stored adapter / endpoint switches, keyed `<plugin>|<resolution key>`. */
type Stored = Readonly<Record<string, { enabled?: false; patch?: Record<string, unknown> }>>;

function fixture(document: Record<string, unknown>, stored: Stored = {}) {
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
    config: new Map(), resources: new Map([[root, new Map<string, unknown>([[primaryConfigToken.id, primary],
      ...(Object.keys(stored).length ? [[featureConversationOverridesToken.id, { version: 1, get: (plugin: string, key: string) => {
        const entry = stored[`${plugin}|${key}`];
        return entry ? { ...(entry.enabled === false ? { enabled: false as const } : {}), patch: entry.patch ?? {}, revision: 1, updatedAt: 1 } : undefined;
      } }] as const] : [])])], [rss, new Map()], [weather, new Map()], [qq, new Map()]]),
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
  configVersion: 2, plugins: { rss: '@x/rss', weather: '@x/weather', qq: '@x/qq' }, rss: {}, weather: {},
};
/** rss is off on account qq/news, weather on the whole qq adapter (stored, not in the configuration file). */
const stored: Stored = { 'rss|qq/news': { enabled: false }, 'weather|qq': { enabled: false } };

const message = (endpoint: string, content: string, group = 'g1') => ({
  content, conversation: { kind: 'group', id: group, endpoint: { id: endpoint, adapter: 'qq' } },
}) as never;

describe('ADR 0050 dispatch gate', () => {
  it('resolves the endpoint key of messages and endpoint events', () => {
    const { snapshot } = fixture(document, stored);
    expect(featureKeyOf(message('ep:news', ''), snapshot)).toBe('qq/news/group:g1');
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
    const gated = fixture(document, stored);
    const first = gatedCommandIndex(message('ep:news', ''), gated.snapshot);
    expect(first).not.toBe(gated.snapshot.projections.get(commandFeatureId));
    expect(gatedCommandIndex(message('ep:news', 'x'), gated.snapshot)).toBe(first);
    const other = gatedCommandIndex(message('ep:other', ''), gated.snapshot);
    expect(other).not.toBe(first);
    expect(gatedCommandIndex(message('ep:main', ''), gated.snapshot)).toBe(other);
    expect(gatedCommandIndex({ name: 'system' }, gated.snapshot)).toBe(gated.snapshot.projections.get(commandFeatureId));
  });

  it('drops commands of disabled owners: no match, no "disabled" reply, hidden from the menu', async () => {
    const { snapshot, events } = fixture(document, stored);
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
    const { snapshot, events } = fixture(document, stored);
    await runRuntimeMiddleware(snapshot, message('ep:main', 'hi'), async () => { events.push('terminal'); }, 'inbound');
    expect(events).toEqual(['middleware:rss', 'terminal']);
    events.length = 0;
    const index = gatedMiddlewareIndex(message('ep:news', 'hi'), snapshot)!;
    await index.runInbound(message('ep:news', 'hi'), async () => { events.push('terminal'); }, { stop: () => undefined, replace: () => undefined }, snapshot);
    expect(events).toEqual(['terminal']);
  });

  it('skips handlers of disabled owners for endpoint events only', async () => {
    const { snapshot, events } = fixture(document, stored);
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

describe('ADR 0055 conversation-level dispatch gate', () => {
  it('drops a command in group A but not in group B, and follows store writes in place', async () => {
    const { snapshot, events } = fixture({ configVersion: 2, plugins: { rss: '@x/rss', weather: '@x/weather', qq: '@x/qq' } });
    const rows = new Map<string, { enabled?: false; patch: Record<string, unknown>; revision: number; updatedAt: number }>();
    const reader = { version: 0, get: (plugin: string, key: string) => rows.get(`${plugin}|${key}`) };
    (snapshot.resources.get(root) as Map<string, unknown>).set(featureConversationOverridesToken.id, reader);
    const dispatcher = new MessageDispatcher(() => '');
    expect(await dispatcher.dispatch(message('ep:main', 'rss', 'A'), snapshot)).toMatchObject({ matched: true });
    rows.set('rss|qq/main/group:A', { enabled: false, patch: {}, revision: 1, updatedAt: 1 });
    reader.version = 1;
    expect(featureKeyOf(message('ep:main', '', 'A'), snapshot)).toBe('qq/main/group:A');
    expect(await dispatcher.dispatch(message('ep:main', 'rss', 'A'), snapshot)).toMatchObject({ matched: false });
    expect(await dispatcher.dispatch(message('ep:main', 'rss', 'B'), snapshot)).toMatchObject({ matched: true, owner: rss });
    expect([...disabledOwnersOf(message('ep:main', '', 'A'), snapshot)]).toEqual([rss]);
    events.length = 0;
    await runRuntimeMiddleware(snapshot, message('ep:main', 'hi', 'A'), async () => { events.push('terminal'); }, 'inbound');
    expect(events).toEqual(['middleware:weather', 'terminal']);
    rows.delete('rss|qq/main/group:A');
    reader.version = 2;
    expect(await dispatcher.dispatch(message('ep:main', 'rss', 'A'), snapshot)).toMatchObject({ matched: true });
  });
});
