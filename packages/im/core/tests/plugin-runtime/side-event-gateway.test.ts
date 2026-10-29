import { composeSideEventName, sideEventConversation } from '../../src/side-event/base.js';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  SnapshotStore,
  createCapabilitySlot,
  createSnapshotView,
  rootPluginId,
  type FeatureId,
} from '@zhin.js/plugin-runtime';
import {
  AdapterIndex,
  Endpoint,
  adapterFeatureId,
  defineAdapter,
  endpointEventGatewayToken,
  type EndpointEventEmitter,
} from '@zhin.js/adapter';
import {
  HandlerIndex,
  defineHandler,
  handlerFeatureId,
} from '@zhin.js/handler';
import { buildNotice, buildRequest, buildSystem } from '../../src/side-event/normalize.js';
import { ImRuntime, type Notice as RuntimeNotice, type Request as RuntimeRequest, type SystemEvent as RuntimeSystemEvent } from '../../src/plugin-runtime/im/index.js';
import { Notice } from '../../src/notice.js';
import { SystemEvent } from '../../src/system-event.js';
import { Request, type IncomingRequest } from '../../src/request.js';
import type { Notice as PublicNotice, Request as PublicRequest, SystemEvent as PublicSystemEvent } from '../../src/index.js';

describe('ImRuntime side-event handlers', () => {
  it('exports one canonical payload contract per event across public entry points', () => {
    expectTypeOf<PublicNotice>().toEqualTypeOf<RuntimeNotice>();
    expectTypeOf<PublicRequest>().toEqualTypeOf<RuntimeRequest>();
    expectTypeOf<PublicSystemEvent>().toEqualTypeOf<RuntimeSystemEvent>();
    expectTypeOf<Extract<keyof PublicSystemEvent, 'conversation' | 'actor' | 'target'>>().toBeNever();
    defineHandler({
      event: 'system.receive',
      handle(event) { expectTypeOf(event.payload).toEqualTypeOf<PublicSystemEvent>(); },
    });
    defineHandler({
      event: 'notice.receive',
      handle(event) {
        expectTypeOf(event.payload).toEqualTypeOf<PublicNotice>();
        expectTypeOf(event.client).toBeUnknown();
      },
    });
    defineHandler({
      event: 'request.receive',
      handle(event) {
        expectTypeOf(event.payload).toEqualTypeOf<PublicRequest>();
        expectTypeOf(event.payload.$approve).toBeFunction();
        expectTypeOf(event.client).toBeUnknown();
      },
    });
  });

  async function createFixture(onRequest?: (request: Request) => void) {
    const noticed: unknown[] = [];
    const systems: Array<{ payload: SystemEvent }> = [];
    const systemInteractions: unknown[] = [];
    const root = rootPluginId();
    const liveClient = Object.freeze({ tag: 'live-memory' });
    class MemoryEndpoint extends Endpoint<typeof liveClient> {
      readonly client = liveClient;
      start(): void {}
      open(): void {}
      close(): void {}
      stop(): void {}
      receive(name: string, payload: unknown) { return this.emit(name, payload); }
      send() { return 'ok'; }
    }
    const liveEndpoint = new MemoryEndpoint();
    const adapter = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'memory',
      source: '/adapters/memory.ts',
      definition: defineAdapter({
        capabilities: ['inbound', 'outbound'],
        create: () => liveEndpoint,
      }),
    });
    const noticeHandler = createCapabilitySlot({
      owner: root,
      feature: handlerFeatureId,
      localName: 'notice/receive',
      source: '/handlers/notice/receive.ts',
      definition: defineHandler({
        event: 'notice.receive',
        handle(event) {
          noticed.push(event);
        },
      }),
    });
    const systemHandler = createCapabilitySlot({
      owner: root,
      feature: handlerFeatureId,
      localName: 'system/receive',
      source: '/handlers/system/receive.ts',
      definition: defineHandler({
        event: 'system.receive',
        handle(event) {
          systems.push(event);
          systemInteractions.push(this.interaction);
          expect(event.payload.$client).toBe(liveClient);
        },
      }),
    });
    const requestHandler = onRequest ? createCapabilitySlot({
      owner: root,
      feature: handlerFeatureId,
      localName: 'request/receive',
      source: '/handlers/request/receive.ts',
      definition: defineHandler({
        event: 'request.receive',
        handle: (event) => onRequest(event.payload),
      }),
    }) : undefined;
    const slots = [adapter, noticeHandler, systemHandler, requestHandler].filter(
      (slot): slot is NonNullable<typeof slot> => slot != null,
    );
    const im = new ImRuntime();
    const base = {
      root,
      tree: new Map([[root, {
        id: root,
        instanceKey: 'root',
        packageName: 'test-root',
        packageRoot: '/tmp',
        children: [],
      }]]),
      config: new Map([[root, {}]]),
      resources: new Map([[root, new Map([[
        endpointEventGatewayToken.id,
        im.endpointEvents,
      ]])]]),
      capabilities: new Map(slots.map((slot) => [slot.id, slot])),
      projections: new Map(),
    };
    const view = createSnapshotView(0, base);
    const adapters = await AdapterIndex.create([adapter], view, new AbortController().signal);
    const projections = new Map<FeatureId, unknown>([
      [adapterFeatureId, adapters],
      [handlerFeatureId, new HandlerIndex([
        noticeHandler,
        systemHandler,
        ...(requestHandler ? [requestHandler] : []),
      ], view)],
    ]);
    const store = new SnapshotStore({ ...base, projections });
    im.attach(store);
    await adapters.start();
    adapters.open();
    return { im, noticed, systems, systemInteractions, liveClient, liveEndpoint, adapter,
      receive: liveEndpoint.receive.bind(liveEndpoint),
      close: async () => { await adapters.stop(); await store.close(); },
    };
  }

  it('receiveNotice dispatches generation-safe handlers', async () => {
    const { receive, noticed, liveClient, liveEndpoint, close } = await createFixture();
    const notice = buildNotice({}, {
      id: 'n1',
      clientAdapter: liveEndpoint.identity.adapter,
      endpointId: 'memory',
      type: 'notice',
      conversation: sideEventConversation('group', 'g1'),
      name: composeSideEventName('notice', 'group', 'member_increase'),
      timestamp: Date.now(),
    });
    await receive('notice.receive', notice);
    expect(noticed).toHaveLength(1);
    expect(noticed[0]).toMatchObject({
      name: 'notice.receive',
      payload: { ...notice, conversation: { ...notice.conversation, endpoint: liveEndpoint.identity }, generation: 0 },
      client: liveClient,
    });
    expect(() => (noticed[0] as { payload: Notice }).payload.$client).toThrow('expired');
    await close();
  });

  it('keeps ImRuntime request operation open until started actions settle', async () => {
    let release!: () => void;
    const action = new Promise<void>((resolve) => { release = resolve; });
    const approve = vi.fn(() => action);
    let captured: Request | undefined;
    const { receive, close } = await createFixture((request) => {
      captured = request;
      void request.$approve();
    });
    const request = buildRequest({}, {
      id: 'request-1',
      clientAdapter: 'memory',
      endpointId: 'memory',
      type: 'request',
      conversation: sideEventConversation('friend', 'u1'),
      name: composeSideEventName('request', 'friend', 'add'),
      actor: { id: 'u1' },
      timestamp: Date.now(),
      $approve: approve,
      $reject: async () => undefined,
    });
    let settled = false;
    const dispatch = receive('request.receive', request).finally(() => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(approve).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    release();
    await dispatch;
    await expect(captured?.$approve()).rejects.toThrow('action port expired');
    await close();
  });

  it('rejects an unregistered endpoint instead of inventing a canonical owner', async () => {
    const { im, systems, close } = await createFixture();
    await expect(im.endpointEvents.receive({
      name: 'system.receive',
      endpoint: { id: 'unregistered' as never, adapter: 'memory' },
      payload: buildSystem({}, { id: 's', type: 'system', name: 'system.online', timestamp: 0 }),
      client: {},
    })).rejects.toThrow('Unknown Adapter Endpoint');
    expect(systems).toHaveLength(0);
    await close();
  });

  it('receiveSystem dispatches system.receive handlers', async () => {
    const { receive, systems, systemInteractions, noticed, close } = await createFixture();
    const event = buildSystem({}, {
      id: 's1',
      clientAdapter: 'memory',
      endpointId: 'memory',
      type: 'system',
      name: composeSideEventName('system', 'login', 'qrcode'),
      timestamp: Date.now(),
    });
    await expect(receive('notice.receive', event)).rejects.toThrow('payload type does not match');
    await receive('system.receive', event);
    expect(systems).toHaveLength(1);
    expect((systems[0] as { payload: SystemEvent }).payload.name).toBe('system.login.qrcode');
    expect(systems[0]?.payload).toBeInstanceOf(SystemEvent);
    expect(systems[0]?.payload).not.toHaveProperty('conversation');
    expect(systems[0]?.payload).not.toHaveProperty('actor');
    expect(systems[0]?.payload).not.toHaveProperty('target');
    expect(() => systems[0]?.payload.$client).toThrow('expired');
    expect(systemInteractions).toEqual([undefined]);
    expect(noticed).toEqual([]);
    await close();
  });
});
