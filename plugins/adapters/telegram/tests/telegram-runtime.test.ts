import { describe, expect, it, vi, afterEach } from 'vitest';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import { createHttpHost, httpHostToken } from '@zhin.js/host-http';
import { messageGatewayToken, type MessageGateway } from '@zhin.js/core/runtime';
import { TelegramEndpoint, type TelegramFetch } from '../src/endpoint.js';
import { runTelegramPollLoop, type TelegramPollingHost } from '../src/polling.js';
import { safeTokenEqual } from '../src/webhook.js';
import {
  buildWebhookUrl,
  formatCallbackContent,
  formatInboundContent,
  formatOutboundActions,
  resolveTelegramConfig,
  type TelegramMessage,
} from '../src/protocol.js';
import { getTelegramAgentDeps, setTelegramAgentDeps } from '../src/telegram-agent-deps.js';
import defineTelegramAdapter from '../adapters/telegram.js';

const adapterFeature = featureId('zhin.adapter');

const baseConfig = resolveTelegramConfig({
  name: 'test-telegram-bot',
  token: '123456:TEST-TOKEN',
  apiBaseUrl: 'https://api.telegram.test',
});

const webhookConfig = resolveTelegramConfig({
  name: 'test-telegram-bot',
  token: '123456:TEST-TOKEN',
  apiBaseUrl: 'https://api.telegram.test',
  polling: false,
  webhook: {
    domain: 'https://bot.example.com',
    path: '/telegram/webhook',
    secretToken: 'hook-secret',
  },
});

const hosts: ReturnType<typeof createHttpHost>[] = [];

function textMessage(overrides: Partial<TelegramMessage> = {}): TelegramMessage {
  return {
    message_id: 42,
    date: 1_700_000_000,
    chat: { id: 1001, type: 'private' },
    from: { id: 7, first_name: 'Alice', username: 'alice' },
    text: 'hello',
    ...overrides,
  };
}

function mockApiFetch(handlers: Record<string, unknown> = {}): TelegramFetch & {
  calls: Array<{ method: string; body: Record<string, unknown> }>;
} {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  const fetchFn: TelegramFetch = async (url, init) => {
    const method = url.split('/').pop() || '';
    const body = init?.body ? JSON.parse(init.body) as Record<string, unknown> : {};
    calls.push({ method, body });
    if (method === 'getUpdates') {
      // Hang until abort so start() does not spin.
      await new Promise<void>((resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          return;
        }
        signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }, { once: true });
      });
    }
    const result = handlers[method] ?? (method === 'getMe'
      ? { username: 'test_bot', first_name: 'Test' }
      : method === 'deleteWebhook'
        ? true
        : method === 'sendMessage'
          ? { message_id: 99 }
          : true);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, result }),
      json: async () => ({ ok: true, result }),
    };
  };
  return Object.assign(fetchFn, { calls });
}

afterEach(async () => {
  setTelegramAgentDeps(null);
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

describe('telegram protocol helpers', () => {
  it('resolves plugin config with polling default', () => {
    const resolved = resolveTelegramConfig({ token: 'tok' });
    expect(resolved.mode).toBe('polling');
    expect(resolved.name).toBe('telegram-bot');
    expect(resolved.apiBaseUrl).toBe('https://api.telegram.org');
  });

  it('builds webhook URL from domain and path', () => {
    expect(buildWebhookUrl({
      domain: 'https://bot.example.com',
      path: '/telegram/webhook',
    })).toBe('https://bot.example.com/telegram/webhook');
  });

  it('selects webhook mode only when polling is false', () => {
    const resolved = resolveTelegramConfig({
      token: 'tok',
      polling: false,
      webhook: { domain: 'https://bot.example.com' },
    });
    expect(resolved.mode).toBe('webhook');
    expect(resolved.webhook?.path).toBe('/telegram/webhook');
  });

  it('formats inbound content by message kind', () => {
    expect(formatInboundContent(textMessage())).toBe('hello');
    expect(formatInboundContent(textMessage({
      text: undefined,
      photo: [{ file_id: 'p1' }],
    }))).toBe('[image]');
    expect(formatInboundContent(textMessage({
      text: undefined,
      document: { file_id: 'd1', file_name: 'a.pdf' },
    }))).toBe('[file: a.pdf]');
    expect(formatCallbackContent({
      id: 'cq1',
      from: { id: 1, first_name: 'A' },
      data: 'btn:1',
    })).toBe('[action: btn:1]');
  });

  it('formats outbound string and segment payloads', () => {
    expect(formatOutboundActions('1001', 'pong')).toEqual([{
      method: 'sendMessage',
      params: { chat_id: 1001, text: 'pong' },
    }]);
    expect(formatOutboundActions('1001', [
      { type: 'text', data: { text: 'see' } },
      { type: 'image', data: { url: 'https://example.com/a.png' } },
    ])).toEqual([{
      method: 'sendPhoto',
      params: {
        chat_id: 1001,
        photo: 'https://example.com/a.png',
        caption: 'see',
      },
    }]);
  });

  it('formats keyboard outbound as sendMessage reply_markup', () => {
    const actions = formatOutboundActions(1, [
      { type: 'text', data: { text: 'pick' } },
      {
        type: 'keyboard',
        data: {
          rows: [[{ label: 'Yes', payload: 'yes' }, { label: 'No', payload: 'no' }]],
        },
      },
    ]);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      method: 'sendMessage',
      params: {
        text: 'pick',
        reply_markup: {
          inline_keyboard: [[
            { text: 'Yes', callback_data: 'yes' },
            { text: 'No', callback_data: 'no' },
          ]],
        },
      },
    });
  });
});

describe('telegram plugin runtime adapter', () => {
  it('routes admitted messages through MessageGateway when open', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const fetch = mockApiFetch();
    const endpoint = new TelegramEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'telegram'),
      gateway,
      config: baseConfig,
      fetch,
    });

    await endpoint.start();
    endpoint.open();
    endpoint.admit(textMessage());

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: '1001',
      content: 'hello',
      sender: 'alice',
      id: '42',
    }));

    await endpoint.stop();
    expect(fetch.calls.some((c) => c.method === 'getMe')).toBe(true);
    expect(fetch.calls.some((c) => c.method === 'deleteWebhook')).toBe(true);
  });

  it('marks metadata.mentioned when entities @ the bot username', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const endpoint = new TelegramEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'telegram'),
      gateway,
      config: baseConfig,
      fetch: mockApiFetch(),
    });

    await endpoint.start();
    endpoint.open();
    endpoint.admit(textMessage({
      text: '@test_bot hello',
      entities: [{ type: 'mention', offset: 0, length: 9 }],
    }));

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: '1001',
      metadata: expect.objectContaining({ mentioned: true }),
    }));

    await endpoint.stop();
  });

  it('does not mark metadata.mentioned when @ targets someone else', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const endpoint = new TelegramEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'telegram'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      config: baseConfig,
      fetch: mockApiFetch(),
    });

    await endpoint.start();
    endpoint.open();
    endpoint.admit(textMessage({
      text: '@someone_else hello',
      entities: [{ type: 'mention', offset: 0, length: 13 }],
    }));

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    const metadata = receive.mock.calls[0]?.[0]?.metadata as Record<string, unknown> | undefined;
    expect(metadata?.mentioned).toBeUndefined();

    await endpoint.stop();
  });

  it('does not admit inbound while closed', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const endpoint = new TelegramEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'telegram'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      config: baseConfig,
      fetch: mockApiFetch(),
    });
    await endpoint.start();
    endpoint.admit(textMessage());
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('sends outbound payloads via Bot API', async () => {
    const fetch = mockApiFetch({ sendMessage: { message_id: 77 } });
    const endpoint = new TelegramEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'telegram'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      config: baseConfig,
      fetch,
    });
    await endpoint.start();
    endpoint.open();
    const messageId = await endpoint.send({ target: '1001', payload: 'pong' });
    expect(messageId).toBe('77');
    expect(fetch.calls.some((c) => (
      c.method === 'sendMessage'
      && c.body.chat_id === 1001
      && c.body.text === 'pong'
    ))).toBe(true);
    await endpoint.stop();
  });

  it('registers agent endpoint for tools', async () => {
    const fetch = mockApiFetch({
      getChatAdministrators: [{
        status: 'administrator',
        user: { id: 1, username: 'admin', first_name: 'Admin' },
      }],
    });
    const endpoint = new TelegramEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'telegram'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      config: baseConfig,
      fetch,
    });
    await endpoint.start();
    const admins = await getTelegramAgentDeps().getEndpoint('test-telegram-bot').getChatAdmins(9);
    expect(admins).toHaveLength(1);
    expect(admins[0]?.user.username).toBe('admin');
    await endpoint.stop();
  });

  it('POST webhook admits update via MessageGateway when open', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const apiFetch = mockApiFetch();
    const endpoint = new TelegramEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'telegram'),
      gateway,
      http,
      config: webhookConfig,
      fetch: apiFetch,
    });

    await endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    const res = await globalThis.fetch(`http://127.0.0.1:${port}/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'hook-secret',
      },
      body: JSON.stringify({
        update_id: 1,
        message: textMessage({ text: 'webhook hello' }),
      }),
    });

    expect(res.ok).toBe(true);
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: '1001',
      content: 'webhook hello',
      sender: 'alice',
    }));
    expect(apiFetch.calls.some((c) => c.method === 'setWebhook')).toBe(true);
    await endpoint.stop();
  });

  it('rejects webhook with invalid secret token', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const apiFetch = mockApiFetch();
    const endpoint = new TelegramEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'telegram'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      http,
      config: webhookConfig,
      fetch: apiFetch,
    });

    await endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    const res = await globalThis.fetch(`http://127.0.0.1:${port}/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ update_id: 1, message: textMessage() }),
    });

    expect(res.status).toBe(403);
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('creates webhook endpoint via adapter factory when polling is false', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    const gateway: MessageGateway = {
      receive: vi.fn(async () => Object.freeze({ matched: false })),
      send: vi.fn(async () => 'sent'),
    };
    const endpoint = defineTelegramAdapter.create({
      id: capabilityId(rootPluginId(), adapterFeature, 'telegram'),
      name: 'telegram',
      config: {
        token: 'tok',
        polling: false,
        webhook: { domain: 'https://x.com' },
      },
      use: (token: unknown) => {
        if (token === httpHostToken) return http;
        if (token === messageGatewayToken) return gateway;
        throw new Error(`unexpected token: ${String(token)}`);
      },
    } as never);
    expect(endpoint).toBeInstanceOf(TelegramEndpoint);
    await http.close().catch(() => undefined);
  });
});

describe('telegram webhook auth', () => {
  it('safeTokenEqual compares constant-time and tolerates length mismatch', () => {
    expect(safeTokenEqual('hook-secret', 'hook-secret')).toBe(true);
    expect(safeTokenEqual('hook-secret', 'hook-secrex')).toBe(false);
    expect(safeTokenEqual('hook-secret', 'hook-secret-longer')).toBe(false);
    expect(safeTokenEqual('hook-secret', '')).toBe(false);
  });

  it('warns once at startup when webhook has no secretToken', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const { getLogger } = await import('@zhin.js/logger');
    const warn = vi.spyOn(getLogger('telegram'), 'warn');
    const endpoint = new TelegramEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'telegram'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      http,
      config: resolveTelegramConfig({
        name: 'no-secret-bot',
        token: '123456:TEST-TOKEN',
        apiBaseUrl: 'https://api.telegram.test',
        polling: false,
        webhook: { domain: 'https://bot.example.com', path: '/telegram/webhook' },
      }),
      fetch: mockApiFetch(),
    });
    try {
      await endpoint.start();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('webhook_no_secret'),
      );
    } finally {
      warn.mockRestore();
      await endpoint.stop();
    }
  });
});

describe('telegram polling backoff', () => {
  it('keeps BACKOFF delay after max consecutive failures (no reset to RETRY)', async () => {
    vi.useFakeTimers();
    try {
      const delays: number[] = [];
      const fakeSetTimeout = globalThis.setTimeout;
      vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
        handler: Parameters<typeof setTimeout>[0],
        timeout?: number,
        ...args: unknown[]
      ) => {
        if (typeof timeout === 'number') delays.push(timeout);
        return fakeSetTimeout(handler, timeout as never, ...(args as never[]));
      }) as never);
      const host: TelegramPollingHost = {
        allowedUpdates: [],
        callApi: vi.fn(async () => {
          throw new Error('peer down');
        }),
        getUpdateOffset: () => 0,
        setUpdateOffset: () => undefined,
        handleUpdate: () => undefined,
      };
      const abort = new AbortController();
      const loop = runTelegramPollLoop(host, abort.signal);
      // 7 次连续失败：前 4 次 RETRY(2s)，第 5 次起持续 BACKOFF(10s)
      for (let i = 0; i < 7; i += 1) {
        await vi.advanceTimersByTimeAsync(20_000);
      }
      abort.abort();
      await vi.advanceTimersByTimeAsync(0);
      await loop;
      // vitest 推进 fake timer 时可能注入自己的 setTimeout，只采退避档位的值。
      const pollDelays = delays.filter((d) => d === 2_000 || d === 10_000);
      expect(pollDelays.slice(0, 4)).toEqual([2_000, 2_000, 2_000, 2_000]);
      expect(pollDelays.slice(4, 7)).toEqual([10_000, 10_000, 10_000]);
    } finally {
      vi.useRealTimers();
    }
  });
});
