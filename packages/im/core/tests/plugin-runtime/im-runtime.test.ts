import { describe, expect, it } from 'vitest';
import {
  SnapshotStore,
  capabilityId,
  childPluginId,
  createCapabilitySlot,
  createSnapshotView,
  rootPluginId,
  type CapabilitySlot,
  type SnapshotState,
} from '@zhin.js/plugin-runtime';
import {
  AdapterIndex,
  adapterFeatureId,
  defineAdapter,
} from '@zhin.js/adapter';
import {
  CommandIndex,
  commandFeatureId,
  defineCommand,
} from '@zhin.js/command';
import {
  ComponentIndex,
  componentFeatureId,
  defineComponent,
} from '@zhin.js/component';
import {
  MiddlewareIndex,
  defineMiddleware,
  middlewareFeatureId,
} from '@zhin.js/middleware';
import {
  ImRuntime,
  Message,
  MessageDispatcher,
  component,
  raw,
  type OutboundEnvelope,
  type RuntimeMessageEvent,
  type SendContent,
} from '../../src/plugin-runtime/im/index.js';

describe('IM Runtime', () => {
  it('uses the matched child Command owner as the automatic reply requester', async () => {
    const root = rootPluginId();
    const child = childPluginId(root, 'child');
    const command = createCapabilitySlot({
      owner: child,
      feature: commandFeatureId,
      localName: 'status',
      source: '/plugins/child/commands/status.ts',
      definition: defineCommand({ execute: () => 'child result' }),
    });
    const state: SnapshotState = {
      root,
      tree: new Map([
        [root, {
          id: root,
          instanceKey: 'root',
          packageName: '@test/root',
          packageRoot: '/project',
          children: [child],
        }],
        [child, {
          id: child,
          instanceKey: 'child',
          packageName: '@test/child',
          packageRoot: '/project/plugins/child',
          parent: root,
          children: [],
        }],
      ]),
      config: new Map([[root, { commandPrefix: '/' }], [child, {}]]),
      resources: new Map([[root, new Map()], [child, new Map()]]),
      capabilities: new Map([[command.id, command]]),
      projections: new Map(),
    };
    const base = createSnapshotView(1, state);
    const snapshot = createSnapshotView(1, {
      ...state,
      projections: new Map([[commandFeatureId, new CommandIndex([command], base)]]),
    });
    let requester: unknown;
    const message = new Message(
      capabilityId(root, adapterFeatureId, 'memory'),
      'room',
      '/child status',
      1,
      async (_content, owner) => { requester = owner; },
    );

    await expect(new MessageDispatcher().dispatch(message, snapshot)).resolves.toMatchObject({
      matched: true,
      owner: child,
    });
    expect(requester).toBe(child);
  });

  it('resolves commandPrefix from the adapter instance config (default empty, endpoints override)', async () => {
    const root = rootPluginId();
    const command = createCapabilitySlot({
      owner: root,
      feature: commandFeatureId,
      localName: 'zt',
      source: '/commands/zt.ts',
      definition: defineCommand({ execute: () => 'card' }),
    });
    const makeSnapshot = (config: Record<string, unknown>) => {
      const state: SnapshotState = {
        root,
        tree: new Map([[root, {
          id: root,
          instanceKey: 'root',
          packageName: '@test/root',
          packageRoot: '/project',
          children: [],
        }]]),
        config: new Map([[root, config]]),
        resources: new Map([[root, new Map()]]),
        capabilities: new Map([[command.id, command]]),
        projections: new Map(),
      };
      const base = createSnapshotView(1, state);
      return createSnapshotView(1, {
        ...state,
        projections: new Map([[commandFeatureId, new CommandIndex([command], base)]]),
      });
    };
    const send = (content: string, metadata?: Record<string, unknown>) => new Message(
      capabilityId(root, adapterFeatureId, 'memory'),
      'room',
      content,
      1,
      async () => 'ok',
      undefined,
      undefined,
      metadata ? Object.freeze({ ...metadata }) : undefined,
    );

    // 默认 ''：无前缀直接匹配；带 / 反而不匹配
    await expect(new MessageDispatcher().dispatch(send('zt'), makeSnapshot({})))
      .resolves.toMatchObject({ matched: true });
    await expect(new MessageDispatcher().dispatch(send('/zt'), makeSnapshot({})))
      .resolves.toMatchObject({ matched: false });

    // 实例 config '/'：要求斜杠
    await expect(new MessageDispatcher().dispatch(send('/zt'), makeSnapshot({ commandPrefix: '/' })))
      .resolves.toMatchObject({ matched: true });
    await expect(new MessageDispatcher().dispatch(send('zt'), makeSnapshot({ commandPrefix: '/' })))
      .resolves.toMatchObject({ matched: false });

    // endpoints[i].commandPrefix 逐项覆盖顶层
    const snapshot = makeSnapshot({
      commandPrefix: '/',
      endpoints: [{ name: 'bot-1', commandPrefix: '!' }, { name: 'bot-2' }],
    });
    await expect(new MessageDispatcher().dispatch(send('!zt', { endpoint: 'bot-1' }), snapshot))
      .resolves.toMatchObject({ matched: true });
    await expect(new MessageDispatcher().dispatch(send('/zt', { endpoint: 'bot-2' }), snapshot))
      .resolves.toMatchObject({ matched: true });
    await expect(new MessageDispatcher().dispatch(send('!zt', { endpoint: 'bot-2' }), snapshot))
      .resolves.toMatchObject({ matched: false });
  });

  it('runs command, component, outbound middleware and Endpoint send in one lease', async () => {
    const events: string[] = [];
    const sent: unknown[] = [];
    const fixture = await createFixture(events, sent);

    const result = await fixture.im.receive({
      adapter: fixture.adapter.id,
      target: 'room-1',
      content: '/gh issue list open',
      sender: 'alice',
    });

    expect(result).toMatchObject({ matched: true, command: 'gh issue list' });
    expect(sent).toEqual([{
      target: 'room-1',
      payload: { text: 'open:alice:g0', hooked: true },
    }]);
    expect(events).toEqual([
      'endpoint:start',
      'endpoint:open',
      'inbound:enter',
      'command:open',
      'outbound:enter',
      'endpoint:send',
      'outbound:exit',
      'inbound:exit',
    ]);

    await fixture.adapters.stop();
    await fixture.store.close();
  });

  it('uses the same outbound path for active sends and expires captured reply scope', async () => {
    const sent: unknown[] = [];
    let captured: Message | undefined;
    const fixture = await createFixture([], sent, (message) => { captured = message; });

    await fixture.im.receive({
      adapter: fixture.adapter.id,
      target: 'room-1',
      content: 'ordinary message',
    });
    expect(captured).toBeInstanceOf(Message);
    expect(() => captured?.$reply('late')).toThrow('scope has ended');

    await fixture.im.send({
      adapter: fixture.adapter.id,
      target: 'room-2',
      requester: rootPluginId(),
      content: component('result', { state: 'active', sender: 'system' }),
    });
    expect(sent.at(-1)).toEqual({
      target: 'room-2',
      payload: { text: 'active:system:g0', hooked: true },
    });

    await fixture.adapters.stop();
    await fixture.store.close();
  });

  it('getEndpoint returns the same adapter type as listEndpoints (not live name)', async () => {
    const root = rootPluginId();
    const adapter = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'icqq',
      source: '/adapters/icqq.ts',
      definition: defineAdapter({
        capabilities: ['inbound', 'outbound'],
        create: () => ({
          name: '111111',
          management: {
            async listFriends() { return []; },
            async listGroups() { return []; },
            async kickGroupMember() {},
          },
          start() {},
          open() {},
          close() {},
          stop() {},
          send() { return { id: 'sent-1' }; },
        }),
      }),
    });
    const state: SnapshotState = {
      root,
      tree: new Map([[root, {
        id: root,
        instanceKey: 'root',
        packageName: '@zhin.js/adapter-icqq',
        packageRoot: '/project',
        children: [],
      }]]),
      config: new Map([[root, {}]]),
      resources: new Map([[root, new Map()]]),
      capabilities: new Map([[adapter.id, adapter]]),
      projections: new Map(),
    };
    const view = createSnapshotView(0, state);
    const adapters = await AdapterIndex.create([adapter], view);
    const store = new SnapshotStore({
      ...state,
      projections: new Map([[adapterFeatureId, adapters]]),
    });
    const im = new ImRuntime();
    im.attach(store);
    await adapters.start();
    adapters.open();

    const listed = im.listEndpoints();
    expect(listed).toEqual([expect.objectContaining({
      name: '111111',
      adapter: 'icqq',
      connected: true,
      status: 'online',
      managementCapabilities: ['listFriends', 'listGroups', 'kickGroupMember'],
    })]);

    // 用 slot localName 解析（inbox-installer 路径）
    expect(im.getEndpoint('icqq', 'icqq')).toEqual(expect.objectContaining({
      name: '111111',
      adapter: 'icqq',
      connected: true,
      status: 'online',
      managementCapabilities: ['listFriends', 'listGroups', 'kickGroupMember'],
    }));
    // 用 live name 解析（console endpoint.info 路径）
    expect(im.getEndpoint('icqq', '111111')).toEqual(expect.objectContaining({
      name: '111111',
      adapter: 'icqq',
    }));
    expect(im.getEndpointManagement('icqq', '111111')).toEqual(expect.objectContaining({
      listFriends: expect.any(Function),
      listGroups: expect.any(Function),
      kickGroupMember: expect.any(Function),
    }));
    expect(im.getEndpointManagement('missing', 'missing')).toBeNull();

    await adapters.stop();
    await store.close();
  });

  it('emits inbound and outbound message events via onMessage', async () => {
    const sent: unknown[] = [];
    const fixture = await createFixture([], sent);
    const events: RuntimeMessageEvent[] = [];
    const unsubscribe = fixture.im.onMessage((event) => events.push(event));

    await fixture.im.receive({
      adapter: fixture.adapter.id,
      target: 'group:room-1',
      content: 'hello console',
      sender: 'alice',
      id: 'msg-1',
    });

    const inbound = events.find((event) => event.direction === 'inbound');
    expect(inbound).toMatchObject({
      direction: 'inbound',
      adapter: fixture.adapter.id,
      target: 'group:room-1',
      sender: 'alice',
      channelType: 'group',
      contentPreview: 'hello console',
      messageId: 'msg-1',
    });
    expect(typeof inbound?.timestamp).toBe('number');

    // 未匹配消息也触发入站事件（无回复时仅有 inbound 一条）
    events.length = 0;
    await fixture.im.receive({
      adapter: fixture.adapter.id,
      target: 'room-2',
      content: 'no command here',
    });
    expect(events.map((event) => event.direction)).toEqual(['inbound']);

    await fixture.im.send({
      adapter: fixture.adapter.id,
      target: 'room-3',
      requester: rootPluginId(),
      content: raw({ text: 'outbound hello' }),
    });
    const outbound = events.find((event) => event.direction === 'outbound');
    expect(outbound).toMatchObject({
      direction: 'outbound',
      adapter: fixture.adapter.id,
      target: 'room-3',
      requester: rootPluginId(),
      contentPreview: 'outbound hello',
    });

    unsubscribe();
    events.length = 0;
    await fixture.im.receive({
      adapter: fixture.adapter.id,
      target: 'room-4',
      content: 'after unsubscribe',
    });
    expect(events).toEqual([]);

    await fixture.adapters.stop();
    await fixture.store.close();
  });

  it('truncates content previews to 200 chars and survives listener errors', async () => {
    const sent: unknown[] = [];
    const fixture = await createFixture([], sent);
    const events: RuntimeMessageEvent[] = [];
    fixture.im.onMessage(() => { throw new Error('broken listener'); });
    fixture.im.onMessage((event) => events.push(event));

    const longContent = 'x'.repeat(500);
    await fixture.im.receive({
      adapter: fixture.adapter.id,
      target: 'room-1',
      content: longContent,
    });

    const inbound = events.find((event) => event.direction === 'inbound');
    expect(inbound?.contentPreview).toHaveLength(201);
    expect(inbound?.contentPreview.endsWith('…')).toBe(true);
    expect(inbound?.contentPreview.startsWith('x'.repeat(200))).toBe(true);

    await fixture.adapters.stop();
    await fixture.store.close();
  });

  it('previews outbound wire segments as text', async () => {
    const sent: unknown[] = [];
    const fixture = await createFixture([], sent, undefined, undefined, undefined, {
      middleware: false,
    });
    const events: RuntimeMessageEvent[] = [];
    fixture.im.onMessage((event) => events.push(event));

    await fixture.im.send({
      adapter: fixture.adapter.id,
      target: 'room-1',
      requester: rootPluginId(),
      content: raw([
        { type: 'text', data: { text: 'part-a' } },
        { type: 'image', data: { base64: 'AAAA' } },
      ]),
    });

    const outbound = events.find((event) => event.direction === 'outbound');
    expect(outbound?.contentPreview).toBe('part-a[image]');

    await fixture.adapters.stop();
    await fixture.store.close();
  });

  it('keeps one generation for an in-flight inbound pipeline during commit', async () => {
    const sent: unknown[] = [];
    let releaseCommand!: () => void;
    let commandStarted!: () => void;
    const gate = new Promise<void>((resolve) => { releaseCommand = resolve; });
    const started = new Promise<void>((resolve) => { commandStarted = resolve; });
    const fixture = await createFixture([], sent, undefined, gate, commandStarted);
    let disposed = false;
    let current = fixture.store.current;
    fixture.store.commit(0, {
      snapshot: snapshotState(current),
      dispose: () => { disposed = true; },
    });

    const running = fixture.im.receive({
      adapter: fixture.adapter.id,
      target: 'room-1',
      content: '/gh issue list leased',
      sender: 'alice',
    });
    await started;
    current = fixture.store.current;
    fixture.store.commit(1, {
      snapshot: snapshotState(current),
      dispose: () => undefined,
    });
    expect(disposed).toBe(false);

    releaseCommand();
    await running;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(disposed).toBe(true);
    expect(sent).toEqual([{
      target: 'room-1',
      payload: { text: 'leased:alice:g1', hooked: true },
    }]);

    await fixture.adapters.stop();
    await fixture.store.close();
  });
});

async function createFixture(
  events: string[],
  sent: unknown[],
  capture?: (message: Message) => void,
  commandGate?: Promise<void>,
  commandStarted?: () => void,
  options?: { middleware?: boolean },
) {
  const root = rootPluginId();
  const adapter = createCapabilitySlot({
    owner: root,
    feature: adapterFeatureId,
    localName: 'memory',
    source: '/adapters/memory.ts',
    definition: defineAdapter({
      capabilities: ['inbound', 'outbound'],
      create: () => ({
        start() { events.push('endpoint:start'); },
        open() { events.push('endpoint:open'); },
        close() { events.push('endpoint:close'); },
        stop() { events.push('endpoint:stop'); },
        send(request) {
          events.push('endpoint:send');
          sent.push(request);
          return { id: 'sent-1' };
        },
      }),
    }),
  });
  const command = createCapabilitySlot({
    owner: root,
    feature: commandFeatureId,
    localName: 'gh/issue/list',
    source: '/commands/gh/issue/list.ts',
    definition: defineCommand<{}, SendContent, Message>({
      async execute({ args, input }) {
        events.push(`command:${args[0]}`);
        commandStarted?.();
        await commandGate;
        return component('result', {
          state: args[0],
          sender: input.sender,
          generation: input.generation,
        });
      },
    }),
  });
  const resultComponent = createCapabilitySlot({
    owner: root,
    feature: componentFeatureId,
    localName: 'result',
    source: '/components/result.ts',
    definition: defineComponent({
      render(props: { state: string; sender?: string; generation?: number }, context) {
        const generation = props.generation ?? context.generation;
        return raw({ text: `${props.state}:${props.sender ?? 'unknown'}:g${generation}` });
      },
    }),
  });
  const inbound = createCapabilitySlot({
    owner: root,
    feature: middlewareFeatureId,
    localName: 'inbound',
    source: '/middlewares/inbound.ts',
    definition: defineMiddleware<Message>({
      target: 'inbound',
      async handle({ input }, next) {
        capture?.(input);
        events.push('inbound:enter');
        await next();
        events.push('inbound:exit');
      },
    }),
  });
  const outbound = createCapabilitySlot({
    owner: root,
    feature: middlewareFeatureId,
    localName: 'outbound',
    source: '/middlewares/outbound.ts',
    definition: defineMiddleware<OutboundEnvelope>({
      target: 'outbound',
      async handle({ input }, next) {
        events.push('outbound:enter');
        input.replace({ ...(input.payload as object), hooked: true });
        await next();
        events.push('outbound:exit');
      },
    }),
  });
  const withMiddleware = options?.middleware !== false;
  const slots: readonly CapabilitySlot[] = [
    adapter,
    command,
    resultComponent,
    ...(withMiddleware ? [inbound, outbound] : []),
  ];
  const base = baseState(slots);
  const view = createSnapshotView(0, base);
  const adapters = await AdapterIndex.create([adapter], view);
  const projections = new Map([
    [adapterFeatureId, adapters],
    [commandFeatureId, new CommandIndex([command], view)],
    [componentFeatureId, new ComponentIndex([resultComponent], view)],
    ...(withMiddleware
      ? [[middlewareFeatureId, new MiddlewareIndex([inbound, outbound], view)] as const]
      : []),
  ]);
  const store = new SnapshotStore({ ...base, projections });
  const im = new ImRuntime();
  im.attach(store);
  await adapters.start();
  adapters.open();
  return { im, store, adapters, adapter };
}

function baseState(slots: readonly CapabilitySlot[]): SnapshotState {
  const root = rootPluginId();
  return {
    root,
    tree: new Map([[root, {
      id: root,
      instanceKey: 'root',
      packageName: '@test/root',
      packageRoot: '/project',
      children: [],
    }]]),
    config: new Map([[root, { commandPrefix: '/' }]]),
    resources: new Map([[root, new Map()]]),
    capabilities: new Map(slots.map((slot) => [slot.id, slot])),
    projections: new Map(),
  };
}

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
