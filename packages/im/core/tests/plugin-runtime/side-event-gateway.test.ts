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
import { receiveOneBotLikeSideEvent } from '../../src/side-event/dispatch.js';
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

  it('expires request action ports when gateway dispatch settles', async () => {
    let captured: IncomingRequest | undefined;
    const approve = vi.fn(async () => undefined);
    const emit: EndpointEventEmitter = async (name, payload) => {
      if (name === 'request.receive') captured = payload as IncomingRequest;
    };
    await receiveOneBotLikeSideEvent(emit, {
      adapter: 'onebot11',
      endpointKey: 'bot',
      raw: { post_type: 'request', request_type: 'friend', flag: 'f1', user_id: 'u1' },
      approve,
    });
    await expect(captured?.$approve()).rejects.toThrow('action port expired');
    expect(approve).not.toHaveBeenCalled();
  });

  it('keeps request dispatch alive until fire-and-forget actions settle', async () => {
    let release!: () => void;
    const action = new Promise<void>((resolve) => { release = resolve; });
    let captured: IncomingRequest | undefined;
    const approve = vi.fn(() => action);
    let dispatchSettled = false;
    const emit: EndpointEventEmitter = async (name, payload) => {
      if (name !== 'request.receive') return;
      const request = payload as IncomingRequest;
      captured = request;
      void request.$approve();
    };
    const dispatch = receiveOneBotLikeSideEvent(emit, {
      adapter: 'onebot11',
      endpointKey: 'bot',
      raw: { post_type: 'request', request_type: 'friend', flag: 'f1', user_id: 'u1' },
      approve,
    }).finally(() => { dispatchSettled = true; });

    await Promise.resolve();
    await Promise.resolve();
    expect(approve).toHaveBeenCalledOnce();
    expect(dispatchSettled).toBe(false);
    release();
    await expect(dispatch).resolves.toBe('request');
    await expect(captured?.$approve()).rejects.toThrow('action port expired');
  });

  it('normalizes member targets and reaction operations at the adapter boundary', async () => {
    const receiveNotice = vi.fn(async (_notice: unknown) => undefined);
    const emit: EndpointEventEmitter = async (name, payload) => {
      if (name === 'notice.receive') await receiveNotice(payload);
    };
    await receiveOneBotLikeSideEvent(emit, {
      adapter: 'onebot11',
      endpointKey: 'bot',
      raw: { post_type: 'notice', notice_type: 'group_increase', group_id: 1, user_id: 2, time: 3 },
    });
    await receiveOneBotLikeSideEvent(emit, {
      adapter: 'onebot11',
      endpointKey: 'bot',
      platform: 'slack',
      raw: { post_type: 'notice', notice_type: 'reaction_removed', group_id: 1, user_id: 2, message_id: 4, code: 'x', time: 5 },
    });

    expect(receiveNotice.mock.calls[0]?.[0]).toMatchObject({
      name: 'notice.group.member_increase',
      actor: undefined,
      target: { id: '2' },
    });
    expect(receiveNotice.mock.calls[1]?.[0]).toMatchObject({
      name: 'notice.group.emoji_reaction',
      operation: 'removed',
      messageId: '4',
    });
  });

  it('does not use a user or bot id as a missing group conversation', async () => {
    const emit = vi.fn(async (_name: string, _payload: unknown) => undefined);
    await receiveOneBotLikeSideEvent(emit, {
      adapter: 'onebot11', endpointKey: 'bot',
      raw: { post_type: 'notice', notice_type: 'group_increase', user_id: 2, time: 3 },
    });
    expect(emit).toHaveBeenCalledWith('notice.receive', expect.objectContaining({ conversation: undefined }));
  });

  it.each([
    [{ post_type: 'system.login.qrcode' }, 'system.login.qrcode'],
    [{ post_type: 'system.online' }, 'system.online'],
    [{ post_type: 'meta_event', meta_event_type: 'lifecycle', sub_type: 'connect' }, 'system.lifecycle.connect'],
  ])('preserves independent system names for %j', async (raw, name) => {
    const emit = vi.fn(async (_name: string, _payload: unknown) => undefined);
    await receiveOneBotLikeSideEvent(emit, { adapter: 'onebot11', endpointKey: 'bot', raw });
    expect(emit).toHaveBeenCalledWith('system.receive', expect.objectContaining({ type: 'system', name }));
    expect(emit.mock.calls[0]?.[1]).not.toHaveProperty('conversation');
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
    const { receive, noticed, liveClient, adapter, close } = await createFixture();
    const notice = buildNotice({}, {
      id: 'n1',
      clientAdapter: 'memory',
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
      payload: { ...notice, conversation: { ...notice.conversation, endpoint: { id: adapter.id, adapter: String(adapter.owner) } }, generation: 0 },
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
