import { describe, expect, it, vi } from 'vitest';
import {
  SnapshotStore,
  createCapabilitySlot,
  createSnapshotView,
  rootPluginId,
} from '@zhin.js/plugin-runtime';
import {
  AdapterIndex,
  adapterFeatureId,
  defineAdapter,
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
    await receiveOneBotLikeSideEvent({
      receiveNotice: vi.fn(async () => undefined),
      receiveSystem: vi.fn(async () => undefined),
      receiveRequest: vi.fn(async (request) => { captured = request; }),
    }, {
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
    const dispatch = receiveOneBotLikeSideEvent({
      receiveNotice: vi.fn(async () => undefined),
      receiveSystem: vi.fn(async () => undefined),
      receiveRequest: vi.fn(async (request) => {
        captured = request;
        void request.$approve();
      }),
    }, {
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

  async function createFixture(onRequest?: (request: Request) => void) {
    const noticed: unknown[] = [];
    const systems: unknown[] = [];
    const root = rootPluginId();
    const liveEndpoint = Object.freeze({
      start() {},
      open() {},
      close() {},
      stop() {},
      send() { return 'ok'; },
      tag: 'live-memory',
    });
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
        handle(notice) {
          noticed.push(notice);
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
        handle: onRequest,
      }),
    }) : undefined;
    const slots = [adapter, noticeHandler, systemHandler, requestHandler].filter(
      (slot): slot is NonNullable<typeof slot> => slot != null,
    );
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
      resources: new Map([[root, new Map()]]),
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
    const im = new ImRuntime();
    im.attach(store);
    await adapters.start();
    adapters.open();
    return { im, noticed, systems, adapterLocalName: 'memory' };
  }

  it('receiveNotice dispatches generation-safe handlers', async () => {
    const { im, noticed } = await createFixture();
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
    await im.receiveNotice(notice);
    expect(noticed).toHaveLength(1);
    expect('$liveEndpoint' in (noticed[0] as object)).toBe(false);
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
    const dispatch = im.receiveRequest(request).finally(() => { settled = true; });
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
    await im.receiveSystem(event);
    expect(systems).toHaveLength(1);
    expect((systems[0] as { $sub_type?: string }).$sub_type).toBe('qrcode');
  });
});
