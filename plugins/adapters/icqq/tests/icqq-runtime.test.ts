import {
  bindTestEndpoint,
  bindTestEndpointEvents,
} from '../../test-utils/endpoint.js';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import type { OutboundMessageService } from '@zhin.js/core/runtime';
import type { EndpointEventGateway } from 'zhin.js/adapter';

vi.mock('@icqqjs/icqq', async () => import('./_icqq-mock.js'));

import defineIcqqAdapter from '../adapters/icqq/index.js';
import { IcqqEndpoint } from '../src/endpoint.js';
import * as outboundMedia from '../src/outbound-media.js';
import {
  formatOutboundBody,
  formatOutboundMessages,
  formatOutboundMessageParts,
  icqqInboundConversation,
  icqqOutboundTarget,
  resolveIcqqConfig,
  type IcqqEndpointConfig,
} from '../src/protocol.js';
import { defineHandler } from 'zhin.js/handler';
import {
  Client as MockIcqqClient,
  createIcqqTestPorts,
  hangNextMockIcqqLogin,
  isMockIcqqClientConnected,
  scheduleMockIcqqReconnect,
} from './_icqq-mock.js';

const adapterFeature = featureId('zhin.adapter');

const baseConfig = resolveIcqqConfig({
  id: '10001',
  autoReconnect: false,
});

function createEndpoint(overrides: {
  receive?: ReturnType<typeof vi.fn>;
  gateway?: OutboundMessageService;
  friends?: Map<number, unknown>;
  groups?: Map<number, unknown>;
  config?: ReturnType<typeof resolveIcqqConfig>;
  events?: EndpointEventGateway;
  notifier?: { readonly configured: boolean; send(text: string): Promise<boolean> };
} = {}): IcqqEndpoint {
  const receive = overrides.receive ?? vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
  const gateway = overrides.gateway ?? { receive, send: vi.fn(async () => 'sent') };
  const unbound = new IcqqEndpoint({
    id: capabilityId(rootPluginId(), adapterFeature, 'icqq'),
    gateway,
    config: overrides.config ?? baseConfig,
    ...(overrides.notifier ? { notifier: overrides.notifier } : {}),
    ...createIcqqTestPorts(),
  });
  const endpoint = overrides.events
    ? bindTestEndpointEvents(unbound, overrides.events)
    : bindTestEndpoint(unbound, gateway, undefined);
  const friends = overrides.friends ?? new Map([[2, { user_id: 2, nickname: 'bob', sex: 'unknown', age: 0 }]]);
  const groups = overrides.groups ?? new Map([[100, { group_id: 100, group_name: 'g', member_count: 1, max_member_count: 200, owner_id: 1, admin_flag: false, last_join_time: 0, last_sent_time: 0, shutup_time_whole: 0, shutup_time_me: 0, create_time: 0, grade: 0, max_admin_count: 0, active_member_count: 0 }]]);
  for (const [k, v] of friends) endpoint.fl.set(k, v as never);
  for (const [k, v] of groups) endpoint.gl.set(k, v as never);
  return endpoint;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('native Client Endpoint identity and callback binding', () => {
  it('retains native prototype methods/disposer semantics and sends the exact SDK event with its timestamp', async () => {
    const receive = vi.fn(async (_input: { event: unknown; platformSentAt?: number }) => undefined);
    const endpoint = createEndpoint({ receive });
    expect(endpoint).toBeInstanceOf(MockIcqqClient);
    expect('client' in endpoint).toBe(false);
    const native = vi.fn();
    const dispose = endpoint.on('custom.event', native);
    endpoint.emit('custom.event', { first: true });
    expect(native).toHaveBeenCalledTimes(1);
    dispose();
    endpoint.emit('custom.event', { second: true });
    expect(native).toHaveBeenCalledTimes(1);
    class MessageEvent {
      post_type = 'message'; message_type = 'private'; user_id = 2;
      message_id = 'same-native-event'; time = 1_700_000_000; raw_message = 'hello';
      message = [{ type: 'text', text: 'hello' }];
      sender = { nickname: 'Bob' };
      readonly bytes = Buffer.from('sdk');
      reply(): string { return 'native method'; }
    }
    const event = new MessageEvent();
    await endpoint.start(new AbortController().signal);
    endpoint.open();
    endpoint.emit('message.private', event);
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    const input = receive.mock.calls[0][0];
    expect(input.event).toBe(event);
    expect(input.event).toHaveProperty('bytes', event.bytes);
    expect(event.reply()).toBe('native method');
    expect(input.platformSentAt).toBe(1_700_000_000_000);
    expect(input).toHaveProperty('endpointId', '10001');
    expect(Object.isFrozen(event)).toBe(false);
    await endpoint.stop();
  });
});

describe('icqq protocol helpers', () => {
  it('resolves numeric id config', () => {
    const resolved = resolveIcqqConfig({ id: '12345' });
    expect(resolved.id).toBe('12345');
    expect(resolved.autoReconnect).toBe(true);
    expect(resolved.context).toBe('icqq');
    expect(resolveIcqqConfig({
      id: '12345',
      notify: { adapter: 'qq', endpoint: 'bot-1', id: 'master-openid' },
    }).notify).toEqual({
      adapter: 'qq',
      endpoint: 'bot-1',
      kind: 'private',
      id: 'master-openid',
    });
  });

  it('preserves the expanded endpoint credentials', () => {
    const config: IcqqEndpointConfig = {
      id: '12345',
      password: 'direct-secret',
    };
    expect(resolveIcqqConfig(config).password).toBe('direct-secret');
  });

  it('does not infer endpoint identity from process state or nested configuration', () => {
    vi.stubEnv('ICQQ_ACCOUNT', '12345');
    const resolve = resolveIcqqConfig as (config: unknown) => unknown;
    expect(() => resolve({})).toThrow(/numeric id/);
    expect(() => resolve({
      endpoints: [{ context: 'icqq', id: '12345' }],
    })).toThrow(/numeric id/);
  });

  it('rejects non-numeric id', () => {
    expect(() => resolveIcqqConfig({ id: 'bot' })).toThrow(/numeric id/);
  });

  it('derives outbound targets from conversations', () => {
    const endpoint = { id: 'test-endpoint', adapter: 'test' };
    expect(icqqOutboundTarget({ endpoint, kind: 'group', id: '100' }))
      .toEqual({ kind: 'group', groupId: 100 });
    expect(icqqOutboundTarget({ endpoint, kind: 'private', id: '2' }))
      .toEqual({ kind: 'private', userId: 2 });
    expect(icqqOutboundTarget({
      endpoint,
      kind: 'private',
      id: '2',
      parent: { kind: 'group', id: '100' },
    })).toEqual({ kind: 'temp', groupId: 100, userId: 2 });
    expect(icqqOutboundTarget({
      endpoint,
      kind: 'channel',
      id: 'c1',
      parent: { kind: 'channel', id: 'g1' },
    })).toEqual({ kind: 'channel', guildId: 'g1', channelId: 'c1' });
  });

  it('normalizes inbound conversations', () => {
    expect(icqqInboundConversation('root/icqq\0zhin.adapter\0icqq~8596238', {
      channelType: 'private', channelId: '1659488338',
    }).endpoint).toEqual({ id: 'root/icqq\0zhin.adapter\0icqq~8596238', adapter: 'icqq' });
    expect(icqqInboundConversation('test-endpoint', { channelType: 'group', channelId: '100' }))
      .toMatchObject({ kind: 'group', id: '100' });
    expect(icqqInboundConversation('test-endpoint', {
      channelType: 'private',
      channelId: '2',
      channelParentGroupId: '100',
    })).toMatchObject({ kind: 'private', id: '2', parent: { kind: 'group', id: '100' } });
    expect(icqqInboundConversation('test-endpoint', {
      channelType: 'channel',
      channelId: 'c1',
      guildId: 'g1',
    })).toMatchObject({ kind: 'channel', id: 'c1', parent: { kind: 'channel', id: 'g1' } });
  });

  it('formats outbound ICQQ Sendable', () => {
    expect(formatOutboundBody('hi')).toBe('hi');
    expect(formatOutboundBody([
      { type: 'text', data: { text: 'hi' } },
      { type: 'at', data: { qq: '2' } },
    ])).toEqual(['hi', { type: 'at', qq: 2 }]);
  });

  it('treats a single segment object (non-array) as a one-element array', () => {
    expect(formatOutboundBody({ type: 'text', data: { text: 'hi' } })).toBe('hi');
    expect(formatOutboundBody({
      type: 'image',
      data: { media: { kind: 'base64', value: 'YQ==' } },
    })).toEqual({ type: 'image', file: 'base64://YQ==' });
    expect(() => formatOutboundBody({ type: 'image', data: {} })).toThrow(/media/i);
    expect(() => formatOutboundBody({ type: 'html', data: { html: '<b>x<\/b>' } }))
      .toThrow(/unsupported/i);
    expect(formatOutboundBody({ text: 'legacy' })).toBe('legacy');
  });
});

describe('icqq plugin runtime adapter', () => {
  it('exports the real SDK Client and exact native event payload types', () => {
    const handler = defineHandler({
      adapter: 'icqq',
      event: 'notice.group.increase',
      async handle({ client, event, endpoint }) {
        const groupId: number = event.group_id;
        const userId: number = event.user_id;
        expect(endpoint.adapter).toBe('icqq');
        await client.pickGroup(groupId).sendMsg(`welcome ${userId}`);
      },
    });
    expect(handler.event).toBe('platform.receive');
  });

  it('forwards SDK extension events with the real Client through the unified gateway', async () => {
    const observed: Parameters<EndpointEventGateway['receive']>[0][] = [];
    const endpoint = createEndpoint({
      events: {
        async receive(event) {
          observed.push(event);
        },
      },
    });
    await endpoint.start(new AbortController().signal);
    endpoint.open();

    const extension = { value: 1 };
    endpoint.emit('extension.custom', extension);

    await vi.waitFor(() => expect(observed).toContainEqual(expect.objectContaining({
      name: 'platform.receive',
      payload: { name: 'extension.custom', event: extension },
      client: endpoint,
      endpoint: expect.objectContaining({ adapter: 'test-endpoint' }),
    })));
    await endpoint.stop();
  });

  it('keeps the replacement TCP session alive when config HMR retires the old endpoint', async () => {
    const reconnectingConfig = resolveIcqqConfig({ id: '10001', autoReconnect: true });
    const previous = createEndpoint({ config: reconnectingConfig });
    await previous.start(new AbortController().signal);
    previous.open();

    const replacement = createEndpoint({ config: reconnectingConfig });
    await replacement.start(new AbortController().signal);
    replacement.open();

    await previous.close();
    await previous.stop();

    expect(previous.logout).not.toHaveBeenCalled();
    expect(previous.terminate).toHaveBeenCalledOnce();
    expect(isMockIcqqClientConnected(replacement)).toBe(true);
    await replacement.stop();
  });

  it('cancels the retiring SDK reconnect timer before it can revive the old generation', async () => {
    vi.useFakeTimers();
    const reconnectingConfig = resolveIcqqConfig({ id: '10001', autoReconnect: true });
    const previous = createEndpoint({ config: reconnectingConfig });
    const replacement = createEndpoint({ config: reconnectingConfig });
    await previous.start(new AbortController().signal);
    previous.open();
    await replacement.start(new AbortController().signal);
    replacement.open();

    scheduleMockIcqqReconnect(previous, 50);
    await previous.close();
    await previous.stop();
    await vi.advanceTimersByTimeAsync(50);

    expect(previous.login).toHaveBeenCalledTimes(1);
    expect(isMockIcqqClientConnected(previous)).toBe(false);
    expect(isMockIcqqClientConnected(replacement)).toBe(true);
    await replacement.stop();
  });

  it('retires an SDK reconnect whose login handshake already entered before stop', async () => {
    vi.useFakeTimers();
    const reconnectingConfig = resolveIcqqConfig({ id: '10001', autoReconnect: true });
    const previous = createEndpoint({ config: reconnectingConfig });
    const replacement = createEndpoint({ config: reconnectingConfig });
    await previous.start(new AbortController().signal);
    previous.open();
    await replacement.start(new AbortController().signal);
    replacement.open();

    const handshake = hangNextMockIcqqLogin(previous);
    scheduleMockIcqqReconnect(previous, 50);
    await vi.advanceTimersByTimeAsync(50);
    await handshake.entered;

    await previous.close();
    await previous.stop();
    handshake.release();
    await vi.runAllTimersAsync();

    expect(previous.login).toHaveBeenCalledTimes(2);
    expect(isMockIcqqClientConnected(previous)).toBe(false);
    expect(isMockIcqqClientConnected(replacement)).toBe(true);
    await replacement.stop();
  });

  it('arms reconnect retirement before waiting for in-flight inbound drain', async () => {
    vi.useFakeTimers();
    let releaseInbound!: () => void;
    const inboundGate = new Promise<void>((resolve) => { releaseInbound = resolve; });
    const receive = vi.fn(async () => {
      await inboundGate;
      return Object.freeze({ matched: true, value: 'ok' });
    });
    const reconnectingConfig = resolveIcqqConfig({ id: '10001', autoReconnect: true });
    const previous = createEndpoint({ config: reconnectingConfig, receive });
    const replacement = createEndpoint({ config: reconnectingConfig });
    await previous.start(new AbortController().signal);
    previous.open();
    await replacement.start(new AbortController().signal);
    replacement.open();

    previous.emit('message.group.normal', {
      post_type: 'message',
      message_type: 'group',
      group_id: 100,
      user_id: 2,
      message_id: 'inflight-before-stop',
      raw_message: 'hold inbound drain',
      time: 1_700_000_000,
      sender: { user_id: 2, nickname: 'bob', role: 'member' },
    });
    await vi.waitFor(() => expect(receive).toHaveBeenCalledOnce());

    const handshake = hangNextMockIcqqLogin(previous);
    scheduleMockIcqqReconnect(previous, 50);
    await vi.advanceTimersByTimeAsync(50);
    await handshake.entered;

    let closeSettled = false;
    const closing = previous.close().then(() => { closeSettled = true; });
    let stopSettled = false;
    const stopping = previous.stop().then(() => { stopSettled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(closeSettled).toBe(false);
    expect(stopSettled).toBe(false);
    expect(previous.terminate).not.toHaveBeenCalled();
    handshake.release();
    await vi.runAllTimersAsync();

    expect(isMockIcqqClientConnected(previous)).toBe(false);
    expect(isMockIcqqClientConnected(replacement)).toBe(true);

    releaseInbound();
    await Promise.all([closing, stopping]);
    await replacement.stop();
  });

  it('close waits for an in-flight guild message receive', async () => {
    let releaseInbound!: () => void;
    const inboundGate = new Promise<void>((resolve) => { releaseInbound = resolve; });
    const receive = vi.fn(async () => {
      await inboundGate;
      return Object.freeze({ matched: true, value: 'ok' });
    });
    const endpoint = createEndpoint({ receive });
    await endpoint.start(new AbortController().signal);
    endpoint.open();

    endpoint.emit('message.guild.normal', {
      type: 'guild',
      guild_id: 'g1',
      guild_name: 'Guild One',
      channel_id: 'c1',
      channel_name: 'general',
      tiny_id: 'u1',
      nickname: 'alice',
      message_id: 'guild-inflight',
      raw_message: 'hold guild receive',
      time: 1_700_000_000,
    });
    await vi.waitFor(() => expect(receive).toHaveBeenCalledOnce());

    let closeSettled = false;
    const closing = endpoint.close().then(() => { closeSettled = true; });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(closeSettled).toBe(false);

    releaseInbound();
    await closing;
    await endpoint.stop();
  });

  it('stop waits for a held message receive flushed by open', async () => {
    let releaseInbound!: () => void;
    const inboundGate = new Promise<void>((resolve) => { releaseInbound = resolve; });
    const receive = vi.fn(async () => {
      await inboundGate;
      return Object.freeze({ matched: true, value: 'ok' });
    });
    const endpoint = createEndpoint({ receive });
    await endpoint.start(new AbortController().signal);

    endpoint.emit('message.group.normal', {
      post_type: 'message',
      message_type: 'group',
      group_id: 100,
      user_id: 2,
      message_id: 'held-inflight',
      raw_message: 'hold until open',
      time: 1_700_000_000,
      sender: { user_id: 2, nickname: 'bob', role: 'member' },
    });
    await Promise.resolve();
    expect(receive).not.toHaveBeenCalled();

    endpoint.open();
    await vi.waitFor(() => expect(receive).toHaveBeenCalledOnce());
    let stopSettled = false;
    const stopping = endpoint.stop().then(() => { stopSettled = true; });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(stopSettled).toBe(false);

    releaseInbound();
    await stopping;
  });

  it.each(['close', 'stop'] as const)(
    'fails fast when gateway.receive synchronously awaits endpoint.%s, while external lifecycle still drains',
    async (method) => {
      let releaseInbound!: () => void;
      const inboundGate = new Promise<void>((resolve) => { releaseInbound = resolve; });
      let markLifecycleAttempted!: () => void;
      const lifecycleAttempted = new Promise<void>((resolve) => { markLifecycleAttempted = resolve; });
      let internalError: unknown;
      const holder: { endpoint?: IcqqEndpoint } = {};
      const receive = vi.fn(async () => {
        try {
          await holder.endpoint![method]();
        } catch (error) {
          internalError = error;
        } finally {
          markLifecycleAttempted();
        }
        await inboundGate;
        return Object.freeze({ matched: true, value: 'ok' });
      });
      const endpoint = createEndpoint({ receive });
      holder.endpoint = endpoint;
      await endpoint.start(new AbortController().signal);
      endpoint.open();

      endpoint.emit('message.group.normal', {
        post_type: 'message',
        message_type: 'group',
        group_id: 100,
        user_id: 2,
        message_id: `self-${method}`,
        raw_message: `self ${method}`,
        time: 1_700_000_000,
        sender: { user_id: 2, nickname: 'bob', role: 'member' },
      });
      await lifecycleAttempted;
      expect(internalError).toBeInstanceOf(Error);
      expect(String(internalError)).toMatch(/inbound|receive|lifecycle/i);

      let externalSettled = false;
      const external = endpoint[method]().then(() => { externalSettled = true; });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(externalSettled).toBe(false);

      releaseInbound();
      await external;
      if (method === 'close') await endpoint.stop();
    },
  );

  it('admits message events via OutboundMessageService when open', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const endpoint = createEndpoint({ receive });
    await endpoint.start(new AbortController().signal);
    endpoint.open();

    endpoint.emit('message.group.normal', {
      post_type: 'message',
      message_type: 'group',
      group_id: 100,
      user_id: 2,
      message_id: 'm1',
      raw_message: 'hello',
      time: 1_700_000_000,
      sender: { user_id: 2, nickname: 'bob', role: 'member' },
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      conversation: expect.objectContaining({ kind: 'group', id: '100' }),
      message: expect.objectContaining({ id: 'm1' }),
      content: 'hello',
      sender: expect.objectContaining({ id: '2' }),
    }));
    await endpoint.stop();
  });

  it('holds inbound until open() then flushes to the gateway', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const endpoint = createEndpoint({ receive });
    await endpoint.start(new AbortController().signal);

    endpoint.emit('message.group.normal', {
      post_type: 'message',
      message_type: 'group',
      group_id: 100,
      user_id: 2,
      message_id: 'held-1',
      raw_message: '赞我20次',
      time: 1_700_000_000,
      sender: { user_id: 2, nickname: 'bob', role: 'member' },
    });
    expect(receive).not.toHaveBeenCalled();

    endpoint.open();
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.objectContaining({ id: 'held-1' }),
      content: '赞我20次',
    }));
    await endpoint.stop();
  });

  it('admits native GroupMessage whose toJSON(keys) throws if called without keys', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const endpoint = createEndpoint({ receive });
    await endpoint.start(new AbortController().signal);
    endpoint.open();

    endpoint.emit('message.group.normal', {
      post_type: 'message',
      message_type: 'group',
      group_id: 100,
      user_id: 2,
      message_id: 'm-native',
      raw_message: '#菜单',
      time: 1_700_000_000,
      sender: { user_id: 2, nickname: 'bob', role: 'member' },
      toJSON(keys?: string[]) {
        if (!keys) throw new TypeError("Cannot read properties of undefined (reading 'includes')");
        return Object.fromEntries(Object.entries(this).filter(([key, value]) => (
          typeof value !== 'function' && !keys.includes(key)
        )));
      },
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      content: '#菜单',
      message: expect.objectContaining({ id: 'm-native' }),
    }));
    await endpoint.stop();
  });

  it('passes a canonical reply reference and resolves its observed content through EndpointContentPort', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const endpoint = createEndpoint({ receive });
    await endpoint.start(new AbortController().signal);
    endpoint.open();

    endpoint.emit('message.group.normal', {
      post_type: 'message',
      message_type: 'group',
      group_id: 100,
      user_id: 2,
      message_id: 'm-quote',
      raw_message: '收到',
      time: 1_700_000_000,
      sender: { user_id: 2, nickname: 'bob', role: 'member' },
      source: {
        message_id: 'quoted-1',
        user_id: 3,
        sender: { user_id: 3, nickname: 'alice' },
        message: [{ type: 'text', text: '原文内容' }],
        time: 1_699_999_000,
      },
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.objectContaining({ id: 'm-quote' }),
      replyTo: { id: 'quoted-1' },
    }));
    const conversation = receive.mock.calls[0]?.[0]?.conversation;
    await expect(endpoint.content.resolve({
      kind: 'message',
      message: { conversation, id: 'quoted-1' },
    }, {
      signal: new AbortController().signal,
      maxDepth: 2,
      maxEntries: 50,
      maxChars: 12_000,
    })).resolves.toMatchObject({
      status: 'resolved',
      value: {
        actor: { id: '3', displayName: 'alice' },
        segments: [{ type: 'text', data: { text: '原文内容' } }],
      },
    });
    await endpoint.stop();
  });

  it('omits reply references when event has no quote source', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const endpoint = createEndpoint({ receive });
    await endpoint.start(new AbortController().signal);
    endpoint.open();

    endpoint.emit('message.group.normal', {
      post_type: 'message',
      message_type: 'group',
      group_id: 100,
      user_id: 2,
      message_id: 'm-plain',
      raw_message: 'plain',
      time: 1_700_000_000,
      sender: { user_id: 2, nickname: 'bob', role: 'member' },
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    const input = receive.mock.calls[0]?.[0];
    expect(input?.replyTo).toBeUndefined();
    await endpoint.stop();
  });

  it('resolves nested forwards within depth and entry budgets without following cycles', async () => {
    const endpoint = createEndpoint();
    endpoint.getForwardMsg = vi.fn(async (id: string) => {
      if (id === 'root') return [{
        sender: { user_id: 1, nickname: 'root actor' },
        message: [{ type: 'forward', id: 'nested' }],
      }];
      if (id === 'nested') return [{
        sender: { user_id: 2, nickname: 'nested actor' },
        message: [
          { type: 'text', text: 'nested content' },
          { type: 'forward', id: 'root' },
        ],
      }];
      return [];
    }) as typeof endpoint.getForwardMsg;

    const conversation = {
      endpoint: { adapter: 'icqq', id: endpoint.endpointName },
      kind: 'group' as const,
      id: '100',
    };
    const result = await endpoint.content.resolve({
      kind: 'forward',
      conversation,
      forwardId: 'root',
    }, {
      signal: new AbortController().signal,
      maxDepth: 2,
      maxEntries: 2,
      maxChars: 12_000,
    });

    expect(result).toMatchObject({
      status: 'resolved',
      value: [{
        actor: { id: '1' },
        segments: [{
          type: 'forward',
          data: {
            forward_id: 'nested',
            entries: [{
              actor: { id: '2' },
              segments: [
                { type: 'text', data: { text: 'nested content' } },
                { type: 'forward', data: { forward_id: 'root' } },
              ],
            }],
          },
        }],
      }],
    });
    expect(endpoint.getForwardMsg).toHaveBeenCalledTimes(2);
  });

  it('marks mentioned when group message @s the bot uin', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const endpoint = createEndpoint({ receive });
    await endpoint.start(new AbortController().signal);
    endpoint.open();

    endpoint.emit('message.group.normal', {
      post_type: 'message',
      message_type: 'group',
      group_id: 100,
      user_id: 2,
      message_id: 'm-at',
      raw_message: '[CQ:at,qq=10001] 在吗',
      time: 1_700_000_000,
      sender: { user_id: 2, nickname: 'bob', role: 'member' },
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      conversation: expect.objectContaining({ kind: 'group', id: '100' }),
      content: '[CQ:at,qq=10001] 在吗',
      mentioned: true,
    }));
    await endpoint.stop();
  });

  it('does not mark mentioned when @ targets someone else', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const endpoint = createEndpoint({ receive });
    await endpoint.start(new AbortController().signal);
    endpoint.open();

    endpoint.emit('message.group.normal', {
      post_type: 'message',
      message_type: 'group',
      group_id: 100,
      user_id: 2,
      message_id: 'm-other',
      raw_message: '[CQ:at,qq=10002] 在吗',
      time: 1_700_000_000,
      sender: { user_id: 2, nickname: 'bob', role: 'member' },
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive.mock.calls[receive.mock.calls.length - 1]?.[0]?.mentioned).toBeFalsy();
    await endpoint.stop();
  });

  it('does not admit while closed', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const endpoint = createEndpoint({ receive });
    await endpoint.start(new AbortController().signal);
    endpoint.admit({
      id: '1',
      conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'group',
        id: '1',
      },
      content: 'x',
      sender: expect.objectContaining({ id: '2' }),
      channelType: 'group',
    });
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('send posts group message via Client.sendGroupMsg', async () => {
    const endpoint = createEndpoint();
    await endpoint.start(new AbortController().signal);
    endpoint.open();
    const id = await endpoint.send({
      conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'group',
        id: '100',
      },
      payload: 'pong',
    });
    expect(id).toEqual({ parts: [{ messageId: 'sent-1', sourceIndices: [0] }] });
    expect(endpoint.sendGroupMsg).toHaveBeenCalledWith(100, 'pong');
    await endpoint.stop();
  });

  it('sends music shares through the native ICQQ share protocol', async () => {
    const endpoint = createEndpoint();
    await endpoint.start(new AbortController().signal);
    endpoint.open();
    const sending = endpoint.send({
      conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'group',
        id: '100',
      },
      payload: {
        type: 'share',
        data: {
          title: '海阔天空',
          url: 'https://music.163.com/#/song?id=387717',
          image: 'http://p1.music.126.net/cover.jpg',
          audio: 'http://iot201.music.126.net/song.mp3',
          content: '小B崽子，你的歌道了',
          description: '经典粤语摇滚',
          artist: '信乐团',
          config: {
            appid: 100495085,
          },
        },
      },
    });

    await expect(sending).rejects.toMatchObject({ code: 'delivery_unconfirmed', disposition: 'unknown' });
    expect(endpoint.pickGroup).toHaveBeenCalledWith(100);
    expect(endpoint.share).toHaveBeenCalledWith({
      type: 'share',
      title: '海阔天空',
      url: 'https://music.163.com/#/song?id=387717',
      image: 'http://p1.music.126.net/cover.jpg',
      audio: 'http://iot201.music.126.net/song.mp3',
      content: '小B崽子，你的歌道了',
      summary: '经典粤语摇滚',
      config: {
        appid: 100495085,
      },
    });
    expect(endpoint.sendGroupMsg).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('maps the share music platform to the ICQQ app id unless config.appid is given', () => {
    const song = { title: '晴天', url: 'https://y.qq.com/n/ryqq/songDetail/1', audio: 'https://music.example/1.mp3' };
    expect(formatOutboundBody({ type: 'share', data: { ...song, platform: 'NetEase' } }))
      .toMatchObject({ type: 'share', config: { appid: 100495085 } });
    expect(formatOutboundBody({ type: 'share', data: { ...song, platform: 'qq' } }))
      .toMatchObject({ config: { appid: 100497308 } });
    expect(formatOutboundBody({ type: 'share', data: { ...song, platform: 'qq', config: { appid: 205141 } } }))
      .toMatchObject({ config: { appid: 205141 } });
    expect(formatOutboundBody({ type: 'share', data: { ...song, platform: 'spotify' } })).not.toHaveProperty('config');
  });

  it('splits standalone elements into ordered messages, keeping the quote with the text', () => {
    const share = { type: 'share', data: { title: '晴天', url: 'https://music.example/1' } };
    expect(formatOutboundMessages([
      { type: 'reply', data: { message_id: 'm1' } },
      { type: 'text', data: { text: '找到了：' } },
      share,
      { type: 'text', data: { text: ' ' } },
      { type: 'file', data: { media: { kind: 'url', value: 'https://x/a.pdf' } } },
      { type: 'text', data: { text: '请查收' } },
    ])).toEqual([
      [{ type: 'reply', id: 'm1' }, '找到了：'],
      { type: 'share', title: '晴天', url: 'https://music.example/1' },
      { type: 'file', file: 'https://x/a.pdf' },
      '请查收',
    ]);
    expect(formatOutboundMessages([{ type: 'reply', data: { message_id: 'm1' } }, share]))
      .toEqual([{ type: 'share', title: '晴天', url: 'https://music.example/1' }]);
    expect(formatOutboundMessages('hi')).toEqual(['hi']);
    expect(formatOutboundMessageParts([{ type: 'reply', data: { message_id: 'm1' } }, share]))
      .toEqual([{ message: { type: 'share', title: '晴天', url: 'https://music.example/1' }, sourceIndices: [1] }]);
    expect(() => formatOutboundBody([{ type: 'text', data: { text: 'x' } }, share])).toThrow('standalone');
  });

  it('marks primitive text as exact only when ICQQ preserves every byte', () => {
    expect(formatOutboundMessageParts('hello')).toEqual([{ message: 'hello', sourceIndices: [0] }]);
    expect(formatOutboundMessageParts('  hello  ')).toEqual([{ message: 'hello' }]);
    expect(formatOutboundMessageParts(' \n ')).toEqual([{ message: '\u200b' }]);
    // Canonical text elements bypass primitive-string trimming.
    expect(formatOutboundMessageParts([{ type: 'text', data: { text: '  hello  ' } }]))
      .toEqual([{ message: '  hello  ', sourceIndices: [0] }]);
    expect(formatOutboundMessageParts([{ type: 'text', data: { text: ' \n ' } }]))
      .toEqual([{ message: '\u200b', sourceIndices: [] }]);
  });

  it('sends text followed by a share as two messages and preserves its unknown id slot', async () => {
    const endpoint = createEndpoint();
    await endpoint.start(new AbortController().signal);
    endpoint.open();
    const id = await endpoint.send({
      conversation: { endpoint: { id: 'test-endpoint', adapter: 'test' }, kind: 'group', id: '100' },
      payload: [{ type: 'text', data: { text: '找到了：' } }, { type: 'share', data: { title: '晴天', url: 'https://music.example/1' } }],
    });
    expect(id).toEqual({ parts: [{ messageId: 'sent-1', sourceIndices: [0] }, { sourceIndices: [1] }] });
    expect(endpoint.sendGroupMsg).toHaveBeenCalledWith(100, '找到了：');
    expect(endpoint.share).toHaveBeenCalledWith({ type: 'share', title: '晴天', url: 'https://music.example/1' });
    expect(endpoint.sendGroupMsg.mock.invocationCallOrder[0]).toBeLessThan(endpoint.share.mock.invocationCallOrder[0]!);
    await endpoint.stop();
  });

  it('retains every split bubble id with its own ordered source segments', async () => {
    const endpoint = createEndpoint();
    await endpoint.start(new AbortController().signal);
    endpoint.sendGroupMsg.mockResolvedValueOnce({ message_id: 'text-image' })
      .mockResolvedValueOnce({ message_id: 'audio' }).mockResolvedValueOnce({ message_id: 'tail' });
    const payload = [
      { type: 'text', data: { text: 'Before' } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://example.com/image.png' } } },
      { type: 'audio', data: { media: { kind: 'url', value: 'https://example.com/audio.mp3' } } },
      { type: 'text', data: { text: 'After' } },
    ];
    const result = await endpoint.send({ conversation: { endpoint: { id: 'test', adapter: 'icqq' }, kind: 'group', id: '100' }, payload });
    expect(result).toEqual({ parts: [
      { messageId: 'text-image', sourceIndices: [0, 1] },
      { messageId: 'audio', sourceIndices: [2] },
      { messageId: 'tail', sourceIndices: [3] },
    ] });
    expect(endpoint.sendGroupMsg).toHaveBeenCalledTimes(3);
    await endpoint.stop();
  });

  it('preserves unconfirmed share slots between confirmed text bubbles', async () => {
    const endpoint = createEndpoint();
    await endpoint.start(new AbortController().signal);
    endpoint.sendGroupMsg.mockResolvedValueOnce({ message_id: 'before' }).mockResolvedValueOnce({ message_id: 'after' });
    const result = await endpoint.send({ conversation: { endpoint: { id: 'test', adapter: 'icqq' }, kind: 'group', id: '100' },
      payload: [{ type: 'text', data: { text: 'Before' } },
        { type: 'share', data: { title: 'Card', url: 'https://example.com/card' } },
        { type: 'text', data: { text: 'After' } }],
    });
    expect(result).toEqual({ parts: [
      { messageId: 'before', sourceIndices: [0] }, { sourceIndices: [1] }, { messageId: 'after', sourceIndices: [2] },
    ] });
    expect(endpoint.getChatHistory).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('keeps file upload identifiers separate from platform message identities', async () => {
    const endpoint = createEndpoint();
    await endpoint.start(new AbortController().signal);
    const group = endpoint.pickGroup(100);
    const sendFile = vi.fn(async () => 'native-file-id');
    endpoint.pickGroup.mockReturnValue({ ...group, sendFile } as never);
    endpoint.sendGroupMsg.mockResolvedValueOnce({ message_id: 'before' }).mockResolvedValueOnce({ message_id: 'after' });
    const conversation = { endpoint: { id: 'test', adapter: 'icqq' }, kind: 'group' as const, id: '100' };
    const file = { type: 'file', data: { media: { kind: 'url', value: 'https://example.com/file.pdf' } } };
    const result = await endpoint.send({ conversation, payload: [
      { type: 'text', data: { text: 'Before' } }, file, { type: 'text', data: { text: 'After' } },
    ] });
    expect(result).toEqual({ parts: [
      { messageId: 'before', sourceIndices: [0] }, { sourceIndices: [1] }, { messageId: 'after', sourceIndices: [2] },
    ] });
    await expect(endpoint.send({ conversation, payload: file })).rejects.toMatchObject({
      code: 'delivery_unconfirmed', disposition: 'unknown', parts: [{ sourceIndices: [0] }],
    });
    expect(sendFile).toHaveBeenCalledTimes(2);
    await endpoint.stop();
  });

  it('reports a failure after the first delivered part as partial and unknown', async () => {
    const endpoint = createEndpoint();
    await endpoint.start(new AbortController().signal);
    endpoint.open();
    endpoint.share.mockRejectedValueOnce(new Error('share rejected'));
    const conversation = { endpoint: { id: 'test-endpoint', adapter: 'test' }, kind: 'group' as const, id: '100' };
    const share = { type: 'share', data: { title: '晴天', url: 'https://music.example/1' } };
    await expect(endpoint.send({ conversation, payload: [{ type: 'text', data: { text: '找到了' } }, share] }))
      .rejects.toMatchObject({ code: 'partial_delivery', disposition: 'unknown',
        parts: [{ messageId: 'sent-1', sourceIndices: [0] }], cause: { message: 'share rejected' } });
    endpoint.share.mockRejectedValueOnce(new Error('share rejected'));
    await expect(endpoint.send({ conversation, payload: [share, { type: 'text', data: { text: '找到了' } }] }))
      .rejects.toThrow('share rejected');
    await endpoint.stop();
  });

  it('retains unconfirmed completed sends when the next part fails and never retries either part', async () => {
    const endpoint = createEndpoint();
    await endpoint.start(new AbortController().signal);
    endpoint.sendGroupMsg.mockRejectedValueOnce(new Error('text outcome unknown'));
    const conversation = { endpoint: { id: 'test', adapter: 'icqq' }, kind: 'group' as const, id: '100' };
    await expect(endpoint.send({ conversation, payload: [
      { type: 'share', data: { title: 'Card', url: 'https://example.com/card' } },
      { type: 'text', data: { text: 'Never retry' } },
      { type: 'audio', data: { media: { kind: 'url', value: 'https://example.com/a.mp3' } } },
    ] })).rejects.toMatchObject({ code: 'partial_delivery', disposition: 'unknown',
      parts: [{ sourceIndices: [0] }], cause: { message: 'text outcome unknown' } });
    expect(endpoint.share).toHaveBeenCalledOnce();
    expect(endpoint.sendGroupMsg).toHaveBeenCalledOnce();
    await endpoint.stop();
  });

  it.each([false, true])('preserves send evidence when temporary media cleanup throws (partial=%s)', async partial => {
    const endpoint = createEndpoint();
    await endpoint.start(new AbortController().signal);
    const payload = [{ type: 'text', data: { text: 'Before' } },
      ...(partial ? [{ type: 'share', data: { title: 'Card', url: 'https://example.com/card' } }] : [])];
    const sendFailure = new Error('share send outcome unknown');
    if (partial) endpoint.share.mockRejectedValueOnce(sendFailure);
    const dispose = vi.fn(() => { throw new Error('temporary file cleanup failed'); });
    const prepare = vi.spyOn(outboundMedia, 'prepareIcqqOutboundMedia').mockReturnValue({ content: payload as never, dispose });
    try {
      const sending = endpoint.send({ conversation: { endpoint: { id: 'test', adapter: 'icqq' }, kind: 'group', id: '100' }, payload });
      if (partial) await expect(sending).rejects.toMatchObject({ code: 'partial_delivery', cause: sendFailure,
        parts: [{ messageId: 'sent-1', sourceIndices: [0] }] });
      else await expect(sending).resolves.toEqual({ parts: [{ messageId: 'sent-1', sourceIndices: [0] }] });
      expect(dispose).toHaveBeenCalledOnce();
      expect(endpoint.sendGroupMsg).toHaveBeenCalledOnce();
    } finally { prepare.mockRestore(); await endpoint.stop(); }
  });

  it('does not mistake a concurrent or similar own card for the share acknowledgement', async () => {
    const endpoint = createEndpoint();
    await endpoint.start(new AbortController().signal);
    endpoint.open();
    const self = Number(endpoint.uin);
    const now = Math.floor(Date.now() / 1000);
    endpoint.getChatHistory.mockResolvedValueOnce([
      { message_id: 'old-card', time: now - 60, sender: { user_id: self }, message: [{ type: 'json' }] },
      { message_id: 'someone-else', time: now, sender: { user_id: 42 }, message: [{ type: 'json' }] },
      { message_id: 'own-text', time: now, sender: { user_id: self }, message: [{ type: 'text' }] },
      { message_id: 'own-card', time: now, sender: { user_id: self }, message: [{ type: 'json' }] },
    ]);
    const conversation = { endpoint: { id: 'test-endpoint', adapter: 'test' }, kind: 'group' as const, id: '100' };
    await expect(endpoint.send({ conversation, payload: { type: 'share', data: { title: '晴天', url: 'https://y.qq.com/x' } } }))
      .rejects.toMatchObject({ code: 'delivery_unconfirmed', disposition: 'unknown', parts: [{ sourceIndices: [0] }] });
    expect(endpoint.getChatHistory).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('keeps a share unconfirmed without searching history or retrying the send', async () => {
    const endpoint = createEndpoint();
    await endpoint.start(new AbortController().signal);
    endpoint.open();
    const conversation = { endpoint: { id: 'test-endpoint', adapter: 'test' }, kind: 'group' as const, id: '100' };
    const share = { type: 'share', data: { title: '晴天', url: 'https://y.qq.com/x' } };
    await expect(endpoint.send({ conversation, payload: share })).rejects.toMatchObject({ code: 'delivery_unconfirmed', disposition: 'unknown' });
    expect(endpoint.getChatHistory).not.toHaveBeenCalled();
    endpoint.getChatHistory.mockImplementation(() => { throw new Error('history api missing'); });
    await expect(endpoint.send({ conversation, payload: share })).rejects.toMatchObject({ code: 'delivery_unconfirmed' });
    expect(endpoint.share).toHaveBeenCalledTimes(2);
    endpoint.getChatHistory.mockReset();
    await endpoint.stop();
  });

  it('uses artist as the native share summary when description is absent', () => {
    expect(formatOutboundBody({
      type: 'share',
      data: {
        title: '海阔天空',
        url: 'https://music.163.com/#/song?id=387717',
        artist: '信乐团',
      },
    })).toEqual({
      type: 'share',
      title: '海阔天空',
      url: 'https://music.163.com/#/song?id=387717',
      summary: '信乐团',
    });
  });

  it('send posts temp message (群容器内的 private 会话)', async () => {
    const endpoint = createEndpoint();
    await endpoint.start(new AbortController().signal);
    endpoint.open();
    await endpoint.send({
      conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'private',
        id: '2',
        parent: { kind: 'group', id: '100' },
      },
      payload: 'hi',
    });
    expect(endpoint.sendTempMsg).toHaveBeenCalledWith(100, 2, 'hi');
    await endpoint.stop();
  });

  it('send posts guild channel message (guild 容器内的 channel 会话)', async () => {
    const endpoint = createEndpoint();
    await endpoint.start(new AbortController().signal);
    endpoint.open();
    await endpoint.send({
      conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'channel',
        id: 'c1',
        parent: { kind: 'channel', id: 'g1' },
      },
      payload: 'hi',
    });
    expect(endpoint.sendGuildMsg).toHaveBeenCalledWith('g1', 'c1', 'hi');
    await endpoint.stop();
  });

  it('send throws a clear error after stop', async () => {
    const endpoint = createEndpoint();
    await endpoint.start(new AbortController().signal);
    await endpoint.stop();
    await expect(endpoint.send({
      conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'group',
        id: '100',
      },
      payload: 'x',
    })).rejects.toThrow(/未连接/);
  });

  it('exposes the live SDK Client through the endpoint operation client', async () => {
    const endpoint = createEndpoint();
    await endpoint.start(new AbortController().signal);
    const registered = endpoint;
    expect(registered).toBe(endpoint);
    expect(registered.fl.size).toBe(1);
    expect(registered.gl.size).toBe(1);
    await endpoint.stop();
  });

  it('defineAdapter exports frozen definition', () => {
    expect(defineIcqqAdapter.$feature).toBe('zhin.adapter/1');
    expect(defineIcqqAdapter.capabilities).toEqual(['inbound', 'outbound']);
  });

  it('adds and removes group reactions via Group.setReaction', async () => {
    const endpoint = createEndpoint();
    const message = {
      conversation: {
        endpoint: { id: 'icqq', adapter: 'icqq' },
        kind: 'group' as const,
        id: '100',
      },
      id: '42',
    };
    await expect(endpoint.control.addReaction!(message, '104')).resolves.toBe('104');
    expect(vi.mocked(endpoint.pickGroup)).toHaveBeenCalledWith(100);
    const group = vi.mocked(endpoint.pickGroup).mock.results[0]!.value;
    expect(group.setReaction).toHaveBeenCalledWith(42, '104');
    await endpoint.control.removeReaction!(message, '104');
    expect(group.delReaction).toHaveBeenCalledWith(42, '104');
  });

  it('does not wait for reaction protocol ACK (packet timeout must not stall send)', async () => {
    const endpoint = createEndpoint();
    const hung = new Promise<never>(() => undefined);
    vi.mocked(endpoint.pickGroup).mockReturnValue({
      setReaction: vi.fn(() => hung),
      delReaction: vi.fn(() => hung),
    });
    const message = {
      conversation: {
        endpoint: { id: 'icqq', adapter: 'icqq' },
        kind: 'group' as const,
        id: '100',
      },
      id: '42',
    };
    await expect(endpoint.control.addReaction!(message, '104')).resolves.toBe('104');
    await expect(endpoint.control.removeReaction!(message, '104')).resolves.toBeUndefined();
  });

  it('skips reactions in private chats and for outbound placeholders', async () => {
    const endpoint = createEndpoint();
    await expect(endpoint.control.addReaction!({
      conversation: {
        endpoint: { id: 'icqq', adapter: 'icqq' },
        kind: 'private',
        id: '2',
      },
      id: '42',
    }, '104')).resolves.toBeNull();
    await expect(endpoint.control.addReaction!({
      conversation: {
        endpoint: { id: 'icqq', adapter: 'icqq' },
        kind: 'group',
        id: '100',
      },
      id: 'outbound:1',
    }, '104')).resolves.toBeNull();
    expect(endpoint.pickGroup).not.toHaveBeenCalled();
  });
});

it('projects ICQQ online state independently from message admission', async () => {
  const endpoint = createEndpoint({ config: resolveIcqqConfig({ id: '10001', autoReconnect: true }) });
  expect(endpoint.transportState).toBe('idle');
  await endpoint.start(new AbortController().signal);
  expect(endpoint.transportState).toBe('open');
  endpoint.emit('system.offline.network', {} as never);
  expect(endpoint.transportState).toBe('reconnecting');
  endpoint.emit('system.online', {} as never);
  expect(endpoint.transportState).toBe('open');
  await endpoint.stop(); expect(endpoint.transportState).toBe('stopped');
});
it('rejects absent ICQQ receipts without inventing an id or resending', async () => {
  const endpoint = createEndpoint(); await endpoint.start(new AbortController().signal);
  const send = vi.spyOn(endpoint, 'sendGroupMsg').mockResolvedValue({} as never);
  await expect(endpoint.send({ conversation: { endpoint: { adapter: 'icqq', id: '10001' }, kind: 'group', id: '100' }, payload: 'hello' })).rejects.toMatchObject({ code: 'delivery_unconfirmed', disposition: 'unknown' });
  expect(send).toHaveBeenCalledOnce(); await endpoint.stop();
});

describe('icqq outage recovery', () => {
  it('notifies the configured master and retries login after kickoff', async () => {
    const notifier = { configured: true, send: vi.fn(async () => true) };
    const endpoint = createEndpoint({
      config: resolveIcqqConfig({
        id: '10001',
        autoReconnect: true,
        notify: { adapter: 'qq', endpoint: 'qq-bot', id: 'master-openid' },
      }),
      notifier,
    });
    await endpoint.start(new AbortController().signal);
    expect(endpoint.login).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    endpoint.emit('system.offline.kickoff', { message: 'kicked by another device' });
    expect(notifier.send).toHaveBeenCalledWith(expect.stringContaining('掉线'));
    expect(endpoint.transportState).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(5_000);
    expect(endpoint.login).toHaveBeenCalledTimes(2);
    expect(endpoint.loginControl.state()).toMatchObject({ endpointId: '10001', online: true });
    expect(notifier.send).toHaveBeenCalledWith(expect.stringContaining('已重新上线'));
    await endpoint.stop();
  });

  it('does not auto-relogin when autoReconnect is disabled', async () => {
    const notifier = { configured: true, send: vi.fn(async () => true) };
    const endpoint = createEndpoint({
      config: resolveIcqqConfig({ id: '10001', autoReconnect: false }),
      notifier,
    });
    await endpoint.start(new AbortController().signal);
    vi.useFakeTimers();
    endpoint.emit('system.offline.kickoff', { message: 'kicked' });
    expect(notifier.send).toHaveBeenCalledWith(expect.stringContaining('请手动重新登录'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(endpoint.login).toHaveBeenCalledTimes(1);
    await endpoint.stop();
  });

  it('exposes a login control for recovery commands', async () => {
    const endpoint = createEndpoint();
    await endpoint.start(new AbortController().signal);
    expect(endpoint.loginControl.pending()).toEqual([]);
    endpoint.emit('system.login.qrcode', { image: Buffer.from([1, 2, 3]) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [task] = endpoint.loginControl.pending();
    expect(task).toMatchObject({ type: 'qrcode', endpointKey: '10001' });
    expect(endpoint.loginControl.submit(task!.id, 'ok')).toBe(true);
    await endpoint.stop();
  });
});
