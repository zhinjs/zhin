import { describe, expect, it, vi, afterEach } from 'vitest';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
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
  formatInboundTarget,
  formatOutboundKmarkdown,
  isKookWebhookChallenge,
  normalizeKookWebhookEvent,
  parseSendTarget,
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
  name: 'test-kook-bot',
  token: 'test-token',
  connection: 'websocket',
}) as ReturnType<typeof resolveKookConfig> & { connection: 'websocket' };

const webhookConfig = resolveKookConfig({
  name: 'test-kook-bot',
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
    expect(resolved.name).toBe('kook-bot');
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

  it('formats inbound target and content', () => {
    expect(formatInboundTarget(textMessage())).toBe('channel:chan-1');
    expect(formatInboundTarget(textMessage({
      channelKind: 'private',
      channelId: 'user-1',
    }))).toBe('private:user-1');
    expect(formatInboundContent(textMessage())).toBe('hello');
    expect(parseSendTarget('channel:chan-1')).toEqual({ kind: 'channel', id: 'chan-1' });
    expect(parseSendTarget('private:user-1')).toEqual({ kind: 'private', id: 'user-1' });
  });

  it('formats outbound string and segment payloads', () => {
    expect(formatOutboundKmarkdown('pong')).toBe('pong');
    expect(formatOutboundKmarkdown([
      { type: 'text', data: { text: 'hi ' } },
      { type: 'at', data: { id: 'u1' } },
    ])).toBe('hi (met)u1(met)');
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
      target: 'channel:chan-1',
      content: 'hello',
      sender: 'alice',
      id: 'msg-1',
    }));

    await endpoint.stop();
    expect(mock.connect).toHaveBeenCalled();
    expect(mock.disconnect).toHaveBeenCalled();
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
    const channelId = await endpoint.send({ target: 'channel:chan-1', payload: 'pong' });
    expect(channelId).toBe('sent-1');
    expect(mock.sent[0]).toEqual({ kind: 'channel', id: 'chan-1', message: 'pong' });

    const privateId = await endpoint.send({ target: 'private:user-1', payload: 'dm' });
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
      target: 'channel:chan-1',
      content: 'hello',
      sender: 'alice',
      id: 'msg-1',
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
