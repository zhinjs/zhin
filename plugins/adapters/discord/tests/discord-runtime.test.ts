import { describe, expect, it, vi, afterEach } from 'vitest';
import { createEndpointRuntimeState, listEndpointManagementCapabilities } from '@zhin.js/adapter';
import { discordRuntimeStateToken } from '../src/discord-runtime-state.js';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { createHttpHost, httpHostToken } from '@zhin.js/host-http';
import { messageGatewayToken, type MessageGateway } from '@zhin.js/core/runtime';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import defineDiscordAdapter from '../adapters/discord.js';
import {
  DiscordGatewayEndpoint,
  DiscordInteractionsEndpoint,
  type CreateDiscordClient,
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
import { getDiscordAgentDeps, setDiscordAgentDeps } from '../src/discord-agent-deps.js';

const adapterFeature = featureId('zhin.adapter');

const baseConfig = resolveDiscordConfig({
  name: 'test-discord-bot',
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
  setDiscordAgentDeps(null);
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
    const resolved = resolveDiscordConfig({ token: 'tok' });
    expect(resolved.connection).toBe('gateway');
    expect(resolved.name).toBe('discord-bot');
  });

  it('selects interactions mode when configured', () => {
    const resolved = resolveDiscordConfig({
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
    }))).toBe('[image: a.png]');
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
    expect(formatOutboundBody('pong')).toEqual({ content: 'pong' });
    expect(formatOutboundBody([
      { type: 'text', data: { text: 'see' } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://example.com/a.png' }, name: 'a.png' } },
    ])).toEqual({
      content: 'see',
      files: [{ name: 'a.png', url: 'https://example.com/a.png' }],
    });
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
  it('routes admitted messages through MessageGateway when open', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const mock = createMockClient();
    const createClient: CreateDiscordClient = () => mock;
    const endpoint = new DiscordGatewayEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'discord'),
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
      sender: 'alice',
    }));

    await endpoint.stop();
    expect(mock.login).toHaveBeenCalledWith('test-token');
    expect(mock.destroy).toHaveBeenCalled();
  });

  it('marks metadata.mentioned when inbound mentions include the bot user', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const mock = createMockClient();
    const endpoint = new DiscordGatewayEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'discord'),
      gateway,
      config: baseConfig,
      createClient: () => mock,
    });

    await endpoint.start();
    endpoint.open();
    mock.emitMessage({
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
      metadata: expect.objectContaining({ mentioned: true }),
    }));

    await endpoint.stop();
  });

  it('does not mark metadata.mentioned when mentions target someone else', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const mock = createMockClient();
    const endpoint = new DiscordGatewayEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'discord'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createClient: () => mock,
    });

    await endpoint.start();
    endpoint.open();
    mock.emitMessage({
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
    expect(metadata?.mentioned).toBeUndefined();

    await endpoint.stop();
  });

  it('does not admit inbound while closed', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const mock = createMockClient();
    const endpoint = new DiscordGatewayEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'discord'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createClient: () => mock,
    });
    await endpoint.start();
    endpoint.admit(textMessage());
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('sends outbound payloads via channel.send', async () => {
    const mock = createMockClient();
    const endpoint = new DiscordGatewayEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'discord'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createClient: () => mock,
    });
    await endpoint.start();
    const messageId = await endpoint.send({
      conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'channel',
        id: 'chan-1',
      },
      payload: 'pong',
    });
    expect(messageId).toBe('channel:chan-1:sent-1');
    expect(mock.sent[0]).toMatchObject({
      channelId: 'chan-1',
    });
    await endpoint.stop();
  });

  it('derives the legacy message id from the structured conversation', async () => {
    const mock = createMockClient();
    const endpoint = new DiscordGatewayEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'discord'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createClient: () => mock,
    });
    await endpoint.start();
    await expect(endpoint.send({
      conversation: {
        endpoint: { id: 'test-endpoint', adapter: 'test' },
        kind: 'group',
        id: 'chan-1',
      },
      payload: 'pong',
    })).resolves.toBe('group:chan-1:sent-1');
    expect(mock.sent[0]).toMatchObject({ channelId: 'chan-1' });
    await endpoint.stop();
  });

  it('registers agent endpoint for tools', async () => {
    const mock = createMockClient();
    const endpoint = new DiscordGatewayEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'discord'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createClient: () => mock,
    });
    await endpoint.start();
    const roles = await getDiscordAgentDeps().getGatewayEndpoint('test-discord-bot').getRoles('guild-1');
    expect(roles).toHaveLength(1);
    expect((roles[0] as { name: string }).name).toBe('Admin');
    await endpoint.stop();
  });

  it('creates interactions endpoint when httpHostToken provided', async () => {
    const { default: adapter } = await import('../adapters/discord.js');
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    const endpoint = adapter.create({
      id: capabilityId(rootPluginId(), adapterFeature, 'discord'),
      name: 'discord',
      config: {
        token: 'tok',
        connection: 'interactions',
        applicationId: 'app',
        publicKey: 'a'.repeat(64),
      },
      use: (token: unknown) => {
        if (token === httpHostToken) return http;
        if (token === messageGatewayToken) {
          return { receive: vi.fn(), send: vi.fn(async () => 'sent') };
        }
        if (token === discordRuntimeStateToken) return createEndpointRuntimeState();
        throw new Error(`unexpected token: ${String(token)}`);
      },
    } as never);
    expect(endpoint).toBeDefined();
  });

  it('interactions webhook rejects stale timestamps but accepts fresh signed pings', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicKeyHex = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    const endpoint = new DiscordInteractionsEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'discord'),
      gateway: { receive: vi.fn(async () => Object.freeze({ matched: false })), send: vi.fn(async () => 'sent') },
      http,
      config: resolveDiscordConfig({
        token: 'tok',
        connection: 'interactions',
        applicationId: 'app',
        publicKey: publicKeyHex,
      }) as ReturnType<typeof resolveDiscordConfig> & { connection: 'interactions' },
    });
    await endpoint.start();
    const { port } = await http.listen();

    const body = JSON.stringify({ type: 1 });
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

    await endpoint.stop();
    await http.close();
  });

  it('warns instead of silent no-op when slash commands enabled without global scope and no guilds', async () => {
    const { getLogger } = await import('@zhin.js/logger');
    const warnSpy = vi.spyOn(getLogger('discord'), 'warn');
    try {
      const mock = createMockClient(); // guilds.cache 为空
      const endpoint = new DiscordGatewayEndpoint({
        id: capabilityId(rootPluginId(), adapterFeature, 'discord'),
        gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
        config: resolveDiscordConfig({
          name: 'slash-bot',
          token: 'tok',
          connection: 'gateway',
          enableSlashCommands: true,
          globalCommands: false,
          slashCommands: [{ name: 'ping', description: 'pong' }],
        }) as ReturnType<typeof resolveDiscordConfig> & { connection: 'gateway' },
        createClient: () => mock,
      });
      await endpoint.start();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('slash'));
      await endpoint.stop();
    } finally {
      warnSpy.mockRestore();
    }
  });
});


describe('discord.endpoint management', () => {
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

  function createManagementEndpoint(mock: DiscordClientTransport) {
    return new DiscordGatewayEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'discord'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createClient: () => mock,
    });
  }

  it('advertises only implemented management capabilities', async () => {
    const endpoint = createManagementEndpoint(managementMock());
    await endpoint.start();
    expect(listEndpointManagementCapabilities(endpoint)).toEqual([
      'listGroups',
      'listChannels',
      'listGroupMembers',
    ]);
    await endpoint.stop();
  });

  it('lists guilds without losing snowflake precision', async () => {
    const endpoint = createManagementEndpoint(managementMock());
    await endpoint.start();
    // snowflake 超 Number.MAX_SAFE_INTEGER，保留原始字符串
    await expect(endpoint.management.listGroups?.()).resolves.toEqual([
      { group_id: GUILD_ID, name: 'Guild' },
    ]);
    await endpoint.stop();
  });

  it('lists only guild text channels with guild parent', async () => {
    const endpoint = createManagementEndpoint(managementMock());
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
    const endpoint = createManagementEndpoint(managementMock());
    await endpoint.start();
    await expect(endpoint.management.listGroupMembers?.('guild-1')).resolves.toEqual([
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
    const endpoint = createManagementEndpoint(managementMock());
    await expect(endpoint.management.listGroups?.()).rejects.toThrow('not connected');
  });
});
