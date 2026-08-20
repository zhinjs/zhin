import { describe, expect, it, vi, afterEach } from 'vitest';
import { createEndpointRuntimeState, listEndpointManagementCapabilities } from 'zhin.js/adapter';
import { kookRuntimeStateToken } from '../src/kook-runtime-state.js';
import { capabilityId, featureId, rootPluginId } from 'zhin.js/plugin-runtime';
import { messageGatewayToken, type MessageGateway } from '@zhin.js/core/runtime';
import { createHttpHost, httpHostToken } from '@zhin.js/host-http';
import defineKookAdapter from '../adapters/kook.js';
import {
  KookWebhookEndpoint,
  KookWebsocketEndpoint,
} from '../src/endpoint.js';
import {
  type CreateKookClient,
  type KookClientTransport,
} from '../src/ws.js';
import {
  formatInboundContent,
  formatOutboundKmarkdown,
  isKookWebhookChallenge,
  kookInboundConversation,
  normalizeKookWebhookEvent,
  resolveKookConfig,
  verifyKookWebhookToken,
  type KookInboundMessage,
  type KookWebhookEventData,
} from '../src/protocol.js';
import { getKookAgentDeps, setKookAgentDeps } from '../src/kook-agent-deps.js';

const adapterFeature = featureId('zhin.adapter');
const hosts: ReturnType<typeof createHttpHost>[] = [];
const VERIFY_TOKEN = 'verify-tok';

const baseConfig = resolveKookConfig({
  id: 'test-kook-bot',
  token: 'test-token',
  connection: 'websocket',
}) as ReturnType<typeof resolveKookConfig> & { connection: 'websocket' };

const webhookConfig = resolveKookConfig({
  id: 'test-kook-bot',
  token: 'test-token',
  connection: 'webhook',
  verify_token: VERIFY_TOKEN,
  webhookPath: '/kook/webhook',
}) as ReturnType<typeof resolveKookConfig> & { connection: 'webhook' };

function textMessage(overrides: Partial<KookInboundMessage> = {}): KookInboundMessage {
  return {
    id: 'msg-1',
    content: 'hello',
    channelKind: 'channel',
    channelId: 'chan-1',
    authorId: 'user-1',
    authorName: 'alice',
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function createMockClient(): KookClientTransport & {
  sent: Array<{ kind: string; id: string; message: string }>;
  init: ReturnType<typeof vi.fn>;
} {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const sent: Array<{ kind: string; id: string; message: string }> = [];

  return {
    sent,
    self_id: 'bot-1',
    init: vi.fn(async () => undefined),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
    },
    removeAllListeners: vi.fn(() => {
      listeners.clear();
    }),
    sendChannelMsg: vi.fn(async (id: string, message: string) => {
      sent.push({ kind: 'channel', id, message });
      return { msg_id: `sent-${sent.length}` };
    }),
    sendPrivateMsg: vi.fn(async (id: string, message: string) => {
      sent.push({ kind: 'private', id, message });
      return { msg_id: `sent-${sent.length}` };
    }),
    pickGuild: vi.fn(() => ({
      kick: vi.fn(async () => true),
      getRoleList: vi.fn(async () => [
        { role_id: 'role-1', name: 'Admin', color: 0xff0000, position: 1 },
      ]),
      createRole: vi.fn(async (name: string) => ({ role_id: 'role-new', name })),
      deleteRole: vi.fn(async () => true),
    })),
    pickGuildMember: vi.fn(() => ({
      addToBlackList: vi.fn(async () => true),
      removeFromBlackList: vi.fn(async () => true),
      grant: vi.fn(async () => true),
      revoke: vi.fn(async () => true),
      setNickname: vi.fn(async () => true),
    })),
    getGuildList: vi.fn(async () => [
      { id: '9876543210987654321', name: 'Guild' },
    ]),
    getChannelList: vi.fn(async (guildId: string) => [
      { id: 'chan-text', name: 'general', type: 1, is_category: false },
      { id: 'chan-voice', name: 'Voice', type: 2, is_category: false },
      { id: 'cat-1', name: 'Category', type: 1, is_category: true },
    ]),
    getGuildUserList: vi.fn(async (guildId: string) => [
      { id: 'user-1', username: 'alice', nickname: 'Alice', online: true },
    ]),
  };
}

afterEach(async () => {
  setKookAgentDeps(null);
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

function webhookMessageEvent(overrides: Partial<KookWebhookEventData> = {}): KookWebhookEventData {
  return {
    channel_type: 'GROUP',
    type: 1,
    target_id: 'chan-1',
    author_id: 'user-1',
    content: 'hello',
    msg_id: 'msg-1',
    msg_timestamp: 1_700_000_000_000,
    verify_token: VERIFY_TOKEN,
    extra: {
      guild_id: 'guild-1',
      author: { id: 'user-1', username: 'alice', bot: false },
    },
    ...overrides,
  };
}

describe('kook protocol helpers', () => {
  it('resolves plugin config with websocket default', () => {
    const resolved = resolveKookConfig({ token: 'tok' });
    expect(resolved.connection).toBe('websocket');
    expect(resolved.id).toBe('kook-bot');
  });

  it('selects webhook mode when configured', () => {
    const resolved = resolveKookConfig({
      token: 'tok',
      connection: 'webhook',
      verify_token: VERIFY_TOKEN,
    });
    expect(resolved.connection).toBe('webhook');
    if (resolved.connection === 'webhook') {
      expect(resolved.webhookPath).toBe('/kook/webhook');
      expect(resolved.verifyToken).toBe(VERIFY_TOKEN);
    }
  });

  it('detects webhook challenge and verifies token', () => {
    const challenge: KookWebhookEventData = {
      type: 255,
      channel_type: 'WEBHOOK_CHALLENGE',
      challenge: 'abc',
      verify_token: VERIFY_TOKEN,
    };
    expect(isKookWebhookChallenge(challenge)).toBe(true);
    expect(verifyKookWebhookToken(VERIFY_TOKEN, VERIFY_TOKEN)).toBe(true);
    expect(verifyKookWebhookToken(VERIFY_TOKEN, 'bad')).toBe(false);
  });

  it('normalizes webhook message events', () => {
    const msg = normalizeKookWebhookEvent(webhookMessageEvent());
    expect(msg).toEqual(expect.objectContaining({
      id: 'msg-1',
      content: 'hello',
      channelKind: 'channel',
      channelId: 'chan-1',
      authorId: 'user-1',
      authorName: 'alice',
    }));
  });

  it('formats inbound content', () => {
    expect(formatInboundContent(textMessage())).toBe('hello');
  });

  it('normalizes inbound messages into ConversationRef', () => {
    expect(kookInboundConversation('plugin\0kook', textMessage({ guildId: 'guild-1' }))).toEqual({
      endpoint: { id: 'plugin\0kook', adapter: 'plugin' },
      kind: 'channel',
      id: 'chan-1',
      parent: { kind: 'channel', id: 'guild-1' },
    });
    // 私聊（PERSON）无 guild 容器，即使事件携带 guild_id 也不进 parent
    expect(kookInboundConversation('plugin\0kook', textMessage({
      channelKind: 'private',
      channelId: 'user-1',
      guildId: 'guild-1',
    }))).toEqual({
      endpoint: { id: 'plugin\0kook', adapter: 'plugin' },
      kind: 'private',
      id: 'user-1',
    });
  });

  it('formats outbound string and segment payloads', () => {
    expect(formatOutboundKmarkdown('pong')).toBe('pong');
    expect(formatOutboundKmarkdown([
      { type: 'text', data: { text: 'hi ' } },
      { type: 'at', data: { id: 'u1' } },
    ])).toBe('hi (met)u1(met)');
  });

  it('renders canonical url media segments as KMarkdown links', () => {
    expect(formatOutboundKmarkdown([
      { type: 'text', data: { text: '看图 ' } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://example.com/a.png' } } },
    ])).toBe('看图 ![图片](https://example.com/a.png)');
    expect(formatOutboundKmarkdown([
      { type: 'video', data: { media: { kind: 'url', value: 'https://example.com/v.mp4' } } },
      { type: 'audio', data: { media: { kind: 'url', value: 'https://example.com/a.mp3' } } },
      { type: 'file', data: { name: 'report.pdf', media: { kind: 'url', value: 'https://example.com/f.pdf' } } },
    ])).toBe('[视频](https://example.com/v.mp4)[音频](https://example.com/a.mp3)[文件: report.pdf](https://example.com/f.pdf)');
  });

  it('drops media segments without a deliverable url MediaRef', () => {
    // base64 / path / file 引用无法经 KMarkdown 投递，warn 后丢弃
    expect(formatOutboundKmarkdown([
      { type: 'text', data: { text: 'hi' } },
      { type: 'image', data: { media: { kind: 'base64', value: 'aGk=', mime_type: 'image/png' } } },
    ])).toBe('hi');
    expect(formatOutboundKmarkdown([
      { type: 'image', data: { media: { kind: 'path', value: '/tmp/a.png' } } },
    ])).toBe('');
    // 无 canonical media 引用同样丢弃
    expect(formatOutboundKmarkdown([{ type: 'image', data: {} }])).toBe('');
  });
});

describe('kook plugin runtime adapter', () => {
  it('routes admitted messages through MessageGateway when open', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const mock = createMockClient();
    const createClient: CreateKookClient = () => mock;
    const endpoint = new KookWebsocketEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'kook'),
      gateway,
      config: baseConfig,
      createClient,
    });

    await endpoint.start();
    endpoint.open();
    endpoint.admit(textMessage());

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      conversation: expect.objectContaining({ kind: 'channel', id: 'chan-1' }),
      message: expect.objectContaining({ id: 'msg-1' }),
      content: 'hello',
      sender: expect.objectContaining({ id: 'user-1', name: 'alice' }),
    }));

    await endpoint.stop();
    expect(mock.connect).toHaveBeenCalled();
    expect(mock.disconnect).toHaveBeenCalled();
  });

  it('marks mentioned when channel message @s the bot', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const mock = createMockClient(); // self_id = 'bot-1'
    const endpoint = new KookWebsocketEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'kook'),
      gateway,
      config: baseConfig,
      createClient: () => mock,
    });
    await endpoint.start();
    endpoint.open();

    endpoint.admit(textMessage({ content: '(met)bot-1(met) 在吗' }));
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
    expect(receive).toHaveBeenNthCalledWith(1, expect.objectContaining({
      conversation: expect.objectContaining({ kind: 'channel', id: 'chan-1' }),
      mentioned: true,
    }));

    endpoint.admit(textMessage({ id: 'msg-2', content: '(met)someone-else(met) 在吗' }));
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(2));
    const metadata = receive.mock.calls[1]?.[0]?.metadata as Record<string, unknown>;
    expect(receive.mock.calls[receive.mock.calls.length - 1]?.[0]?.mentioned).toBeFalsy();
    await endpoint.stop();
  });

  it('does not admit inbound while closed', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const mock = createMockClient();
    const endpoint = new KookWebsocketEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'kook'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createClient: () => mock,
    });
    await endpoint.start();
    endpoint.admit(textMessage());
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('sends outbound payloads via channel / private APIs', async () => {
    const mock = createMockClient();
    const endpoint = new KookWebsocketEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'kook'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createClient: () => mock,
    });
    await endpoint.start();
    const channelId = await endpoint.send({
      conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'channel',
        id: 'chan-1',
      },
      payload: 'pong',
    });
    expect(channelId).toBe('sent-1');
    expect(mock.sent[0]).toEqual({ kind: 'channel', id: 'chan-1', message: 'pong' });

    const privateId = await endpoint.send({
      conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'private',
        id: 'user-1',
      },
      payload: 'dm',
    });
    expect(privateId).toBe('sent-2');
    expect(mock.sent[1]).toEqual({ kind: 'private', id: 'user-1', message: 'dm' });
    await endpoint.stop();
  });

  it('registers agent endpoint for tools', async () => {
    const mock = createMockClient();
    const endpoint = new KookWebsocketEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'kook'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createClient: () => mock,
    });
    await endpoint.start();
    const roles = await getKookAgentDeps().getEndpoint('test-kook-bot').getRoleList('guild-1');
    expect(roles).toHaveLength(1);
    expect(roles[0].name).toBe('Admin');
    await endpoint.stop();
  });

  it('creates webhook endpoint when httpHostToken provided', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const gateway: MessageGateway = {
      receive: vi.fn(async () => Object.freeze({ matched: false })),
      send: vi.fn(async () => 'sent'),
    };
    const endpoint = defineKookAdapter.create({
      id: capabilityId(rootPluginId(), adapterFeature, 'kook'),
      name: 'kook',
      config: {
        token: 'tok',
        connection: 'webhook',
        verify_token: VERIFY_TOKEN,
      },
      use: (token: unknown) => {
        if (token === httpHostToken) return http;
        if (token === messageGatewayToken) return gateway;
        if (token === kookRuntimeStateToken) return createEndpointRuntimeState();
        throw new Error(`unexpected token: ${String(token)}`);
      },
    } as never);
    expect(endpoint).toBeInstanceOf(KookWebhookEndpoint);
    await http.close().catch(() => undefined);
  });

  it('handles webhook challenge and routes messages through MessageGateway', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const mock = createMockClient();
    const createClient: CreateKookClient = () => mock;
    const endpoint = new KookWebhookEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'kook'),
      gateway,
      http,
      config: webhookConfig,
      createClient,
    });

    await endpoint.start();
    const { port } = await http.listen();
    endpoint.open();
    const challengeRes = await globalThis.fetch(`http://127.0.0.1:${port}/kook/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        s: 0,
        d: {
          type: 255,
          channel_type: 'WEBHOOK_CHALLENGE',
          challenge: 'challenge-123',
          verify_token: VERIFY_TOKEN,
        },
      }),
    });
    expect(challengeRes.status).toBe(200);
    expect(await challengeRes.json()).toEqual({ challenge: 'challenge-123' });

    const messageRes = await globalThis.fetch(`http://127.0.0.1:${port}/kook/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        s: 0,
        sn: 1,
        d: webhookMessageEvent(),
      }),
    });
    expect(messageRes.status).toBe(200);
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      conversation: expect.objectContaining({
        kind: 'channel',
        id: 'chan-1',
        parent: { kind: 'channel', id: 'guild-1' },
      }),
      message: expect.objectContaining({ id: 'msg-1' }),
      content: 'hello',
      sender: expect.objectContaining({ id: 'user-1', name: 'alice' }),
    }));

    const badRes = await globalThis.fetch(`http://127.0.0.1:${port}/kook/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        s: 0,
        sn: 2,
        d: webhookMessageEvent({ verify_token: 'wrong' }),
      }),
    });
    expect(badRes.status).toBe(403);

    await endpoint.stop();
    expect(mock.init).toHaveBeenCalled();
  });
});


describe('kook.endpoint management', () => {
  const GUILD_ID = '9876543210987654321';

  function createManagementEndpoint(mock: KookClientTransport) {
    return new KookWebsocketEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'kook'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createClient: () => mock,
    });
  }

  it('advertises only implemented management capabilities', async () => {
    const endpoint = createManagementEndpoint(createMockClient());
    await endpoint.start();
    expect(listEndpointManagementCapabilities(endpoint)).toEqual([
      'listGroups',
      'listChannels',
      'listGroupMembers',
    ]);
    await endpoint.stop();
  });

  it('lists guilds without losing snowflake precision', async () => {
    const endpoint = createManagementEndpoint(createMockClient());
    await endpoint.start();
    // snowflake 超 Number.MAX_SAFE_INTEGER，保留原始字符串
    await expect(endpoint.management.listGroups?.()).resolves.toEqual([
      { group_id: GUILD_ID, name: 'Guild' },
    ]);
    await endpoint.stop();
  });

  it('lists only text channels with guild parent', async () => {
    const endpoint = createManagementEndpoint(createMockClient());
    await endpoint.start();
    await expect(endpoint.management.listChannels?.()).resolves.toEqual([
      {
        id: 'chan-text',
        name: 'general',
        parent: { type: 'guild', id: GUILD_ID, name: 'Guild' },
      },
    ]);
    await endpoint.stop();
  });

  it('lists guild members in platform shape', async () => {
    const mock = createMockClient();
    const endpoint = createManagementEndpoint(mock);
    await endpoint.start();
    await expect(endpoint.management.listGroupMembers?.(GUILD_ID)).resolves.toEqual([
      { id: 'user-1', username: 'alice', nickname: 'Alice', online: true },
    ]);
    expect(mock.getGuildUserList).toHaveBeenCalledWith(GUILD_ID);
    await endpoint.stop();
  });

  it('rejects management calls before the client connects', async () => {
    const endpoint = createManagementEndpoint(createMockClient());
    await expect(endpoint.management.listGroups?.()).rejects.toThrow('not connected');
  });
});
