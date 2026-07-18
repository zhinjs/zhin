import { describe, expect, it, vi, afterEach } from 'vitest';
import { createHttpHost, httpHostToken } from '@zhin.js/host-http';
import { messageGatewayToken, type MessageGateway } from '@zhin.js/core/runtime';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import defineDiscordAdapter from '../adapters/discord.js';
import {
  DiscordGatewayEndpoint,
  type CreateDiscordClient,
  type DiscordClientTransport,
} from '../src/endpoint.js';
import {
  formatButtonContent,
  formatInboundContent,
  formatOutboundBody,
  resolveDiscordConfig,
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
    emitError(error: Error) {
      for (const listener of listeners.get('error') ?? []) listener(error);
    },
  };
}

afterEach(() => {
  setDiscordAgentDeps(null);
});

describe('discord protocol helpers', () => {
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

  it('formats outbound string and segment payloads', () => {
    expect(formatOutboundBody('pong')).toEqual({ content: 'pong' });
    expect(formatOutboundBody([
      { type: 'text', data: { text: 'see' } },
      { type: 'image', data: { url: 'https://example.com/a.png', name: 'a.png' } },
    ])).toEqual({
      content: 'see',
      files: [{ name: 'a.png', url: 'https://example.com/a.png' }],
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
      target: 'chan-1',
      content: 'hello',
      sender: 'alice',
      id: 'msg-1',
    }));

    await endpoint.stop();
    expect(mock.login).toHaveBeenCalledWith('test-token');
    expect(mock.destroy).toHaveBeenCalled();
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
    const messageId = await endpoint.send({ target: 'chan-1', payload: 'pong' });
    expect(messageId).toBe('sent-1');
    expect(mock.sent[0]).toMatchObject({
      channelId: 'chan-1',
    });
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
        throw new Error(`unexpected token: ${String(token)}`);
      },
    } as never);
    expect(endpoint).toBeDefined();
  });
});
