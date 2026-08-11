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
  type EndpointControl,
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
import { resetKeyboardFallbackStoreForTests } from '../../src/built/interactive-segments/index.js';

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
      {
        endpoint: {
          id: String(capabilityId(root, adapterFeatureId, 'memory')),
          adapter: String(root),
        },
        kind: 'private',
        id: 'room',
      },
      '/child.status',
      1,
      async (_content, owner) => { requester = owner; return { status: 'sent' }; },
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
      {
        endpoint: {
          id: String(capabilityId(root, adapterFeatureId, 'memory')),
          adapter: String(root),
        },
        kind: 'private',
        id: 'room',
      },
      content,
      1,
      async () => ({ status: 'sent' as const }),
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

  it('matches structured Command parameters after stripping commandPrefix', async () => {
    const root = rootPluginId();
    const media = Object.freeze({
      kind: 'url' as const,
      value: 'https://example.com/photo.png',
    });
    const command = createCapabilitySlot({
      owner: root,
      feature: commandFeatureId,
      localName: 'upload/$asset',
      source: '/commands/upload/[asset].ts',
      definition: {
        ...defineCommand({
          execute: ({ params }) =>
            (params.asset as typeof media).value,
        }),
        $parameter: { name: 'asset', type: 'image' } as const,
      },
    });
    const state: SnapshotState = {
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
      capabilities: new Map([[command.id, command]]),
      projections: new Map(),
    };
    const base = createSnapshotView(1, state);
    const snapshot = createSnapshotView(1, {
      ...state,
      projections: new Map([[commandFeatureId, new CommandIndex([command], base)]]),
    });
    const message = new Message(
      {
        endpoint: {
          id: String(capabilityId(root, adapterFeatureId, 'memory')),
          adapter: String(root),
        },
        kind: 'private',
        id: 'room',
      },
      '/upload',
      1,
      async () => ({ status: 'sent' as const }),
      undefined,
      undefined,
      Object.freeze([
        { type: 'text', data: { text: '/upload ' } },
        { type: 'image', data: { media } },
      ]),
    );

    await expect(new MessageDispatcher().dispatch(message, snapshot)).resolves.toMatchObject({
      matched: true,
      command: 'upload <asset>',
      value: media.value,
    });
  });

  it('runs command, component, outbound middleware and Endpoint send in one lease', async () => {
    const events: string[] = [];
    const sent: unknown[] = [];
    const fixture = await createFixture(events, sent);

    const result = await fixture.im.receive({
      conversation: {
        endpoint: { id: String(fixture.adapter.id), adapter: String(rootPluginId()) },
        kind: 'private' as const,
        id: 'room-1',
      },
      content: '/gh issue list open',
      sender: { id: 'alice' },
    });

    expect(result).toMatchObject({ matched: true, command: 'gh issue list' });
    expect(sent).toEqual([expect.objectContaining({
      conversation: expect.objectContaining({ kind: 'private', id: 'room-1' }),
      payload: { text: 'open:alice:g0', hooked: true },
    })]);
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
      conversation: {
        endpoint: { id: String(fixture.adapter.id), adapter: String(rootPluginId()) },
        kind: 'private' as const,
        id: 'room-1',
      },
      content: 'ordinary message',
    });
    expect(captured).toBeInstanceOf(Message);
    expect(() => captured?.$reply('late')).toThrow('scope has ended');

    await fixture.im.send({
      conversation: {
        endpoint: { id: String(fixture.adapter.id), adapter: String(rootPluginId()) },
        kind: 'private' as const,
        id: 'room-2',
      },
      requester: rootPluginId(),
      content: component('result', { state: 'active', sender: 'system' }),
    });
    expect(sent.at(-1)).toEqual(expect.objectContaining({
      conversation: expect.objectContaining({ kind: 'private', id: 'room-2' }),
      payload: { text: 'active:system:g0', hooked: true },
    }));

    await fixture.adapters.stop();
    await fixture.store.close();
  });

  it('passes structured conversations through Core and anchors host send addresses', async () => {
    const sent: unknown[] = [];
    const fixture = await createFixture([], sent);
    const conversation = {
      endpoint: { id: String(fixture.adapter.id), adapter: String(rootPluginId()) },
      kind: 'group' as const,
      id: 'room-1',
    };

    await fixture.im.send({
      conversation,
      requester: rootPluginId(),
      content: 'structured send',
    });
    expect(sent.at(-1)).toEqual(expect.objectContaining({
      conversation,
    }));

    await fixture.im.sendEndpointMessage({
      adapter: 'memory',
      endpointId: 'memory',
      conversation,
      content: 'host structured send',
    });
    expect(sent.at(-1)).toEqual(expect.objectContaining({
      conversation,
    }));

    await fixture.adapters.stop();
    await fixture.store.close();
  });

  it('accepts MessageRef and ConversationRef at Core control methods', async () => {
    const calls: string[] = [];
    const control: EndpointControl = {
      recall: async (message) => { calls.push(`recall:${String(message)}`); },
      edit: async (message, content) => {
        calls.push(`edit:${String(message)}:${String(content)}`);
        return 'edited';
      },
      addReaction: async (message, emoji) => {
        calls.push(`reaction:${String(message)}:${emoji}`);
        return emoji;
      },
      typing: async (conversation, active) => {
        const target = typeof conversation === 'string'
          ? conversation
          : `${conversation.kind}:${conversation.id}`;
        calls.push(`typing:${target}:${String(active)}`);
      },
    };
    const fixture = await createFixture([], [], undefined, undefined, undefined, { endpointControl: control });
    const conversation = {
      endpoint: { id: String(fixture.adapter.id), adapter: String(rootPluginId()) },
      kind: 'group' as const,
      id: 'room-1',
    };
    const message = { conversation, id: 'message-1' };

    await fixture.im.recallEndpointMessage({ adapter: 'memory', endpointId: 'memory', message });
    await expect(fixture.im.editEndpointMessage({
      adapter: 'memory', endpointId: 'memory', message, content: 'updated',
    })).resolves.toBe('edited');
    await expect(fixture.im.addEndpointReaction({
      adapter: 'memory', endpointId: 'memory', message, emoji: '👍',
    })).resolves.toBe('👍');
    await fixture.im.setEndpointTyping({
      adapter: 'memory', endpointId: 'memory', conversation, active: true,
    });

    expect(calls).toEqual([
      'recall:group:room-1:message-1',
      'edit:group:room-1:message-1:updated',
      'reaction:group:room-1:message-1:👍',
      'typing:group:room-1:true',
    ]);
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
    // tree 仅 root → plugins=0；endpoints 与 listEndpoints 对齐
    expect(im.inventory()).toEqual({
      plugins: 0,
      endpoints: { total: 1, online: 1 },
    });

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

    const groupConversation = {
      endpoint: { id: String(fixture.adapter.id), adapter: String(rootPluginId()) },
      kind: 'group' as const,
      id: 'room-1',
    };
    await fixture.im.receive({
      conversation: groupConversation,
      message: { conversation: groupConversation, id: 'msg-1' },
      content: 'hello console',
      sender: { id: 'alice' },
    });

    const inbound = events.find((event) => event.direction === 'inbound');
    expect(inbound).toMatchObject({
      direction: 'inbound',
      conversation: groupConversation,
      sender: { id: 'alice' },
      contentPreview: 'hello console',
      messageId: 'msg-1',
    });
    expect(typeof inbound?.timestamp).toBe('number');

    // 未匹配消息也触发入站事件（无回复时仅有 inbound 一条）
    events.length = 0;
    await fixture.im.receive({
      conversation: {
        endpoint: { id: String(fixture.adapter.id), adapter: String(rootPluginId()) },
        kind: 'private' as const,
        id: 'room-2',
      },
      content: 'no command here',
    });
    expect(events.map((event) => event.direction)).toEqual(['inbound']);

    await fixture.im.send({
      conversation: {
        endpoint: { id: String(fixture.adapter.id), adapter: String(rootPluginId()) },
        kind: 'private' as const,
        id: 'room-3',
      },
      requester: rootPluginId(),
      content: raw({ text: 'outbound hello' }),
    });
    const outbound = events.find((event) => event.direction === 'outbound');
    expect(outbound).toMatchObject({
      direction: 'outbound',
      conversation: {
        endpoint: { id: String(fixture.adapter.id), adapter: String(rootPluginId()) },
        kind: 'private',
        id: 'room-3',
      },
      requester: rootPluginId(),
      contentPreview: 'outbound hello',
    });

    unsubscribe();
    events.length = 0;
    await fixture.im.receive({
      conversation: {
        endpoint: { id: String(fixture.adapter.id), adapter: String(rootPluginId()) },
        kind: 'private' as const,
        id: 'room-4',
      },
      content: 'after unsubscribe',
    });
    expect(events).toEqual([]);

    await fixture.adapters.stop();
    await fixture.store.close();
  });

  it('returns a suppressed receipt and publishes no outbound event when middleware stops the chain', async () => {
    const sent: unknown[] = [];
    const fixture = await createFixture([], sent, undefined, undefined, undefined, {
      outboundMiddleware: async () => undefined,
    });
    const events: RuntimeMessageEvent[] = [];
    fixture.im.onMessage((event) => events.push(event));

    await expect(fixture.im.send({
      conversation: {
        endpoint: { id: String(fixture.adapter.id), adapter: String(rootPluginId()) },
        kind: 'private' as const,
        id: 'room-1',
      },
      requester: rootPluginId(),
      content: 'do not send',
    })).resolves.toEqual({ status: 'suppressed' });
    expect(sent).toEqual([]);
    expect(events.filter((event) => event.direction === 'outbound')).toEqual([]);

    await fixture.adapters.stop();
    await fixture.store.close();
  });

  it('normalizes middleware replacement before the endpoint and emits only after a sent receipt', async () => {
    const sent: unknown[] = [];
    const fixture = await createFixture([], sent, undefined, undefined, undefined, {
      outboundMiddleware: async (input, next) => {
        input.replace([{ type: 'image', data: { url: 'https://cdn.example/replaced.png' } }]);
        await next();
      },
    });
    const events: RuntimeMessageEvent[] = [];
    fixture.im.onMessage((event) => events.push(event));

    const receipt = await fixture.im.send({
      conversation: {
        endpoint: { id: String(fixture.adapter.id), adapter: String(rootPluginId()) },
        kind: 'private' as const,
        id: 'room-1',
      },
      requester: rootPluginId(),
      content: 'initial payload',
    });

    expect(receipt).toEqual({ status: 'sent', legacyMessageId: 'sent-1' });
    expect(sent).toContainEqual(expect.objectContaining({
      conversation: expect.objectContaining({ kind: 'private', id: 'room-1' }),
      payload: [{
        type: 'image',
        data: { media: { kind: 'url', value: 'https://cdn.example/replaced.png' } },
      }],
    }));
    expect(events.filter((event) => event.direction === 'outbound')).toEqual([
      expect.objectContaining({ contentPreview: '[image]', messageId: 'sent-1' }),
    ]);

    await fixture.adapters.stop();
    await fixture.store.close();
  });

  it('rejects an invalid segment introduced by outbound middleware before endpoint delivery', async () => {
    const sent: unknown[] = [];
    const fixture = await createFixture([], sent, undefined, undefined, undefined, {
      outboundMiddleware: async (input, next) => {
        input.replace([{ type: 'text', data: {} }]);
        await next();
      },
    });
    const events: RuntimeMessageEvent[] = [];
    fixture.im.onMessage((event) => events.push(event));

    await expect(fixture.im.send({
      conversation: {
        endpoint: { id: String(fixture.adapter.id), adapter: String(rootPluginId()) },
        kind: 'private' as const,
        id: 'room-1',
      },
      requester: rootPluginId(),
      content: 'initial payload',
    })).resolves.toMatchObject({ status: 'rejected', failure: { code: 'outbound_payload_rejected' } });
    expect(sent).toEqual([]);
    expect(events.filter((event) => event.direction === 'outbound')).toEqual([]);

    await fixture.adapters.stop();
    await fixture.store.close();
  });

  it('returns failed and unsupported receipts without publishing outbound events', async () => {
    const failed = await createFixture([], [], undefined, undefined, undefined, {
      endpointSend: () => { throw new Error('transport closed'); },
    });
    const failedEvents: RuntimeMessageEvent[] = [];
    failed.im.onMessage((event) => failedEvents.push(event));
    await expect(failed.im.send({
      conversation: {
        endpoint: { id: String(failed.adapter.id), adapter: String(rootPluginId()) },
        kind: 'private' as const,
        id: 'room-1',
      },
      requester: rootPluginId(),
      content: 'will fail',
    })).resolves.toMatchObject({ status: 'failed', failure: { code: 'endpoint_send_failed' } });
    expect(failedEvents.filter((event) => event.direction === 'outbound')).toEqual([]);
    await failed.adapters.stop();
    await failed.store.close();

    const unsupported = await createFixture([], [], undefined, undefined, undefined, {
      adapterCapabilities: ['inbound'],
    });
    const unsupportedEvents: RuntimeMessageEvent[] = [];
    unsupported.im.onMessage((event) => unsupportedEvents.push(event));
    await expect(unsupported.im.send({
      conversation: {
        endpoint: { id: String(unsupported.adapter.id), adapter: String(rootPluginId()) },
        kind: 'private' as const,
        id: 'room-1',
      },
      requester: rootPluginId(),
      content: 'not supported',
    })).resolves.toMatchObject({ status: 'unsupported', failure: { code: 'outbound_unsupported' } });
    expect(unsupportedEvents.filter((event) => event.direction === 'outbound')).toEqual([]);
    await unsupported.adapters.stop();
    await unsupported.store.close();
  });

  it('truncates content previews to 200 chars and survives listener errors', async () => {
    const sent: unknown[] = [];
    const fixture = await createFixture([], sent);
    const events: RuntimeMessageEvent[] = [];
    fixture.im.onMessage(() => { throw new Error('broken listener'); });
    fixture.im.onMessage((event) => events.push(event));

    const longContent = 'x'.repeat(500);
    await fixture.im.receive({
      conversation: {
        endpoint: { id: String(fixture.adapter.id), adapter: String(rootPluginId()) },
        kind: 'private' as const,
        id: 'room-1',
      },
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
      conversation: {
        endpoint: { id: String(fixture.adapter.id), adapter: String(rootPluginId()) },
        kind: 'private' as const,
        id: 'room-1',
      },
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
      conversation: {
        endpoint: { id: String(fixture.adapter.id), adapter: String(rootPluginId()) },
        kind: 'private' as const,
        id: 'room-1',
      },
      content: '/gh issue list leased',
      sender: { id: 'alice' },
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
    expect(sent).toEqual([expect.objectContaining({
      conversation: expect.objectContaining({ kind: 'private', id: 'room-1' }),
      payload: { text: 'leased:alice:g1', hooked: true },
    })]);

    await fixture.adapters.stop();
    await fixture.store.close();
  });

  it('interactive 中央执行：text 端点 keyboard 降级 + 数字/action 回跳路由', async () => {
    const sent: unknown[] = [];
    const fixture = await createFixture([], sent, undefined, undefined, undefined, {
      middleware: false,
    });
    resetKeyboardFallbackStoreForTests();
    const handled: string[] = [];
    fixture.im.registerInteractiveHandler('hub:', async (message) => {
      handled.push(message.content);
      return true;
    });

    await fixture.im.send({
      conversation: {
        endpoint: { id: String(fixture.adapter.id), adapter: String(rootPluginId()) },
        kind: 'group' as const,
        id: 'room-1',
      },
      requester: rootPluginId(),
      content: raw([
        { type: 'text', data: { text: '🎮 游戏大厅' } },
        {
          type: 'keyboard',
          data: {
            rows: [[
              { id: 'g1', label: '井字棋', payload: 'hub:h1:g_ttt' },
              { id: 'g2', label: '猜数字', payload: 'hub:h1:g_guess' },
            ]],
            fallback: {
              hint: '回复数字进入对应游戏',
              map: { '1': 'hub:h1:g_ttt', '2': 'hub:h1:g_guess' },
            },
          },
        },
      ]),
    });

    // 'text' 端点（默认策略）：keyboard 降级为编号文本
    const outbound = sent.at(-1) as { payload: Array<{ type: string; data: { text?: string } }> };
    expect(outbound.payload[1]?.type).toBe('text');
    expect(outbound.payload[1]?.data.text).toContain('回复数字进入对应游戏');
    expect(outbound.payload[1]?.data.text).toContain('1. 井字棋');
    expect(outbound.payload[1]?.data.text).toContain('2. 猜数字');

    // 数字回跳 → 中央 fallback map → handler
    const digit = await fixture.im.receive({
      conversation: {
        endpoint: { id: String(fixture.adapter.id), adapter: String(rootPluginId()) },
        kind: 'group' as const,
        id: 'room-1',
      },
      content: '2',
      sender: { id: 'alice' },
    });
    expect(digit).toMatchObject({ matched: true, command: 'interactive' });
    expect(handled).toEqual(['2']);

    // 平台 callback action 段 → handler
    const action = await fixture.im.receive({
      conversation: {
        endpoint: { id: String(fixture.adapter.id), adapter: String(rootPluginId()) },
        kind: 'group' as const,
        id: 'room-1',
      },
      content: '[action: hub:h1:g_ttt]',
      sender: { id: 'bob' },
      segments: [{ type: 'action', data: { id: 'cb1', payload: 'hub:h1:g_ttt' } }],
    });
    expect(action).toMatchObject({ matched: true, command: 'interactive' });
    expect(handled).toEqual(['2', '[action: hub:h1:g_ttt]']);

    // 无匹配 payload 的普通消息不受影响
    const miss = await fixture.im.receive({
      conversation: {
        endpoint: { id: String(fixture.adapter.id), adapter: String(rootPluginId()) },
        kind: 'group' as const,
        id: 'room-1',
      },
      content: 'ordinary message',
    });
    expect(miss.matched).toBe(false);

    resetKeyboardFallbackStoreForTests();
    await fixture.adapters.stop();
    await fixture.store.close();
  });

  it("interactive 中央执行：声明 'native' 的端点透传 keyboard", async () => {
    const sent: unknown[] = [];
    const fixture = await createFixture([], sent, undefined, undefined, undefined, {
      middleware: false,
      adapterSegments: { interactive: 'native' },
    });
    const keyboard = {
      type: 'keyboard',
      data: { rows: [[{ id: 'a', label: '甲', payload: 'x:s:a' }]] },
    };
    await fixture.im.send({
      conversation: {
        endpoint: { id: String(fixture.adapter.id), adapter: String(rootPluginId()) },
        kind: 'private' as const,
        id: 'room-1',
      },
      requester: rootPluginId(),
      content: raw([keyboard]),
    });
    expect((sent.at(-1) as { payload: unknown[] }).payload).toEqual([keyboard]);

    await fixture.adapters.stop();
    await fixture.store.close();
  });

  it('passes inbound segments through to the Message (frozen, optional)', async () => {    const sent: unknown[] = [];
    let captured: Message | undefined;
    const fixture = await createFixture([], sent, (message) => { captured = message; });
    const conversation = {
      endpoint: { id: String(fixture.adapter.id), adapter: String(rootPluginId()) },
      kind: 'group' as const,
      id: 'room-1',
    };
    const messageRef = { conversation, id: 'message-1' };
    const segments = [
      { type: 'text', data: { text: '看图' } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://cdn.example/a.jpg' } } },
    ] as const;

    await fixture.im.receive({
      conversation,
      message: messageRef,
      content: '看图[image]',
      sender: { id: 'alice' },
      segments,
    });
    expect(captured?.segments).toEqual(segments);
    expect(Object.isFrozen(captured?.segments)).toBe(true);
    // 段数组是独立拷贝，调用方后续 mutate 不影响 Message
    expect(captured?.segments).not.toBe(segments);
    expect(captured?.conversation).toEqual(conversation);
    expect(captured?.message).toEqual(messageRef);
    expect(captured?.id).toBe('message-1');

    await fixture.im.receive({
      conversation: {
        endpoint: { id: String(fixture.adapter.id), adapter: String(rootPluginId()) },
        kind: 'private' as const,
        id: 'room-2',
      },
      content: 'plain text only',
    });
    expect(captured?.segments).toBeUndefined();
    expect(captured?.content).toBe('plain text only');

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
  options?: {
    middleware?: boolean;
    adapterSegments?: { interactive?: 'native' | 'text'; outboundMedia?: readonly ('url' | 'path' | 'base64' | 'upload')[] };
    adapterCapabilities?: readonly ('inbound' | 'outbound')[];
    endpointSend?: (request: unknown) => unknown;
    endpointControl?: EndpointControl;
    outboundMiddleware?: (input: OutboundEnvelope, next: () => Promise<void>) => Promise<void> | void;
  },
) {
  const root = rootPluginId();
  const adapter = createCapabilitySlot({
    owner: root,
    feature: adapterFeatureId,
    localName: 'memory',
    source: '/adapters/memory.ts',
    definition: defineAdapter({
      capabilities: options?.adapterCapabilities ?? ['inbound', 'outbound'],
      ...(options?.adapterSegments ? { segments: options.adapterSegments } : {}),
      create: () => ({
        ...(options?.endpointControl ? { control: options.endpointControl } : {}),
        start() { events.push('endpoint:start'); },
        open() { events.push('endpoint:open'); },
        close() { events.push('endpoint:close'); },
        stop() { events.push('endpoint:stop'); },
        send(request) {
          events.push('endpoint:send');
          sent.push(request);
          return options?.endpointSend?.(request) ?? { id: 'sent-1' };
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
          sender: input.sender?.id,
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
        if (options?.outboundMiddleware) return options.outboundMiddleware(input, next);
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

describe('Message.$sendTo', () => {
  it('sends to a different conversation on the same endpoint', async () => {
    const sent: Array<{ conversation: unknown; content: unknown }> = [];
    const endpoint = {
      id: 'slot-1',
      adapter: 'root',
    };
    const message = new Message(
      { endpoint, kind: 'group', id: 'original-group' },
      'hello',
      1,
      async (content, _requester, targetConversation) => {
        const effectiveConversation = targetConversation
          ? { endpoint, ...targetConversation }
          : { endpoint, kind: 'group' as const, id: 'original-group' };
        sent.push({ conversation: effectiveConversation, content });
        return { status: 'sent' as const };
      },
    );

    await message.$sendTo({ kind: 'private', id: 'user-123' }, '私信通知');

    expect(sent).toHaveLength(1);
    expect(sent[0]!.conversation).toEqual({
      endpoint,
      kind: 'private',
      id: 'user-123',
    });
    expect(sent[0]!.content).toBe('私信通知');
  });

  it('$reply still targets the original conversation', async () => {
    const sent: Array<{ targetConversation: unknown }> = [];
    const message = new Message(
      { endpoint: { id: 's', adapter: 'a' }, kind: 'group', id: 'g1' },
      'hi',
      1,
      async (_content, _requester, targetConversation) => {
        sent.push({ targetConversation });
        return { status: 'sent' as const };
      },
    );

    await message.$reply('reply');
    await message.$sendTo({ kind: 'private', id: 'u1' }, 'dm');

    expect(sent[0]!.targetConversation).toBeUndefined();
    expect(sent[1]!.targetConversation).toEqual({ kind: 'private', id: 'u1' });
  });

  it('supports parent and threadId in target conversation', async () => {
    const sent: Array<{ targetConversation: unknown }> = [];
    const message = new Message(
      { endpoint: { id: 's', adapter: 'a' }, kind: 'group', id: 'g1' },
      'hi',
      1,
      async (_content, _requester, targetConversation) => {
        sent.push({ targetConversation });
        return { status: 'sent' as const };
      },
    );

    await message.$sendTo({
      kind: 'channel',
      id: 'ch-1',
      parent: { kind: 'group', id: 'guild-1' },
      threadId: 'thread-1',
    }, 'threaded');

    expect(sent[0]!.targetConversation).toEqual({
      kind: 'channel',
      id: 'ch-1',
      parent: { kind: 'group', id: 'guild-1' },
      threadId: 'thread-1',
    });
  });
});

describe('Message.$replyToPrivate', () => {
  function makeMessage(kind: 'group' | 'private' | 'channel', sender?: string) {
    const sent: Array<{ targetConversation: unknown }> = [];
    const message = new Message(
      { endpoint: { id: 's', adapter: 'a' }, kind, id: 'conv-1' },
      'hi',
      1,
      async (_content, _requester, targetConversation) => {
        sent.push({ targetConversation });
        return { status: 'sent' as const };
      },
      sender ? { id: sender } : undefined,
    );
    return { message, sent };
  }

  it('直接私信发送者', async () => {
    const { message, sent } = makeMessage('group', 'user-42');
    await message.$replyToPrivate('私信');
    expect(sent[0]!.targetConversation).toEqual({ kind: 'private', id: 'user-42' });
  });

  it('withSession=true 使用当前群作为 parent', async () => {
    const { message, sent } = makeMessage('group', 'user-42');
    await message.$replyToPrivate('群临时私信', true);
    expect(sent[0]!.targetConversation).toEqual({
      kind: 'private',
      id: 'user-42',
      parent: { kind: 'group', id: 'conv-1' },
    });
  });

  it('无 sender 时抛异常', () => {
    const { message } = makeMessage('group');
    expect(() => message.$replyToPrivate('hi')).toThrow('no sender');
  });

  it('withSession=true 但在私聊中时抛异常', () => {
    const { message } = makeMessage('private', 'user-42');
    expect(() => message.$replyToPrivate('hi', true)).toThrow('group or channel');
  });

  it('withSession=true 在频道中使用 channel parent', async () => {
    const { message, sent } = makeMessage('channel', 'user-42');
    await message.$replyToPrivate('频道私信', true);
    expect(sent[0]!.targetConversation).toEqual({
      kind: 'private',
      id: 'user-42',
      parent: { kind: 'channel', id: 'conv-1' },
    });
  });

  it('withSession={kind,id} 显式指定 parent', async () => {
    const { message, sent } = makeMessage('group', 'user-42');
    await message.$replyToPrivate('频道私信', { kind: 'channel', id: 'sub-ch-1' });
    expect(sent[0]!.targetConversation).toEqual({
      kind: 'private',
      id: 'user-42',
      parent: { kind: 'channel', id: 'sub-ch-1' },
    });
  });
});

describe('Message.$replyToGroup', () => {
  it('向指定群发送消息', async () => {
    const sent: Array<{ targetConversation: unknown }> = [];
    const message = new Message(
      { endpoint: { id: 's', adapter: 'a' }, kind: 'private', id: 'u1' },
      'hi',
      1,
      async (_content, _requester, targetConversation) => {
        sent.push({ targetConversation });
        return { status: 'sent' as const };
      },
      'u1',
    );
    await message.$replyToGroup('group-99', '群通知');
    expect(sent[0]!.targetConversation).toEqual({ kind: 'group', id: 'group-99' });
  });
});

describe('Message.$replyToChannel', () => {
  it('向指定频道发送消息', async () => {
    const sent: Array<{ targetConversation: unknown }> = [];
    const message = new Message(
      { endpoint: { id: 's', adapter: 'a' }, kind: 'group', id: 'g1' },
      'hi',
      1,
      async (_content, _requester, targetConversation) => {
        sent.push({ targetConversation });
        return { status: 'sent' as const };
      },
      'u1',
    );
    await message.$replyToChannel('ch-1', 'guild-1', '频道通知');
    expect(sent[0]!.targetConversation).toEqual({
      kind: 'channel',
      id: 'ch-1',
      parent: { kind: 'channel', id: 'guild-1' },
    });
  });

  it('支持 threadId', async () => {
    const sent: Array<{ targetConversation: unknown }> = [];
    const message = new Message(
      { endpoint: { id: 's', adapter: 'a' }, kind: 'group', id: 'g1' },
      'hi',
      1,
      async (_content, _requester, targetConversation) => {
        sent.push({ targetConversation });
        return { status: 'sent' as const };
      },
      'u1',
    );
    await message.$replyToChannel('ch-1', 'guild-1', '话题回复', 'thread-42');
    expect(sent[0]!.targetConversation).toEqual({
      kind: 'channel',
      id: 'ch-1',
      parent: { kind: 'channel', id: 'guild-1' },
      threadId: 'thread-42',
    });
  });
});
