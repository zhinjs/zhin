import { describe, expect, it, vi, afterEach } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import type { MessageGateway } from '@zhin.js/core/runtime';

vi.mock('@icqqjs/icqq', async () => import('./_icqq-mock.js'));

import defineIcqqAdapter from '../adapters/icqq.js';
import { IcqqEndpoint } from '../src/endpoint.js';
import {
  formatOutboundBody,
  icqqInboundConversation,
  icqqOutboundTarget,
  resolveIcqqConfig,
} from '../src/protocol.js';
import { getIcqqAgentDeps, setIcqqAgentDeps } from '../src/icqq-agent-deps.js';
import {
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
  gateway?: MessageGateway;
  friends?: Map<number, unknown>;
  groups?: Map<number, unknown>;
  config?: ReturnType<typeof resolveIcqqConfig>;
} = {}): IcqqEndpoint {
  const receive = overrides.receive ?? vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
  const gateway = overrides.gateway ?? { receive, send: vi.fn(async () => 'sent') };
  const endpoint = new IcqqEndpoint({
    id: capabilityId(rootPluginId(), adapterFeature, 'icqq'),
    gateway,
    config: overrides.config ?? baseConfig,
    ...createIcqqTestPorts(),
  });
  const friends = overrides.friends ?? new Map([[2, { user_id: 2, nickname: 'bob', sex: 'unknown', age: 0 }]]);
  const groups = overrides.groups ?? new Map([[100, { group_id: 100, group_name: 'g', member_count: 1, max_member_count: 200, owner_id: 1, admin_flag: false, last_join_time: 0, last_sent_time: 0, shutup_time_whole: 0, shutup_time_me: 0, create_time: 0, grade: 0, max_admin_count: 0, active_member_count: 0 }]]);
  for (const [k, v] of friends) endpoint.fl.set(k, v as never);
  for (const [k, v] of groups) endpoint.gl.set(k, v as never);
  return endpoint;
}

afterEach(() => {
  vi.useRealTimers();
  setIcqqAgentDeps(null);
});

describe('icqq protocol helpers', () => {
  it('resolves numeric id config', () => {
    const resolved = resolveIcqqConfig({ id: '12345' });
    expect(resolved.id).toBe('12345');
    expect(resolved.autoReconnect).toBe(true);
    expect(resolved.context).toBe('icqq');
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

  it('admits message events via MessageGateway when open', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const endpoint = createEndpoint({ receive });
    await endpoint.start(new AbortController().signal);
    endpoint.open();

    (endpoint as any).emit('message.group.normal', {
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

    (endpoint as any).emit('message.group.normal', {
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

    (endpoint as any).emit('message.group.normal', {
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

    (endpoint as any).emit('message.group.normal', {
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

    (endpoint as any).emit('message.group.normal', {
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

    (endpoint as any).emit('message.group.normal', {
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

    (endpoint as any).emit('message.group.normal', {
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
    expect(id).toBe('sent-1');
    expect(endpoint.sendGroupMsg).toHaveBeenCalledWith(100, 'pong');
    await endpoint.stop();
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

  it('registers agent endpoint with fl/gl cache', async () => {
    const endpoint = createEndpoint();
    await endpoint.start(new AbortController().signal);
    const registered = getIcqqAgentDeps().getEndpoint('10001');
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
