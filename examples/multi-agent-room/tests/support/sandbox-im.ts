/**
 * Sandbox-shaped IM fixture for the Room acceptance tests.
 *
 * A real `ImRuntime` (inbound dedup / origin classification / outbound chain) over an adapter named
 * `sandbox` that publishes three Endpoints (coordinator-bot / researcher-bot / writer-bot). The Endpoints
 * only record what reaches the end of the send chain; nothing touches the network. Each Endpoint reports
 * `selfUserId = endpoint name`, like the real Sandbox adapter.
 */
import {
  SnapshotStore,
  createCapabilitySlot,
  createSnapshotView,
  rootPluginId,
  type CapabilitySlot,
  type SnapshotState,
} from '@zhin.js/plugin-runtime';
import { MemoryConversationEventStore } from '@zhin.js/im-contract';
import {
  AdapterIndex,
  Endpoint,
  adapterFeatureId,
  createPeerRegistry,
  defineAdapter,
  endpointEventGatewayToken,
  type EndpointEvent,
} from 'zhin.js/adapter';
import { ImRuntime, ingressRouteToken, roomMembershipToken, type Message } from 'zhin.js/core/runtime';
import { createRoomMembershipPort, type RoomDefinition, type RoomRegistry } from '@zhin.js/workroom';
import { BOT_ENDPOINTS, ROOM_ID, SANDBOX_ADAPTER, buildRoomDefinition, buildRoomRegistry } from '../../src/room.js';

class SandboxTestEndpoint extends Endpoint<object> {
  readonly client: object;
  constructor(surface: object) {
    super();
    this.client = surface;
    Object.defineProperties(this, Object.getOwnPropertyDescriptors(surface));
  }
  // Lifecycle stubs (the surface's own members shadow them at runtime).
  start(): void {}
  open(): void {}
  close(): void {}
  stop(): void {}
}

const ignored = Object.freeze({ receive: async (_event: EndpointEvent) => undefined });

export type BotName = keyof typeof BOT_ENDPOINTS;
export const BOT_NAMES = Object.keys(BOT_ENDPOINTS) as readonly BotName[];

export interface SentRecord {
  readonly conversation: { readonly endpoint: { readonly id: string }; readonly kind: string; readonly id: string };
  readonly payload: unknown;
}

export type RouteHandler = (message: Message) => Promise<boolean> | boolean;

function snapshotState(snapshot: ReturnType<SnapshotStore['acquire']>['value']): SnapshotState {
  return {
    root: snapshot.root,
    tree: snapshot.tree,
    config: snapshot.config,
    resources: snapshot.resources,
    capabilities: snapshot.capabilities,
    projections: snapshot.projections,
  };
}

/** Text of a sent payload (segments are flattened; a mention renders as `@target`). */
export function payloadText(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (Array.isArray(payload)) return payload.map(payloadText).join('');
  if (payload && typeof payload === 'object') {
    const segment = payload as { type?: string; data?: Record<string, unknown>; content?: unknown };
    if (segment.type === 'text') return String(segment.data?.text ?? '');
    if (segment.type === 'mention') return `@${String(segment.data?.target ?? '')}`;
    if (segment.content !== undefined) return payloadText(segment.content);
  }
  return '';
}

export async function createSandboxImFixture(options: { room?: RoomDefinition } = {}) {
  const root = rootPluginId();
  const sent: SentRecord[] = [];
  let outSeq = 0;
  const adapter = createCapabilitySlot({
    owner: root,
    feature: adapterFeatureId,
    localName: SANDBOX_ADAPTER,
    source: '/adapters/sandbox.ts',
    definition: defineAdapter({
      capabilities: ['inbound', 'outbound'],
      segments: { interactive: 'text' },
      async create() {
        return new SandboxTestEndpoint({
          start() {}, open() {}, close() {}, stop() {},
          send(request: SentRecord) {
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
    config: new Map<never, unknown>([[root, { endpoints: BOT_NAMES.map((name) => ({ id: BOT_ENDPOINTS[name] })) }]] as never),
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

  // Runtime Endpoint ids follow the configured `endpoints[]` order; Bot account = endpoint name.
  const runtimeIds = im.endpoints.list().map((row) => String(row.endpoint.id));
  const ids = Object.freeze(Object.fromEntries(BOT_NAMES.map((name, index) => [name, runtimeIds[index]!])) as Record<BotName, string>);
  const nameById = new Map(BOT_NAMES.map((name) => [ids[name], name] as const));
  const accounts = Object.freeze(Object.fromEntries(BOT_NAMES.map((name) => [name, BOT_ENDPOINTS[name]])) as Record<BotName, string>);
  for (const name of BOT_NAMES) {
    peerRegistry.registerEndpoint({}, { endpointId: ids[name] as never, adapter: SANDBOX_ADAPTER, selfUserId: accounts[name] });
  }
  const accountOf = (endpointId: string): string | undefined => peerRegistry.selfOf(endpointId);

  const room = options.room ?? buildRoomDefinition();
  const registry: RoomRegistry = buildRoomRegistry(room, (bot) => {
    const id = BOT_NAMES.map((name) => name).find((name) => BOT_ENDPOINTS[name] === bot.endpoint);
    const resolved = id === undefined ? undefined : ids[id];
    if (resolved === undefined) throw new Error(`unknown bot endpoint ${bot.endpoint}`);
    return resolved;
  });

  const commit = (key: string, value: unknown) => {
    const current = store.current;
    const resources = new Map(current.resources);
    resources.set(current.root, new Map([...resources.get(current.root)!, [key, value]]) as never);
    store.commit(current.generation, { snapshot: { ...snapshotState(current), resources } as never, dispose: () => undefined });
  };
  commit(roomMembershipToken.id, createRoomMembershipPort(registry));

  const routed: Array<{ endpointId: string; mentioned: boolean | undefined; content: string; origin?: string; sender?: string }> = [];
  let routeHandler: RouteHandler = () => true;
  commit(ingressRouteToken.id, {
    route: async (message: Message) => {
      routed.push({
        endpointId: message.conversation.endpoint.id,
        mentioned: message.mentioned,
        content: message.content,
        origin: message.origin,
        sender: (message as { sender?: { id?: string } }).sender?.id,
      });
      return routeHandler(message);
    },
  });

  let seq = 0;
  const conversation = (endpointId: string) => ({
    endpoint: { id: endpointId, adapter: SANDBOX_ADAPTER },
    kind: 'group' as const,
    id: room.conversation.id,
  });
  /** Deliver one message copy to one Endpoint. */
  const deliver = (
    endpointId: string,
    extra: Record<string, unknown> & { messageId?: string; sender?: string; content?: string } = {},
  ) => {
    const { messageId = `msg-${++seq}`, sender = 'alice', content = 'plain chat', ...rest } = extra;
    const conv = conversation(endpointId);
    return im.endpointEvents.receive(Object.freeze({
      name: 'message.receive',
      payload: { conversation: conv, content, sender: { id: sender }, message: { conversation: conv, id: messageId }, ...rest },
      endpoint: Object.freeze({ id: endpointId as never, name: 'test' }),
      client: adapters.clientById(endpointId as typeof adapter.id),
    }) as never) as Promise<{ matched: boolean }>;
  };
  /** Deliver the same message to several Endpoints concurrently (each Bot in the group sees one copy). */
  const deliverAll = (endpointIds: readonly string[] = BOT_NAMES.map((name) => ids[name]), extra: Parameters<typeof deliver>[1] = {}) => {
    const shared = { ...extra, messageId: extra.messageId ?? `msg-${++seq}` };
    return Promise.all(endpointIds.map((endpointId) => deliver(endpointId, shared)));
  };
  /**
   * Platform echo of a sent message: the same group message reaches every Endpoint again, sent by the
   * speaking Bot's own account with the platform message id the send returned (`out-N`).
   */
  const echo = (sentIndex: number) => {
    const record = sent[sentIndex];
    if (!record) throw new Error(`no sent message at index ${sentIndex}`);
    const speaker = nameById.get(record.conversation.endpoint.id);
    if (!speaker) throw new Error(`sent message ${sentIndex} was not sent by a known Bot`);
    return deliverAll(BOT_NAMES.map((name) => ids[name]), {
      messageId: `out-${sentIndex + 1}`,
      sender: accounts[speaker],
      content: payloadText(record.payload),
    });
  };
  const close = async () => { await adapters.stop(); await store.close(); };

  return {
    im, root, ids, accounts, accountOf, registry, room, routed, sent, deliver, deliverAll, echo, conversation,
    conversationEvents, peerRegistry, close,
    nameOf: (endpointId: string): BotName | undefined => nameById.get(endpointId),
    setRoute: (handler: RouteHandler) => { routeHandler = handler; },
  };
}

export type SandboxImFixture = Awaited<ReturnType<typeof createSandboxImFixture>>;
export { ROOM_ID };
