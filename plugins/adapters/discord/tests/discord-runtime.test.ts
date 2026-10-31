import { discordFixture, managedDiscordFixture } from './fixture.js';
import { Status } from 'discord.js';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  listEndpointManagementCapabilities,
  resolveAdapterOperations,
} from 'zhin.js/adapter';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { createHttpHost, httpHostToken } from '@zhin.js/host-http';
import { outboundMessageToken, sideEventGatewayToken, type OutboundMessageService } from '@zhin.js/core/runtime';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import defineDiscordAdapter from '../adapters/discord/index.js';
import {
  DiscordGatewayEndpoint,
  DiscordInteractionsEndpoint,
  type DiscordClientTransport,
} from '../src/endpoint.js';
import {
  discordInboundConversation,
  formatButtonContent,
  formatButtonSegments,
  formatInboundContent,
  formatInboundSegments,
  formatOutboundBody,
  resolveDiscordConfig,
  verifyDiscordInteractionSignature,
  type DiscordInboundMessage,
} from '../src/protocol.js';
import { toMessageCreateOptions } from '../src/gateway.js';

const adapterFeature = featureId('zhin.adapter');

const baseConfig = resolveDiscordConfig({
  id: 'test-discord-bot',
  token: 'test-token',
  connection: 'gateway',
}) as ReturnType<typeof resolveDiscordConfig> & { connection: 'gateway' };

function textMessage(overrides: Partial<DiscordInboundMessage> = {}): DiscordInboundMessage {
  return {
    id: 'msg-1',
    content: 'hello',
    channelId: 'chan-1',
    channelKind: 'channel',
    authorId: 'user-1',
    authorName: 'alice',
    createdTimestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function createMockClient(): DiscordClientTransport & {
  emitReady: () => void;
  emitError: (error: Error) => void;
  emitMessage: (raw: unknown) => void;
  sent: Array<{ channelId: string; options: unknown }>;
} {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const onceListeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const sent: Array<{ channelId: string; options: unknown }> = [];

  const on = (event: string, listener: (...args: unknown[]) => void) => {
    const list = listeners.get(event) ?? [];
    list.push(listener);
    listeners.set(event, list);
  };
  const once = (event: string, listener: (...args: unknown[]) => void) => {
    const list = onceListeners.get(event) ?? [];
    list.push(listener);
    onceListeners.set(event, list);
  };

  return {
    sent,
    user: { id: 'bot-1', tag: 'TestBot#0001', setActivity: vi.fn() },
    login: vi.fn(async () => {
      queueMicrotask(() => {
        for (const listener of onceListeners.get('clientReady') ?? []) listener();
        onceListeners.delete('clientReady');
      });
      return 'bot-1';
    }),
    destroy: vi.fn(async () => undefined),
    on,
    once,
    removeAllListeners: vi.fn(() => {
      listeners.clear();
      onceListeners.clear();
    }),
    channels: {
      fetch: vi.fn(async (id: string) => ({
        id,
        type: 0,
        isTextBased: () => true,
        isSendable: () => true,
        send: vi.fn(async (options: unknown) => {
          sent.push({ channelId: id, options });
          return { id: `sent-${sent.length}` };
        }),
        messages: {
          fetch: vi.fn(async () => ({
            react: vi.fn(async () => undefined),
            reactions: {
              resolve: () => null,
              cache: { find: () => undefined },
            },
          })),
        },
        threads: {
          create: vi.fn(async () => ({ id: 'thread-1' })),
        },
      })),
    },
    guilds: {
      fetch: vi.fn(async (id: string) => ({
        id,
        name: 'Guild',
        ownerId: 'owner-1',
        memberCount: 10,
        createdAt: new Date(0),
        iconURL: () => null,
        roles: {
          fetch: vi.fn(async () => undefined),
          cache: new Map([
            ['role-1', {
              id: 'role-1',
              name: 'Admin',
              hexColor: '#ff0000',
              position: 1,
              permissions: { bitfield: 8n },
            }],
          ]),
        },
        members: {
          fetch: vi.fn(async (userId: string | { limit?: number }) => {
            if (typeof userId === 'object') {
              return new Map([
                ['user-1', {
                  id: 'user-1',
                  user: { username: 'alice' },
                  nickname: null,
                  roles: { cache: { map: (fn: (r: { id: string }) => string) => [fn({ id: 'role-1' })] } },
                  joinedAt: new Date(0),
                }],
              ]);
            }
            return {
              id: userId,
              roles: {
                add: vi.fn(async () => undefined),
                remove: vi.fn(async () => undefined),
              },
              kick: vi.fn(async () => undefined),
              timeout: vi.fn(async () => undefined),
              setNickname: vi.fn(async () => undefined),
            };
          }),
          ban: vi.fn(async () => undefined),
          unban: vi.fn(async () => undefined),
        },
      })),
      cache: { values: () => [][Symbol.iterator]() },
    },
    emitReady() {
      for (const listener of onceListeners.get('clientReady') ?? []) listener();
      onceListeners.delete('clientReady');
    },
    emitMessage(raw: unknown) {
      for (const listener of listeners.get('messageCreate') ?? []) listener(raw);
    },
    emitError(error: Error) {
      for (const listener of listeners.get('error') ?? []) listener(error);
    },
  };
}

afterEach(() => {
});

describe('discord protocol helpers', () => {
  function ed25519Fixture() {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicKeyHex = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
    const sign = (timestamp: string, body: string) =>
      cryptoSign(null, Buffer.from(timestamp + body), privateKey).toString('hex');
    return { publicKeyHex, sign };
  }

  it('verifies ed25519 interaction signatures within the freshness window', () => {
    const { publicKeyHex, sign } = ed25519Fixture();
    const body = '{"type":1}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    expect(verifyDiscordInteractionSignature(publicKeyHex, body, sign(timestamp, body), timestamp)).toBe(true);
    expect(verifyDiscordInteractionSignature(publicKeyHex, body, 'bad', timestamp)).toBe(false);
  });

  it('rejects interaction signatures outside the ±5min freshness window', () => {
    const { publicKeyHex, sign } = ed25519Fixture();
    const body = '{"type":1}';
    const stale = String(Math.floor(Date.now() / 1000) - 600);
    // 签名本身有效，仅时间戳过期
    expect(verifyDiscordInteractionSignature(publicKeyHex, body, sign(stale, body), stale)).toBe(false);
    expect(verifyDiscordInteractionSignature(publicKeyHex, body, sign('x', body), 'not-a-number')).toBe(false);
  });

  it('resolves plugin config with gateway default', () => {
    const resolved = resolveDiscordConfig({ id: 'discord-bot', token: 'tok' });
    expect(resolved.connection).toBe('gateway');
    expect(resolved.id).toBe('discord-bot');
  });

  it('selects interactions mode when configured', () => {
    const resolved = resolveDiscordConfig({
      id: 'discord-bot',
      token: 'tok',
      connection: 'interactions',
      applicationId: 'app',
      publicKey: 'pk',
    });
    expect(resolved.connection).toBe('interactions');
    if (resolved.connection === 'interactions') {
      expect(resolved.interactionsPath).toBe('/discord/interactions');
    }
  });

  it('maps inbound channel kinds to ConversationRef with guild container as parent', () => {
    // guild 频道：kind 'channel' + guild 容器进 parent
    expect(discordInboundConversation('test-endpoint', {
      channelId: 'chan-1',
      channelKind: 'channel',
      guildId: 'guild-1',
    })).toEqual({
      endpoint: { id: 'test-endpoint', adapter: 'test-endpoint' },
      kind: 'channel',
      id: 'chan-1',
      parent: { kind: 'channel', id: 'guild-1' },
    });
    // DM：'private'，无 parent
    expect(discordInboundConversation('test-endpoint', {
      channelId: 'dm-1',
      channelKind: 'private',
    })).toEqual({
      endpoint: { id: 'test-endpoint', adapter: 'test-endpoint' },
      kind: 'private',
      id: 'dm-1',
    });
    // GroupDM：'group'，无 guild 容器
    expect(discordInboundConversation('plugin\0feature\0discord', {
      channelId: 'gdm-1',
      channelKind: 'group',
    })).toEqual({
      endpoint: { id: 'plugin\0feature\0discord', adapter: 'plugin' },
      kind: 'group',
      id: 'gdm-1',
    });
  });

  it('formats inbound content by message kind', () => {
    expect(formatInboundContent(textMessage())).toBe('hello');
    expect(formatInboundContent(textMessage({
      content: '',
      attachments: [{ contentType: 'image/png', name: 'a.png' }],
    }))).toBe('');
    expect(formatInboundContent(textMessage({
      content: '',
      embedTitles: ['Title'],
    }))).toBe('[embed: Title]');
    expect(formatButtonContent({
      id: 'i1',
      customId: 'btn:1',
      channelId: 'c1',
      channelKind: 'channel',
      userId: 'u1',
      userName: 'alice',
    })).toBe('[action: btn:1]');
  });

  it('maps attachments to canonical media segments (url MediaRef)', () => {
    // 无附件消息：仅文本段，行为不变
    expect(formatInboundSegments(textMessage())).toEqual([
      { type: 'text', data: { text: 'hello' } },
    ]);
    expect(formatInboundSegments(textMessage({
      content: '',
      replyToId: 'msg-0',
      attachments: [
        { contentType: 'image/png', name: 'a.png', url: 'https://cdn.discord/a.png' },
        { contentType: 'application/pdf', name: 'b.pdf', url: 'https://cdn.discord/b.pdf' },
        { contentType: 'video/mp4', url: 'https://cdn.discord/c.mp4' },
      ],
    }))).toEqual([
      { type: 'reply', data: { message_id: 'msg-0' } },
      {
        type: 'image',
        data: {
          media: { kind: 'url', value: 'https://cdn.discord/a.png', mime_type: 'image/png' },
          alt: 'a.png',
        },
      },
      {
        type: 'file',
        data: {
          media: { kind: 'url', value: 'https://cdn.discord/b.pdf', mime_type: 'application/pdf' },
          name: 'b.pdf',
        },
      },
      {
        type: 'video',
        data: { media: { kind: 'url', value: 'https://cdn.discord/c.mp4', mime_type: 'video/mp4' } },
      },
    ]);
    // 无 url 附件跳过，不产空媒体段
    expect(formatInboundSegments(textMessage({
      content: '',
      attachments: [{ contentType: 'image/png', name: 'no-url.png' }],
    }))).toEqual([]);
  });

  it('maps button custom_id to action segment', () => {
    expect(formatButtonSegments({
      id: 'i1',
      customId: 'btn:1',
      channelId: 'c1',
      channelKind: 'channel',
      userId: 'u1',
      userName: 'alice',
      sourceMessageId: 'msg-9',
    })).toEqual([
      { type: 'action', data: { id: 'i1', payload: 'btn:1', sourceMessageId: 'msg-9' } },
    ]);
  });

  it('formats outbound string and segment payloads', () => {
    expect(defineDiscordAdapter.segments?.markdown).toBe('native');
    expect(formatOutboundBody('pong')).toEqual({ content: 'pong' });
    expect(formatOutboundBody([
      { type: 'text', data: { text: 'see' } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://example.com/a.png' }, name: 'a.png' } },
    ])).toEqual({
      content: 'see',
      files: [{ name: 'a.png', url: 'https://example.com/a.png' }],
    });
    expect(formatOutboundBody([
      { type: 'markdown', data: { content: '# Title\n\n**important**' } },
    ])).toEqual({ content: '# Title\n\n**important**' });
  });

  it('declares reaction only for the gateway Endpoint mode', () => {
    expect(resolveAdapterOperations(defineDiscordAdapter, {
      config: { connection: 'gateway' },
    } as never)).toEqual(['recall', 'reaction']);
    expect(resolveAdapterOperations(defineDiscordAdapter, {
      config: { connection: 'interactions' },
    } as never)).toEqual(['recall']);
  });

  it('maps canonical MediaRef media to outbound files and drops unusable media with a warn', () => {
    expect(formatOutboundBody([
      { type: 'image', data: { media: { kind: 'base64', value: 'aGk=', file_name: 'hi.png' } } },
      { type: 'file', data: { media: { kind: 'path', value: '/tmp/a.pdf' }, name: 'a.pdf' } },
    ])).toEqual({
      files: [
        { name: 'hi.png', base64: 'aGk=' },
        { name: 'a.pdf', file: '/tmp/a.pdf' },
      ],
    });
    // 无 media / 平台不透明引用（Discord 无 file_id 概念）：warn + 丢弃
    expect(formatOutboundBody([
      { type: 'text', data: { text: 'hi' } },
      { type: 'image', data: {} },
      { type: 'image', data: { media: { kind: 'file', value: 'opaque-ref' } } },
    ])).toEqual({ content: 'hi' });
  });

  it('gives unnamed MIME images a previewable filename while preserving explicit names', () => {
    expect(formatOutboundBody([
      { type: 'image', data: { media: { kind: 'base64', value: 'aGk=', mime_type: 'image/png' } } },
      { type: 'image', data: { media: { kind: 'base64', value: 'aGk=', mime_type: 'image/png', file_name: 'custom.png' } } },
    ])).toEqual({ files: [
      { name: 'image.png', base64: 'aGk=' },
      { name: 'custom.png', base64: 'aGk=' },
    ] });
  });

  it('carries canonical reply references through to Discord SDK send options', async () => {
    const body = formatOutboundBody([
      { type: 'reply', data: { message_id: '123456789' } },
      { type: 'text', data: { text: 'quoted reply' } },
    ]);
    expect(await toMessageCreateOptions(body)).toEqual({
      content: 'quoted reply',
      reply: { messageReference: '123456789', failIfNotExists: true },
    });
  });

  it('formats keyboard outbound as components', () => {
    const body = formatOutboundBody([
      { type: 'text', data: { text: 'pick' } },
      {
        type: 'keyboard',
        data: {
          rows: [[{ label: 'Yes', payload: 'yes' }, { label: 'No', payload: 'no' }]],
        },
      },
    ]);
    expect(body.content).toBe('pick');
    expect(body.components).toHaveLength(1);
    expect(body.components?.[0].components).toEqual([
      { type: 2, custom_id: 'yes', label: 'Yes', style: 2, disabled: false },
      { type: 2, custom_id: 'no', label: 'No', style: 2, disabled: false },
    ]);
  });
});

describe('discord plugin runtime adapter', () => {
  it('resolves scoped message content and attachment media through Discord REST', async () => {
    const endpoint = await discordFixture(() => new DiscordGatewayEndpoint({id: capabilityId(rootPluginId(), adapterFeature, 'discord'),
config: baseConfig,
fetch: vi.fn(async () => new Response(JSON.stringify({
        id: 'm1',
        content: 'quoted',
        timestamp: '2026-01-01T00:00:00.000Z',
        author: { id: 'u1', global_name: 'Alice' },
        attachments: [{ url: 'https://cdn.discord.test/a.png', filename: 'a.png', content_type: 'image/png', size: 3 }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }))}), () => createMockClient(), { receive: vi.fn(), send: vi.fn() } as never, undefined);
    const conversation = { endpoint: { id: 'main', adapter: 'discord' }, kind: 'channel' as const, id: 'c1' };
    await endpoint.start();
    await expect(endpoint.index.resolveContent(endpoint.canonicalId, { kind: 'message', message: { conversation, id: 'm1' } }, {
      signal: new AbortController().signal,
      maxDepth: 2,
      maxEntries: 50,
      maxChars: 12_000,
    })).resolves.toMatchObject({
      status: 'resolved',
      value: {
        actor: { id: 'u1', displayName: 'Alice' },
        segments: [
          { type: 'text', data: { text: 'quoted' } },
          { type: 'image', data: { media: { kind: 'url', value: 'https://cdn.discord.test/a.png', mime_type: 'image/png', file_name: 'a.png', size: 3 } } },
        ],
      },
    });
    await endpoint.stop();
  });

  it('routes admitted messages through OutboundMessageService when open', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: OutboundMessageService = { receive, send: vi.fn(async () => 'sent') };
    const mock = createMockClient();
    const createClient = () => mock;
    const endpoint = await discordFixture(() => new DiscordGatewayEndpoint({id: capabilityId(rootPluginId(), adapterFeature, 'discord'),
config: baseConfig}), createClient, gateway, undefined);

    await endpoint.start();
    endpoint.open();
    expect(endpoint.transportState).toBe('open');
    endpoint.endpoint.ws.status = Status.Connecting;
    expect(endpoint.transportState).toBe('reconnecting');
    endpoint.endpoint.ws.status = Status.Ready;
    expect(endpoint.transportState).toBe('open');
    endpoint.endpoint.admit(textMessage());

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      conversation: expect.objectContaining({ kind: 'channel', id: 'chan-1' }),
      message: expect.objectContaining({ id: 'msg-1' }),
      content: 'hello',
      sender: expect.objectContaining({ id: 'user-1', name: 'alice' }),
    }));

    await endpoint.stop();
    expect(endpoint.transportState).toBe('stopped');
    expect(mock.login).toHaveBeenCalledWith('test-token');
    expect(mock.destroy).toHaveBeenCalled();
  });

  it('marks mentioned when inbound mentions include the bot user', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: OutboundMessageService = { receive, send: vi.fn(async () => 'sent') };
    const mock = createMockClient();
    const endpoint = await discordFixture(() => new DiscordGatewayEndpoint({id: capabilityId(rootPluginId(), adapterFeature, 'discord'),
config: baseConfig}), () => mock, gateway, undefined);

    await endpoint.start();
    endpoint.open();
    endpoint.endpoint.emit('messageCreate', {
      id: 'msg-at',
      content: '<@bot-1> hi',
      author: { id: 'user-1', username: 'alice', displayName: 'alice', bot: false },
      channel: { id: 'chan-1', type: 0 },
      member: null,
      guild: null,
      createdTimestamp: 1_700_000_000_000,
      attachments: new Map(),
      embeds: [],
      stickers: new Map(),
      mentions: { users: { has: (id: string) => id === 'bot-1' } },
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      conversation: expect.objectContaining({ kind: 'channel', id: 'chan-1' }),
      mentioned: true,
    }));

    await endpoint.stop();
  });

  it('does not mark mentioned when mentions target someone else', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const mock = createMockClient();
    const endpoint = await discordFixture(() => new DiscordGatewayEndpoint({id: capabilityId(rootPluginId(), adapterFeature, 'discord'),
config: baseConfig}), () => mock, { receive, send: vi.fn(async () => 'sent') }, undefined);

    await endpoint.start();
    endpoint.open();
    endpoint.endpoint.emit('messageCreate', {
      id: 'msg-at-other',
      content: '<@user-2> hi',
      author: { id: 'user-1', username: 'alice', displayName: 'alice', bot: false },
      channel: { id: 'chan-1', type: 0 },
      member: null,
      guild: null,
      createdTimestamp: 1_700_000_000_000,
      attachments: new Map(),
      embeds: [],
      stickers: new Map(),
      mentions: { users: { has: (id: string) => id === 'user-2' } },
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    const metadata = receive.mock.calls[0]?.[0]?.metadata as Record<string, unknown> | undefined;
    expect(receive.mock.calls[receive.mock.calls.length - 1]?.[0]?.mentioned).toBeFalsy();

    await endpoint.stop();
  });

  it('does not admit inbound while closed', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const mock = createMockClient();
    const endpoint = await discordFixture(() => new DiscordGatewayEndpoint({id: capabilityId(rootPluginId(), adapterFeature, 'discord'),
config: baseConfig}), () => mock, { receive, send: vi.fn(async () => 'sent') }, undefined);
    await endpoint.start();
    endpoint.endpoint.admit(textMessage());
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('sends outbound payloads via channel.send', async () => {
    const mock = createMockClient();
    const endpoint = await discordFixture(() => new DiscordGatewayEndpoint({id: capabilityId(rootPluginId(), adapterFeature, 'discord'),
config: baseConfig}), () => mock, { receive: vi.fn(), send: vi.fn(async () => 'sent') }, undefined);
    await endpoint.start();
    const messageId = await endpoint.send({
      conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'channel',
        id: 'chan-1',
      },
      payload: 'pong',
    });
    expect(messageId).toBe('sent-1');
    expect(mock.sent[0]).toMatchObject({
      channelId: 'chan-1',
    });
    await endpoint.stop();
  });

  it('derives the legacy message id from the structured conversation', async () => {
    const mock = createMockClient();
    const endpoint = await discordFixture(() => new DiscordGatewayEndpoint({id: capabilityId(rootPluginId(), adapterFeature, 'discord'),
config: baseConfig}), () => mock, { receive: vi.fn(), send: vi.fn(async () => 'sent') }, undefined);
    await endpoint.start();
    await expect(endpoint.send({
      conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'group',
        id: 'chan-1',
      },
      payload: 'pong',
    })).resolves.toBe('sent-1');
    expect(mock.sent[0]).toMatchObject({ channelId: 'chan-1' });
    await endpoint.stop();
  });

  it('projects the real gateway client into agent operations', async () => {
    const mock = createMockClient();
    const endpoint = await discordFixture(() => new DiscordGatewayEndpoint({id: capabilityId(rootPluginId(), adapterFeature, 'discord'),
config: baseConfig}), () => mock, { receive: vi.fn(), send: vi.fn(async () => 'sent') }, undefined);
    await endpoint.start();
    const client = endpoint.index.clientById<DiscordGatewayEndpoint>(endpoint.canonicalId);
    if (!('guilds' in client)) throw new Error('Expected Discord Gateway Client');
    expect(client).toBe(endpoint.endpoint);
    const guild = await client.guilds.fetch('guild-1');
    await guild.roles.fetch();
    expect([...(guild.roles.cache as Map<string, { name: string }>).values()])
      .toEqual([expect.objectContaining({ name: 'Admin' })]);
    await endpoint.stop();
  });

  it('creates interactions endpoint when httpHostToken provided', async () => {
    const { default: adapter } = await import('../adapters/discord/index.js');
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    const endpoint = await createAdapterHarness(adapter, { id: 'discord', token: 'tok', connection: 'interactions', applicationId: 'app', publicKey: 'a'.repeat(64) }, { name: 'discord', resources: new Map([[httpHostToken.id, http]]) });
    expect(endpoint.endpoint).toBeInstanceOf(DiscordInteractionsEndpoint);
    await endpoint.stop();
    expect(endpoint).toBeDefined();
  });

  it('interactions webhook rejects stale timestamps but accepts fresh signed pings', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicKeyHex = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const endpoint = await discordFixture(() => new DiscordInteractionsEndpoint({id: capabilityId(rootPluginId(), adapterFeature, 'discord'),
http,
config: resolveDiscordConfig({
        id: 'discord',
        token: 'tok',
        connection: 'interactions',
        applicationId: 'app',
        publicKey: publicKeyHex,
      }) as ReturnType<typeof resolveDiscordConfig> & { connection: 'interactions' }}), undefined, { receive, send: vi.fn(async () => 'sent') }, undefined);
    await endpoint.start();
    const { port } = await http.listen();

    let body = JSON.stringify({ type: 1, application_id: 'app' });
    const post = (timestamp: string) => fetch(`http://127.0.0.1:${port}/discord/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature-ed25519': cryptoSign(null, Buffer.from(timestamp + body), privateKey).toString('hex'),
        'x-signature-timestamp': timestamp,
      },
      body,
    });

    const fresh = String(Math.floor(Date.now() / 1000));
    const okRes = await post(fresh);
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual({ type: 1 });

    const stale = String(Math.floor(Date.now() / 1000) - 600);
    const staleRes = await post(stale);
    expect(staleRes.status).toBe(401);
    body = JSON.stringify({ type: 3, application_id: 'app', id: 'click', channel_id: 'channel', guild_id: 'guild', member: { user: { id: 'user', username: 'Tester' } }, message: { id: 'source' }, data: { component_type: 2, custom_id: 'canonical-callback' } });
    expect((await post(fresh)).status).toBe(503);
    endpoint.open();
    const clicked = await post(fresh);
    expect(await clicked.json()).toEqual({ type: 6 });
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ conversation: expect.objectContaining({ parent: { kind: 'channel', id: 'guild' } }), segments: [{ type: 'action', data: { id: 'click', payload: 'canonical-callback', sourceMessageId: 'source' } }] }));
    await endpoint.stop();
    await http.close();
  });

  it('warns instead of silent no-op when slash commands enabled without global scope and no guilds', async () => {
    const { getLogger } = await import('@zhin.js/logger');
    const warnSpy = vi.spyOn(getLogger('discord'), 'warn');
    try {
      const mock = createMockClient(); // guilds.cache 为空
      const endpoint = await discordFixture(() => new DiscordGatewayEndpoint({id: capabilityId(rootPluginId(), adapterFeature, 'discord'),
config: resolveDiscordConfig({
          id: 'slash-bot',
          token: 'tok',
          connection: 'gateway',
          enableSlashCommands: true,
          globalCommands: false,
          slashCommands: [{ name: 'ping', description: 'pong' }],
        }) as ReturnType<typeof resolveDiscordConfig> & { connection: 'gateway' }}), () => mock, { receive: vi.fn(), send: vi.fn(async () => 'sent') }, undefined);
      await endpoint.start();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('slash'));
      await endpoint.stop();
    } finally {
      warnSpy.mockRestore();
    }
  });
});


describe('discord endpoint management', () => {
  const GUILD_ID = '1234567890123456789';

  function managementMock() {
    const mock = createMockClient();
    const textChannel = { id: 'chan-text', name: 'general', type: 0 };
    const voiceChannel = { id: 'chan-voice', name: 'Voice', type: 2 };
    const guild = {
      id: GUILD_ID,
      name: 'Guild',
      channels: {
        cache: { values: () => [textChannel, voiceChannel][Symbol.iterator]() },
      },
    };
    mock.guilds.cache = { values: () => [guild][Symbol.iterator]() };
    return mock;
  }

  async function createManagementEndpoint(mock: DiscordClientTransport) {
    return await discordFixture(() => new DiscordGatewayEndpoint({id: capabilityId(rootPluginId(), adapterFeature, 'discord'),
config: baseConfig}), () => mock, { receive: vi.fn(), send: vi.fn(async () => 'sent') }, undefined);
  }

  it('advertises only implemented management capabilities', async () => {
    const endpoint = await createManagementEndpoint(managementMock());
    await endpoint.start();
    expect(endpoint.index.describe()[0]?.managementCapabilities).toEqual([
      'listGroups',
      'listChannels',
      'listGroupMembers',
    ]);
    await endpoint.stop();
  });

  it('lists guilds without losing snowflake precision', async () => {
    const endpoint = await createManagementEndpoint(managementMock());
    await endpoint.start();
    // snowflake 超 Number.MAX_SAFE_INTEGER，保留原始字符串
    await expect(endpoint.management.listGroups?.()).resolves.toEqual([
      { group_id: GUILD_ID, name: 'Guild' },
    ]);
    await endpoint.stop();
  });

  it('lists only guild text channels with guild parent', async () => {
    const endpoint = await createManagementEndpoint(managementMock());
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

  it('lists guild members through the SDK', async () => {
    const endpoint = await createManagementEndpoint(managementMock());
    await endpoint.start();
    await expect(endpoint.management.listGroupMembers?.({ groupId: 'guild-1' })).resolves.toEqual([
      {
        id: 'user-1',
        username: 'alice',
        nickname: null,
        roles: ['role-1'],
        joined_at: new Date(0).toISOString(),
      },
    ]);
    await endpoint.stop();
  });

  it('rejects management calls before the client connects', async () => {
    const endpoint = await createManagementEndpoint(managementMock());
    await expect(endpoint.management.listGroups?.()).rejects.toMatchObject({ code: 'endpoint_inactive', disposition: 'not_sent' });
  });
});

it('maps canonical share to a Discord embed alongside markdown', () => {
  expect(formatOutboundBody([{ type: 'markdown', data: { content: '**bold**' } }, { type: 'share', data: { title: 'Link', url: 'https://example.com', description: 'Details', image: 'https://example.com/image.png' } }])).toEqual({ content: '**bold**', embeds: [{ title: 'Link', url: 'https://example.com', description: 'Details', image: { url: 'https://example.com/image.png' } }] });
});


it('shared lifecycle stops pending native login and its late completion cannot damage the replacement incarnation', async () => {
  const first = createMockClient(), second = createMockClient();
  let finishLogin!: (value: string) => void;
  first.login = vi.fn(() => new Promise<string>(resolve => { finishLogin = resolve; }));
  const factory = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
  const { fixture, account } = await managedDiscordFixture(baseConfig, factory);
  try {
    await fixture.adapter.start(account.instanceId, fixture.adapter.revision, { waitForExecution: false });
    await vi.waitFor(() => expect(first.login).toHaveBeenCalledOnce());
    const previous = fixture.endpoint;
    expect(fixture.index.describe()[0]?.transportState).toBe('connecting');
    await fixture.adapter.start(account.instanceId, fixture.adapter.revision, { waitForExecution: false });
    expect(factory).toHaveBeenCalledTimes(1);
    await fixture.adapter.stop(account.instanceId, fixture.adapter.revision);
    expect(first.destroy).toHaveBeenCalledTimes(1);
    await fixture.adapter.start(account.instanceId, fixture.adapter.revision);
    expect(fixture.endpoint).not.toBe(previous);
    finishLogin('old'); await vi.waitFor(() => expect(first.destroy).toHaveBeenCalledTimes(2));
    expect(second.destroy).not.toHaveBeenCalled();
    expect(fixture.index.describe()[0]?.transportState).toBe('open');
  } finally { await fixture.stop(); }
  expect(second.destroy).toHaveBeenCalledTimes(1);
});

it('an explicit start after failed native startup creates a fresh Client', async () => {
  const first = createMockClient(); first.login = vi.fn(async () => { throw new Error('fixture refusal'); });
  const second = createMockClient(), factory = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
  const { fixture, account } = await managedDiscordFixture(baseConfig, factory);
  try {
    expect(await fixture.adapter.start(account.instanceId, fixture.adapter.revision)).toMatchObject({ execution: { status: 'failed' } });
    expect(first.destroy).toHaveBeenCalledTimes(1);
    const previous = fixture.endpoint;
    expect(await fixture.adapter.start(account.instanceId, fixture.adapter.revision)).toMatchObject({ execution: { status: 'applied' } });
    expect(fixture.endpoint).not.toBe(previous);
    expect(fixture.index.describe()[0]?.transportState).toBe('open');
  } finally { await fixture.stop(); }
});

it('the owning Adapter waits for old SDK destruction before concurrent start and retains replacement cleanup', async () => {
  const first = createMockClient(), second = createMockClient(); let finishDestroy!: () => void;
  first.destroy = vi.fn(() => new Promise<void>(resolve => { finishDestroy = resolve; }));
  const factory = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
  const { fixture, account } = await managedDiscordFixture(baseConfig, factory);
  try {
    await fixture.adapter.start(account.instanceId, fixture.adapter.revision);
    const previous = fixture.endpoint;
    const stopping = fixture.adapter.stop(account.instanceId, fixture.adapter.revision);
    await vi.waitFor(() => expect(first.destroy).toHaveBeenCalled());
    const restarting = fixture.adapter.start(account.instanceId, fixture.adapter.revision);
    await Promise.resolve(); await Promise.resolve();
    expect(factory).toHaveBeenCalledTimes(1);
    finishDestroy(); await stopping; await restarting;
    expect(fixture.endpoint).not.toBe(previous);
    expect(factory).toHaveBeenCalledTimes(2);
  } finally { await fixture.stop(); }
  expect(second.destroy).toHaveBeenCalledTimes(1);
});
