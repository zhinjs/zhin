import { describe, expect, it, vi } from 'vitest';
import {
  SnapshotStore,
  capabilityId,
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
  defineAdapter as defineAdapterContract,
  endpointEventGatewayToken,
  type AdapterContext,
  type AdapterDefinition,
  type EndpointEvent,
} from '@zhin.js/adapter';
import { CommandIndex, commandFeatureId, defineCommand } from '@zhin.js/command';
import { HandlerIndex, defineHandler, handlerFeatureId } from '@zhin.js/handler';
import {
  ImRuntime,
  Message,
  type MessageDispatchResult,
  type SendContent,
} from '../../src/plugin-runtime/im/index.js';

type TestAdapterDefinition<TConfig> = Omit<AdapterDefinition<TConfig>, '$feature' | 'create'> & {
  create(context: AdapterContext<TConfig>): object | Promise<object>;
};

class TestEndpoint extends Endpoint<object> {
  readonly client: object;

  constructor(surface: object) {
    super();
    this.client = surface;
    Object.assign(this, surface);
  }
}

function defineAdapter<TConfig = unknown>(
  definition: TestAdapterDefinition<TConfig>,
): Readonly<AdapterDefinition<TConfig>> {
  return defineAdapterContract<TConfig>({
    ...definition,
    async create(context) {
      const value = await definition.create(context);
      return value instanceof Endpoint ? value : new TestEndpoint(value);
    },
  });
}

const ignoredEndpointEvents = Object.freeze({
  receive: async (_event: EndpointEvent) => undefined,
});

function receive(
  im: ImRuntime,
  payload: Parameters<ImRuntime['endpointEvents']['receive']>[0]['payload'],
): Promise<MessageDispatchResult> {
  const input = payload as { conversation?: { endpoint?: { id?: string } } };
  return im.endpointEvents.receive(Object.freeze({
    name: 'message.receive',
    payload,
    endpoint: Object.freeze({
      id: (input.conversation?.endpoint?.id ?? 'test-endpoint') as never,
      name: 'test',
    }),
    client: ignoredEndpointEvents,
  })) as Promise<MessageDispatchResult>;
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
    resources: new Map([[root, new Map([[
      endpointEventGatewayToken.id,
      ignoredEndpointEvents,
    ]])]]),
    capabilities: new Map(slots.map((slot) => [slot.id, slot])),
    projections: new Map(),
  };
}

describe('UserInteraction via ImRuntime', () => {
  async function createInteractionFixture() {
    const sent: unknown[] = [];
    const events: string[] = [];
    let interactionResult: unknown;
    let interactionError: unknown;
    const commandExecuted = vi.fn();
    const root = rootPluginId();
    const adapter = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'memory',
      source: '/adapters/memory.ts',
      definition: defineAdapter({
        capabilities: ['inbound', 'outbound'],
        create: () => ({
          start() {},
          open() {},
          close() {},
          stop() {},
          send(request) {
            sent.push(request);
            return `sent-${sent.length}`;
          },
        }),
      }),
    });
    const command = createCapabilitySlot({
      owner: root,
      feature: commandFeatureId,
      localName: 'ask',
      source: '/commands/ask.ts',
      definition: defineCommand<{}, SendContent, Message>({
        async execute(context) {
          commandExecuted();
          try {
            interactionResult = await context.interaction!.ask({
              type: 'text',
              title: '个人信息',
              description: '请输入你的名字',
              tip: '将用于后续问候',
            });
          } catch (e) {
            interactionError = e;
            throw e;
          }
          return `你好 ${interactionResult}`;
        },
      }),
    });
    const slots = [adapter, command];
    const base = baseState(slots);
    const view = createSnapshotView(0, base);
    const adapters = await AdapterIndex.create([adapter], view, new AbortController().signal);
    const projections = new Map([
      [adapterFeatureId, adapters],
      [commandFeatureId, new CommandIndex([command], view)],
    ]);
    const store = new SnapshotStore({ ...base, projections });
    const im = new ImRuntime();
    im.attach(store);
    await adapters.start();
    adapters.open();
    return {
      im,
      sent,
      events,
      commandExecuted,
      getResult: () => interactionResult,
      getError: () => interactionError,
    };
  }

  function incomingMessage(content: string, sender = 'user-1') {
    const root = rootPluginId();
    return {
      conversation: {
        endpoint: { id: String(capabilityId(root, adapterFeatureId, 'memory')), adapter: String(root) },
        kind: 'group' as const,
        id: 'room-1',
      },
      content,
      sender: { id: sender },
    };
  }

  it('text interaction 应发送提示并等待用户输入后返回', async () => {
    const { im, sent, getResult } = await createInteractionFixture();

    const commandPromise = receive(im, incomingMessage('/ask'));

    await vi.waitFor(() => {
      expect(sent.length).toBeGreaterThanOrEqual(1);
    });
    expect(sent[0]).toEqual(expect.objectContaining({
      payload: [{
        type: 'text',
        data: { text: '个人信息\n\n请输入你的名字\n\n💡 将用于后续问候' },
      }],
    }));

    const answerResult = await receive(im, incomingMessage('张三'));
    expect(answerResult.matched).toBe(true);
    expect(answerResult.command).toBe('interaction');

    const result = await commandPromise;
    expect(result.matched).toBe(true);
    expect(result.command).toBe('ask');
    expect(getResult()).toBe('张三');
  });

  it('interaction 应仅匹配同一用户同一频道的消息', async () => {
    const { im, sent } = await createInteractionFixture();

    receive(im, incomingMessage('/ask'));

    await vi.waitFor(() => {
      expect(sent.length).toBeGreaterThanOrEqual(1);
    });

    const otherUserResult = await receive(im, incomingMessage('李四', 'user-2'));
    expect(otherUserResult.matched).toBe(false);
  });

  it('consumes pending interaction replies before message.receive handlers can re-enter', async () => {
    const root = rootPluginId();
    const sent: unknown[] = [];
    const handled = vi.fn();
    let answer: unknown;
    const adapter = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'memory',
      source: '/adapters/memory.ts',
      definition: defineAdapter({
        capabilities: ['inbound', 'outbound'],
        create: () => ({
          start() {}, open() {}, close() {}, stop() {},
          send(request) {
            sent.push(request);
            return `sent-${sent.length}`;
          },
        }),
      }),
    });
    const handler = createCapabilitySlot({
      owner: root,
      feature: handlerFeatureId,
      localName: 'message/receive',
      source: '/handlers/message/receive.ts',
      definition: defineHandler({
        event: 'message.receive',
        async handle() {
          handled();
          answer = await this.interaction!.ask({ type: 'text', title: '请回复' });
        },
      }),
    });
    const slots = [adapter, handler];
    const base = baseState(slots);
    const view = createSnapshotView(0, base);
    const adapters = await AdapterIndex.create([adapter], view, new AbortController().signal);
    const store = new SnapshotStore({
      ...base,
      projections: new Map([
        [adapterFeatureId, adapters],
        [handlerFeatureId, new HandlerIndex([handler], view)],
      ]),
    });
    const im = new ImRuntime();
    im.attach(store);
    await adapters.start();
    adapters.open();

    const initial = receive(im, incomingMessage('start'));
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await expect(receive(im, incomingMessage('完成'))).resolves.toMatchObject({
      matched: true,
      command: 'interaction',
    });
    await initial;
    expect(answer).toBe('完成');
    expect(handled).toHaveBeenCalledTimes(1);
  });

  it('interaction 超时时 reject 并回复超时消息', async () => {
    const root = rootPluginId();
    const sent: unknown[] = [];
    let interactionError: unknown;
    const adapter = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'memory',
      source: '/adapters/memory.ts',
      definition: defineAdapter({
        capabilities: ['inbound', 'outbound'],
        create: () => ({
          start() {},
          open() {},
          close() {},
          stop() {},
          send(request) {
            sent.push(request);
            return `sent-${sent.length}`;
          },
        }),
      }),
    });
    const command = createCapabilitySlot({
      owner: root,
      feature: commandFeatureId,
      localName: 'ask',
      source: '/commands/ask.ts',
      definition: defineCommand<{}, SendContent, Message>({
        async execute(context) {
          try {
            await context.interaction!.ask({
              type: 'text', title: '请输入', timeout: 50, timeoutText: '等太久了',
            });
          } catch (e) {
            interactionError = e;
          }
          return '完成';
        },
      }),
    });
    const slots = [adapter, command];
    const base = baseState(slots);
    const view = createSnapshotView(0, base);
    const adapters = await AdapterIndex.create([adapter], view, new AbortController().signal);
    const projections = new Map([
      [adapterFeatureId, adapters],
      [commandFeatureId, new CommandIndex([command], view)],
    ]);
    const store = new SnapshotStore({ ...base, projections });
    const im = new ImRuntime();
    im.attach(store);
    await adapters.start();
    adapters.open();

    await receive(im, incomingMessage('/ask'));

    expect(interactionError).toBeInstanceOf(Error);
    expect((interactionError as Error).message).toBe('等太久了');
    expect(sent.some((s: any) => (
      Array.isArray(s.payload)
      && s.payload.some((segment: any) => segment.type === 'text' && segment.data?.text.includes('等太久了'))
    ))).toBe(true);
  });

  it('number interaction 应解析数字', async () => {
    const root = rootPluginId();
    const sent: unknown[] = [];
    let interactionResult: unknown;
    const adapter = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'memory',
      source: '/adapters/memory.ts',
      definition: defineAdapter({
        capabilities: ['inbound', 'outbound'],
        create: () => ({
          start() {},
          open() {},
          close() {},
          stop() {},
          send(request) {
            sent.push(request);
            return `sent-${sent.length}`;
          },
        }),
      }),
    });
    const command = createCapabilitySlot({
      owner: root,
      feature: commandFeatureId,
      localName: 'age',
      source: '/commands/age.ts',
      definition: defineCommand<{}, SendContent, Message>({
        async execute(context) {
          interactionResult = await context.interaction!.ask({ type: 'number', title: '你几岁' });
          return `${interactionResult}`;
        },
      }),
    });
    const slots = [adapter, command];
    const base = baseState(slots);
    const view = createSnapshotView(0, base);
    const adapters = await AdapterIndex.create([adapter], view, new AbortController().signal);
    const projections = new Map([
      [adapterFeatureId, adapters],
      [commandFeatureId, new CommandIndex([command], view)],
    ]);
    const store = new SnapshotStore({ ...base, projections });
    const im = new ImRuntime();
    im.attach(store);
    await adapters.start();
    adapters.open();

    const commandPromise = receive(im, incomingMessage('/age'));
    await vi.waitFor(() => { expect(sent.length).toBeGreaterThanOrEqual(1); });

    await receive(im, incomingMessage('25'));
    await commandPromise;
    expect(interactionResult).toBe(25);
  });

  it('confirm interaction 应判定确认条件', async () => {
    const root = rootPluginId();
    const sent: unknown[] = [];
    let interactionResult: unknown;
    const adapter = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'memory',
      source: '/adapters/memory.ts',
      definition: defineAdapter({
        capabilities: ['inbound', 'outbound'],
        create: () => ({
          start() {},
          open() {},
          close() {},
          stop() {},
          send(request) {
            sent.push(request);
            return `sent-${sent.length}`;
          },
        }),
      }),
    });
    const command = createCapabilitySlot({
      owner: root,
      feature: commandFeatureId,
      localName: 'confirm',
      source: '/commands/confirm.ts',
      definition: defineCommand<{}, SendContent, Message>({
        async execute(context) {
          interactionResult = await context.interaction!.ask({ type: 'confirm', title: '确认删除？' });
          return interactionResult ? '已删除' : '已取消';
        },
      }),
    });
    const slots = [adapter, command];
    const base = baseState(slots);
    const view = createSnapshotView(0, base);
    const adapters = await AdapterIndex.create([adapter], view, new AbortController().signal);
    const projections = new Map([
      [adapterFeatureId, adapters],
      [commandFeatureId, new CommandIndex([command], view)],
    ]);
    const store = new SnapshotStore({ ...base, projections });
    const im = new ImRuntime();
    im.attach(store);
    await adapters.start();
    adapters.open();

    const commandPromise = receive(im, incomingMessage('/confirm'));
    await vi.waitFor(() => { expect(sent.length).toBeGreaterThanOrEqual(1); });

    expect(sent[0]).toEqual(expect.objectContaining({
      payload: [
        expect.objectContaining({ type: 'text' }),
        expect.objectContaining({
          type: 'text',
          data: { text: '也可以直接回复对应内容。\n1. 确认\n2. 取消' },
        }),
      ],
    }));

    await receive(im, {
      ...incomingMessage('[button:confirm]'),
      segments: [{ type: 'action', data: { id: 'confirm', payload: 'yes' } }],
    });
    await commandPromise;
    expect(interactionResult).toBe(true);

    const sentBeforeSecondRun = sent.length;
    const cancelledCommand = receive(im, incomingMessage('/confirm'));
    await vi.waitFor(() => { expect(sent.length).toBeGreaterThan(sentBeforeSecondRun); });

    await receive(im, incomingMessage('no'));
    await cancelledCommand;
    expect(interactionResult).toBe(false);
  });

  it('interaction.sequence 应连续收集类型化结论并恢复原命令节点', async () => {
    const root = rootPluginId();
    const sent: unknown[] = [];
    let sequenceResult: Readonly<{
      name: string;
      environment: 'development' | 'production';
      confirmed: boolean;
    }> | undefined;
    const adapter = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'memory',
      source: '/adapters/memory.ts',
      definition: defineAdapter({
        capabilities: ['inbound', 'outbound'],
        create: () => ({
          start() {},
          open() {},
          close() {},
          stop() {},
          send(request) {
            sent.push(request);
            return `sent-${sent.length}`;
          },
        }),
      }),
    });
    const command = createCapabilitySlot({
      owner: root,
      feature: commandFeatureId,
      localName: 'environment',
      source: '/commands/environment.ts',
      definition: defineCommand<{}, SendContent, Message>({
        async execute(context) {
          sequenceResult = await context.interaction!.sequence({
            title: '部署向导',
            description: '请完成三个步骤。',
            tip: '结果会在最后一步后一次性返回。',
            steps: [
              { id: 'name', type: 'text', title: '请输入发布名称', minLength: 2 },
              {
                id: 'environment',
                type: 'select',
                title: '请选择部署环境',
                options: [
                  { label: '开发环境', value: 'development' as const },
                  { label: '生产环境', value: 'production' as const },
                ],
              },
              { id: 'confirmed', type: 'confirm', title: '确认发布？' },
            ],
          });
          return sequenceResult.environment;
        },
      }),
    });
    const slots = [adapter, command];
    const base = baseState(slots);
    const view = createSnapshotView(0, base);
    const adapters = await AdapterIndex.create([adapter], view, new AbortController().signal);
    const projections = new Map([
      [adapterFeatureId, adapters],
      [commandFeatureId, new CommandIndex([command], view)],
    ]);
    const store = new SnapshotStore({ ...base, projections });
    const im = new ImRuntime();
    im.attach(store);
    await adapters.start();
    adapters.open();

    const commandPromise = receive(im, incomingMessage('/environment'));
    await vi.waitFor(() => { expect(sent.length).toBeGreaterThanOrEqual(1); });

    const firstAnswer = await receive(im, incomingMessage('正式发布'));
    expect(firstAnswer).toMatchObject({ matched: true, command: 'interaction' });
    await vi.waitFor(() => { expect(sent.length).toBeGreaterThanOrEqual(2); });

    const secondAnswer = await receive(im, incomingMessage('2'));
    expect(secondAnswer).toMatchObject({ matched: true, command: 'interaction' });
    await vi.waitFor(() => { expect(sent.length).toBeGreaterThanOrEqual(3); });

    const thirdAnswer = await receive(im, incomingMessage('yes'));
    expect(thirdAnswer).toMatchObject({ matched: true, command: 'interaction' });
    await commandPromise;
    expect(sequenceResult).toEqual({
      name: '正式发布',
      environment: 'production',
      confirmed: true,
    });
  });

  it('confirm interaction 在 signal abort 后应 fail closed 且不使用 default', async () => {
    const root = rootPluginId();
    const sent: unknown[] = [];
    let interactionError: unknown;
    const adapter = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'memory',
      source: '/adapters/memory.ts',
      definition: defineAdapter({
        capabilities: ['inbound', 'outbound'],
        create: () => ({
          start() {},
          open() {},
          close() {},
          stop() {},
          send(request) {
            sent.push(request);
            return `sent-${sent.length}`;
          },
        }),
      }),
    });
    const command = createCapabilitySlot({
      owner: root,
      feature: commandFeatureId,
      localName: 'abort-confirm',
      source: '/commands/abort-confirm.ts',
      definition: defineCommand<{}, SendContent, Message>({
        async execute(context) {
          const ac = new AbortController();
          const pending = context.interaction!.ask({
            type: 'confirm', title: '确认删除？', signal: ac.signal, default: false,
          });
          ac.abort();
          try {
            await pending;
          } catch (error) {
            interactionError = error;
          }
          return '已终止';
        },
      }),
    });
    const slots = [adapter, command];
    const base = baseState(slots);
    const view = createSnapshotView(0, base);
    const adapters = await AdapterIndex.create([adapter], view, new AbortController().signal);
    const projections = new Map([
      [adapterFeatureId, adapters],
      [commandFeatureId, new CommandIndex([command], view)],
    ]);
    const store = new SnapshotStore({ ...base, projections });
    const im = new ImRuntime();
    im.attach(store);
    await adapters.start();
    adapters.open();

    await expect(receive(im, incomingMessage('/abort-confirm'))).resolves.toMatchObject({
      matched: true,
    });
    expect(interactionError).toBeInstanceOf(Error);
    await expect(receive(im, incomingMessage('yes'))).resolves.toMatchObject({
      matched: false,
    });
  });

  it('initial interaction delivery failure rejects immediately without claiming later input', async () => {
    const { im } = await createInteractionFixture();
    const incoming = incomingMessage('start');
    const message = new Message(
      incoming.conversation,
      incoming.content,
      1,
      async () => ({
        status: 'rejected' as const,
        failure: { code: 'policy_denied', message: 'not delivered' },
      }),
      { id: 'user-1' },
    );
    const interaction = im.createInteraction(message)!;

    await expect(interaction.ask({ type: 'text', title: '请输入' }))
      .rejects.toThrow(/delivery/i);
    await expect(receive(im, incomingMessage('后续消息'))).resolves.toMatchObject({ matched: false });
  });

  it('keeps same-user interaction claims isolated by canonical thread identity', async () => {
    const { im } = await createInteractionFixture();
    const createThreadMessage = (threadId: string) => new Message(
      { ...incomingMessage('start').conversation, threadId },
      'start',
      1,
      async () => ({ status: 'sent' as const }),
      { id: 'user-1' },
    );
    const threadOne = im.createInteraction(createThreadMessage('thread-1'))!;
    const threadTwo = im.createInteraction(createThreadMessage('thread-2'))!;
    const first = threadOne.ask({ type: 'text', title: '线程一' });
    const second = threadTwo.ask({ type: 'text', title: '线程二' });
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    await expect(receive(im, {
      ...incomingMessage('答案二'),
      conversation: { ...incomingMessage('答案二').conversation, threadId: 'thread-2' },
    })).resolves.toMatchObject({ matched: true, command: 'interaction' });
    await expect(second).resolves.toBe('答案二');

    await expect(receive(im, {
      ...incomingMessage('答案一'),
      conversation: { ...incomingMessage('答案一').conversation, threadId: 'thread-1' },
    })).resolves.toMatchObject({ matched: true, command: 'interaction' });
    await expect(first).resolves.toBe('答案一');
  });

  it('createInteraction(bind.subjectId) 只接受该用户的回复', async () => {
    const { im } = await createInteractionFixture();
    const incoming = incomingMessage('start', 'user-1');
    const delivered: string[] = [];
    const message = new Message(
      incoming.conversation,
      incoming.content,
      1,
      async (content) => {
        delivered.push(String(content));
        return { status: 'sent' as const };
      },
      { id: 'user-1' },
      Object.freeze({}),
      undefined,
      { conversation: incoming.conversation, id: 'm-ask' },
      'memory',
    );
    const interaction = im.createInteraction(message, { subjectId: 'master-1' });
    expect(interaction).toBeDefined();
    const pending = interaction!.ask({ type: 'confirm', title: '请 master 确认' });
    await vi.waitFor(() => { expect(delivered.length).toBeGreaterThanOrEqual(1); });
    await expect(receive(im, incomingMessage('yes', 'user-1'))).resolves.toMatchObject({ matched: false });
    await expect(receive(im, incomingMessage('yes', 'master-1'))).resolves.toMatchObject({
      matched: true,
      command: 'interaction',
    });
    await expect(pending).resolves.toBe(true);
  });
});
