/**
 * Minimal real-ImRuntime fixture for Room acceptance tests: one `memory` adapter publishing three
 * Endpoints (a / b / c), each registered in a PeerRegistry with its own Bot account.
 *
 * Adapter-layer packages are imported by relative source path on purpose: @zhin.js/adapter is not a
 * dependency of @zhin.js/workroom, and production code must not gain one. Test-only.
 */
import {
  SnapshotStore,
  createCapabilitySlot,
  createSnapshotView,
  rootPluginId,
  type CapabilitySlot,
  type SnapshotState,
} from '@zhin.js/plugin-runtime';
import {
  AdapterIndex,
  Endpoint,
  adapterFeatureId,
  defineAdapter,
  endpointEventGatewayToken,
  createPeerRegistry,
  type EndpointEvent,
} from '../../../adapter/src/index.js';
import { MemoryConversationEventStore } from '@zhin.js/im-contract';
import { ImRuntime, ingressRouteToken, roomMembershipToken, type Message } from '@zhin.js/core/runtime';
import type { RoomDefinition } from '../../src/room/room-definition.js';
import { createRoomRegistry } from '../../src/room/room-registry.js';
import { createRoomMembershipPort } from '../../src/room/room-membership.js';

class TestEndpoint extends Endpoint<object> {
  readonly client: object;
  constructor(surface: object) {
    super();
    this.client = surface;
    Object.defineProperties(this, Object.getOwnPropertyDescriptors(surface));
  }
}

const ignored = Object.freeze({ receive: async (_event: EndpointEvent) => undefined });

export const NAMES = ['a', 'b', 'c'] as const;
export const ACCOUNT = { a: 'bot-a', b: 'bot-b', c: 'bot-c' } as const;

export function snapshotState(snapshot: ReturnType<SnapshotStore['acquire']>['value']): SnapshotState {
  return {
    root: snapshot.root,
    tree: snapshot.tree,
    config: snapshot.config,
    resources: snapshot.resources,
    capabilities: snapshot.capabilities,
    projections: snapshot.projections,
  };
}

export async function createRoomImFixture(options: {
  room?: (ids: Record<'a' | 'b' | 'c', string>) => RoomDefinition;
  onRoute?: (message: Message, im: ImRuntime) => Promise<void> | void;
} = {}) {
  const root = rootPluginId();
  const sent: Array<{ conversation: { endpoint: { id: string }; kind: string; id: string }; payload: unknown }> = [];
  let outSeq = 0;
  const adapter = createCapabilitySlot({
    owner: root,
    feature: adapterFeatureId,
    localName: 'memory',
    source: '/adapters/memory.ts',
    definition: defineAdapter({
      capabilities: ['inbound', 'outbound'],
      segments: { interactive: 'text' },
      async create() {
        return new TestEndpoint({
          start() {}, open() {}, close() {}, stop() {},
          send(request: never) {
            sent.push(request);
            return `out-${++outSeq}`;
          },
        });
      },
    }),
  });
  const slots: readonly CapabilitySlot[] = [adapter];
  const base: SnapshotState = {
    root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: '@test/root', packageRoot: '/project', children: [] }]]),
    config: new Map<never, unknown>([[root, { endpoints: NAMES.map((n) => ({ id: `account-${n}` })) }]] as never),
    resources: new Map([[root, new Map([[endpointEventGatewayToken.id, ignored]])]]) as never,
    capabilities: new Map(slots.map((slot) => [slot.id, slot])),
    projections: new Map(),
  };
  const view = createSnapshotView(0, base);
  const adapters = await AdapterIndex.create([adapter], view, new AbortController().signal);
  const store = new SnapshotStore({ ...base, projections: new Map([[adapterFeatureId, adapters]]) } as never);
  const peerRegistry = createPeerRegistry();
  const conversationEvents = new MemoryConversationEventStore();
  const im = new ImRuntime({ peerRegistry, conversationEvents });
  im.attach(store);
  await adapters.start();
  adapters.open();

  const endpointIds = im.endpoints.list().map((row) => String(row.endpoint.id));
  const ids = { a: endpointIds[0]!, b: endpointIds[1]!, c: endpointIds[2]! };
  for (const n of NAMES) {
    peerRegistry.registerEndpoint({}, { endpointId: ids[n] as never, adapter: 'memory', selfUserId: ACCOUNT[n] });
  }

  const room: RoomDefinition = options.room?.(ids) ?? {
    name: 'Dev',
    conversation: { adapter: 'memory', endpoint: 'a', kind: 'group', id: 'room-1' },
    coordinator: 'lead',
    roles: {
      coordinator: { prompt: 'p', accepts: ['coordinate'], handoffTo: ['researcher'] },
      researcher: { prompt: 'p', accepts: ['research'], handoffTo: ['writer'] },
      writer: { prompt: 'p', accepts: ['write'] },
    },
    members: [
      { agent: 'lead', role: 'coordinator', botEndpoint: { adapter: 'memory', endpoint: 'a' }, aliases: ['boss'] },
      { agent: 'res', role: 'researcher', botEndpoint: { adapter: 'memory', endpoint: 'b' } },
      { agent: 'wri', role: 'writer', botEndpoint: { adapter: 'memory', endpoint: 'c' } },
    ],
  };
  const registry = createRoomRegistry({ dev: room }, (bot) => ids[bot.endpoint as 'a' | 'b' | 'c']);

  const commit = (key: string, value: unknown) => {
    const current = store.current;
    const resources = new Map(current.resources);
    resources.set(current.root, new Map([...resources.get(current.root)!, [key, value]]));
    store.commit(current.generation, { snapshot: { ...snapshotState(current), resources } as never, dispose: () => undefined });
  };
  commit(roomMembershipToken.id, createRoomMembershipPort(registry));
  const routed: Array<{ endpointId: string; mentioned: boolean | undefined; content: string; origin?: string }> = [];
  commit(ingressRouteToken.id, {
    route: async (m: Message) => {
      routed.push({ endpointId: m.conversation.endpoint.id, mentioned: m.mentioned, content: m.content, origin: m.origin });
      await options.onRoute?.(m, im);
      return true;
    },
  });

  let seq = 0;
  const conversation = (endpointId: string) => ({
    endpoint: { id: endpointId, adapter: 'memory' }, kind: 'group' as const, id: 'room-1',
  });
  /** Deliver one human message copy to an Endpoint. */
  const deliver = (endpointId: string, extra: Record<string, unknown> & { messageId?: string; sender?: string; content?: string } = {}) => {
    const { messageId = `msg-${++seq}`, sender = 'alice', content = 'plain chat', ...rest } = extra;
    const conv = conversation(endpointId);
    return im.endpointEvents.receive(Object.freeze({
      name: 'message.receive',
      payload: { conversation: conv, content, sender: { id: sender }, message: { conversation: conv, id: messageId }, ...rest },
      endpoint: Object.freeze({ id: endpointId as never, name: 'test' }),
      client: adapters.clientById(endpointId as typeof adapter.id),
    }) as never) as Promise<{ matched: boolean }>;
  };
  /**
   * Deliver the same message to several Endpoints concurrently, in the given arrival order.
   * Concurrent on purpose: a non-target copy that arrives first waits for the target (grace
   * period), so awaiting it before delivering the target would just burn the grace period.
   */
  const deliverAll = (endpointIds: readonly string[], extra: Parameters<typeof deliver>[1] = {}) =>
    Promise.all(endpointIds.map((endpointId) => deliver(endpointId, extra)));
  const close = async () => { await adapters.stop(); await store.close(); };

  return { im, ids, registry, room, routed, sent, deliver, deliverAll, conversation, conversationEvents, close, peerRegistry };
}
