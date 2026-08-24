import { describe, expect, it, vi } from 'vitest';
import {
  SnapshotStore,
  createCapabilitySlot,
  createSnapshotView,
  rootPluginId,
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
import { ImRuntime } from '../../src/plugin-runtime/im/index.js';
import { Notice } from '../../src/notice.js';
import { SystemEvent } from '../../src/system-event.js';
import { receiveOneBotLikeSideEvent } from '../../src/side-event/dispatch.js';
import { Request } from '../../src/request.js';

describe('ImRuntime side-event handlers', () => {
  it('expires request action ports when gateway dispatch settles', async () => {
    let captured: Request | undefined;
    const approve = vi.fn(async () => undefined);
    const emit: EndpointEventEmitter = async (name, payload) => {
      if (name === 'request.receive') captured = payload as Request;
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
    let captured: Request | undefined;
    const approve = vi.fn(() => action);
    let dispatchSettled = false;
    const emit: EndpointEventEmitter = async (name, payload) => {
      if (name !== 'request.receive') return;
      const request = payload as Request;
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
    const receiveNotice = vi.fn(async () => undefined);
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
      $sub_type: 'member_increase',
      $actor: undefined,
      $target: { id: '2' },
    });
    expect(receiveNotice.mock.calls[1]?.[0]).toMatchObject({
      $sub_type: 'emoji_reaction',
      $operation: 'removed',
      $message_id: '4',
    });
  });

  async function createFixture(onRequest?: (request: Request) => void) {
    const noticed: unknown[] = [];
    const systems: unknown[] = [];
    const root = rootPluginId();
    const liveClient = Object.freeze({ tag: 'live-memory' });
    class MemoryEndpoint extends Endpoint<typeof liveClient> {
      readonly client = liveClient;
      start(): void {}
      open(): void {}
      close(): void {}
      stop(): void {}
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
    const projections = new Map([
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
    return { im, noticed, systems, liveClient, adapterLocalName: 'memory' };
  }

  it('receiveNotice dispatches generation-safe handlers', async () => {
    const { im, noticed, liveClient } = await createFixture();
    const notice = Notice.from({}, {
      $id: 'n1',
      $adapter: 'memory' as never,
      $endpoint: 'memory',
      $type: 'notice',
      $scene_id: 'g1',
      $scene_type: 'group',
      $sub_type: 'member_increase',
      $timestamp: Date.now(),
    });
    await receiveEndpointEvent(im, 'notice.receive', notice, liveClient);
    expect(noticed).toHaveLength(1);
    expect(noticed[0]).toMatchObject({
      name: 'notice.receive',
      payload: notice,
      client: liveClient,
    });
  });

  it('keeps ImRuntime request operation open until started actions settle', async () => {
    let release!: () => void;
    const action = new Promise<void>((resolve) => { release = resolve; });
    const approve = vi.fn(() => action);
    let captured: Request | undefined;
    const { im } = await createFixture((request) => {
      captured = request;
      void request.$approve();
    });
    const request = Request.from({}, {
      $id: 'request-1',
      $adapter: 'memory' as never,
      $endpoint: 'memory',
      $type: 'request',
      $scene_id: 'u1',
      $scene_type: 'friend',
      $sub_type: 'add',
      $actor: { id: 'u1' },
      $timestamp: Date.now(),
      $approve: approve,
      $reject: async () => undefined,
    });
    let settled = false;
    const dispatch = receiveEndpointEvent(im, 'request.receive', request, {}).finally(() => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(approve).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    release();
    await dispatch;
    await expect(captured?.$approve()).rejects.toThrow('action port expired');
  });

  it('receiveSystem dispatches system.receive handlers', async () => {
    const { im, systems } = await createFixture();
    const event = SystemEvent.from({}, {
      $id: 's1',
      $adapter: 'memory' as never,
      $endpoint: 'memory',
      $type: 'system',
      $scene_id: 'memory',
      $scene_type: 'login',
      $sub_type: 'qrcode',
      $timestamp: Date.now(),
    });
    await receiveEndpointEvent(im, 'system.receive', event, {});
    expect(systems).toHaveLength(1);
    expect((systems[0] as { payload?: { $sub_type?: string } }).payload?.$sub_type).toBe('qrcode');
  });
});

function receiveEndpointEvent(
  im: ImRuntime,
  name: string,
  payload: unknown,
  client: object,
): Promise<unknown> {
  return im.endpointEvents.receive(Object.freeze({
    name,
    payload,
    endpoint: Object.freeze({ id: 'memory' as never, adapter: 'memory' }),
    client,
  }));
}
