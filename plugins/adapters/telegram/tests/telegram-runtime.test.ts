import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createEndpointRuntimeState } from 'zhin.js/adapter';
import { telegramRuntimeStateToken } from '../src/telegram-runtime-state.js';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createHttpHost, httpHostToken } from '@zhin.js/host-http';
import { messageGatewayToken, type MessageGateway } from '@zhin.js/core/runtime';
import { TelegramEndpoint, type TelegramFetch } from '../src/endpoint.js';
import { runTelegramPollLoop, type TelegramPollingHost } from '../src/polling.js';
import { safeTokenEqual } from '../src/webhook.js';
import {
  buildWebhookUrl,
  formatCallbackContent,
  formatCallbackSegments,
  formatInboundContent,
  formatInboundSegments,
  formatOutboundActions,
  formatOutboundPlan,
  resolveTelegramConfig,
  type TelegramMessage,
} from '../src/protocol.js';
import { getTelegramAgentDeps, setTelegramAgentDeps } from '../src/telegram-agent-deps.js';
import defineTelegramAdapter from '../adapters/telegram.js';

const adapterFeature = featureId('zhin.adapter');

const baseConfig = resolveTelegramConfig({
  id: 'test-telegram-bot',
  token: '123456:TEST-TOKEN',
  apiBaseUrl: 'https://api.telegram.test',
});

const webhookConfig = resolveTelegramConfig({
  id: 'test-telegram-bot',
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

function testConversation(kind: 'private' | 'group' | 'channel', id: string) {
  return {
    endpoint: { id: 'test-endpoint', adapter: 'test' },
    kind,
    id,
  };
}

function mockApiFetch(handlers: Record<string, unknown> = {}): TelegramFetch & {
  calls: Array<{ method: string; body: Record<string, unknown> }>;
  forms: Array<{ method: string; form: FormData }>;
} {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  const forms: Array<{ method: string; form: FormData }> = [];
  const fetchFn: TelegramFetch = async (url, init) => {
    const method = url.split('/').pop() || '';
    if (init?.body instanceof FormData) {
      forms.push({ method, form: init.body });
    } else {
      const body = init?.body ? JSON.parse(init.body) as Record<string, unknown> : {};
      calls.push({ method, body });
    }
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
  return Object.assign(fetchFn, { calls, forms });
}

afterEach(async () => {
  setTelegramAgentDeps(null);
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

describe('telegram protocol helpers', () => {
  it('resolves plugin config with polling default', () => {
    const resolved = resolveTelegramConfig({ token: 'tok' });
    expect(resolved.mode).toBe('polling');
    expect(resolved.id).toBe('telegram-bot');
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

  it('maps inbound attachments to canonical segments with file_id MediaRef (kind=file)', () => {
    expect(formatInboundSegments(textMessage())).toEqual([
      { type: 'text', data: { text: 'hello' } },
    ]);
    expect(formatInboundSegments(textMessage({
      text: undefined,
      photo: [{ file_id: 'p-small' }, { file_id: 'p-large', width: 800, height: 600 }],
    }))).toEqual([
      { type: 'image', data: { media: { kind: 'file', value: 'p-large' } } },
    ]);
    expect(formatInboundSegments(textMessage({
      text: undefined,
      caption: 'look',
      video: { file_id: 'v1' },
    }))).toEqual([
      { type: 'text', data: { text: 'look' } },
      { type: 'video', data: { media: { kind: 'file', value: 'v1' } } },
    ]);
    expect(formatInboundSegments(textMessage({
      text: undefined,
      audio: { file_id: 'a1', title: 'song' },
    }))).toEqual([
      { type: 'audio', data: { media: { kind: 'file', value: 'a1' }, name: 'song' } },
    ]);
    expect(formatInboundSegments(textMessage({
      text: undefined,
      voice: { file_id: 'vo1' },
    }))).toEqual([
      { type: 'voice', data: { media: { kind: 'file', value: 'vo1' } } },
    ]);
    expect(formatInboundSegments(textMessage({
      text: undefined,
      document: { file_id: 'd1', file_name: 'a.pdf', mime_type: 'application/pdf' },
    }))).toEqual([
      {
        type: 'file',
        data: {
          media: { kind: 'file', value: 'd1', mime_type: 'application/pdf' },
          name: 'a.pdf',
        },
      },
    ]);
    expect(formatInboundSegments(textMessage({
      text: undefined,
      sticker: { file_id: 's1', emoji: '😀' },
    }))).toEqual([
      { type: 'image', data: { media: { kind: 'file', value: 's1' }, alt: '😀' } },
    ]);
  });

  it('maps reply_to_message and callback_query payload to reply/action segments', () => {
    expect(formatInboundSegments(textMessage({
      reply_to_message: textMessage({ message_id: 41 }),
    }))).toEqual([
      { type: 'reply', data: { message_id: '41' } },
      { type: 'text', data: { text: 'hello' } },
    ]);
    expect(formatCallbackSegments({
      id: 'cq1',
      from: { id: 1, first_name: 'A' },
      data: 'btn:1',
      message: textMessage({ message_id: 40 }),
    })).toEqual([
      { type: 'action', data: { id: 'cq1', payload: 'btn:1', sourceMessageId: '40' } },
    ]);
    expect(formatCallbackSegments({
      id: 'cq2',
      from: { id: 1, first_name: 'A' },
    })).toEqual([
      { type: 'action', data: { id: 'cq2', payload: '' } },
    ]);
  });

  it('formats outbound string and segment payloads', () => {
    expect(formatOutboundActions('1001', 'pong')).toEqual([{
      method: 'sendMessage',
      params: { chat_id: 1001, text: 'pong' },
    }]);
    expect(formatOutboundActions('1001', [
      { type: 'text', data: { text: 'see' } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://example.com/a.png' } } },
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

  it('maps base64/path media to attach:// upload plan; url/file_id stay direct', () => {
    const plan = formatOutboundPlan('1001', [
      { type: 'text', data: { text: 'see' } },
      {
        type: 'image',
        data: { media: { kind: 'base64', value: 'base64://QUJD', mime_type: 'image/png' }, name: 'a.png' },
      },
    ]);
    expect(plan.actions).toEqual([{
      method: 'sendPhoto',
      params: { chat_id: 1001, photo: 'attach://attach0', caption: 'see' },
    }]);
    expect(plan.uploads).toEqual([{
      attachName: 'attach0',
      filename: 'a.png',
      source: { kind: 'base64', data: 'QUJD' },
      mimeType: 'image/png',
    }]);

    const pathPlan = formatOutboundPlan(1001, [
      { type: 'image', data: { media: { kind: 'path', value: '/tmp/b.png' } } },
    ]);
    expect(pathPlan.actions[0]).toMatchObject({ params: { photo: 'attach://attach0' } });
    expect(pathPlan.uploads[0]).toEqual({
      attachName: 'attach0',
      filename: 'b.png',
      source: { kind: 'path', path: '/tmp/b.png' },
    });

    // url / file_id 保持字符串直发，不产生上传
    const urlPlan = formatOutboundPlan(1, [
      { type: 'image', data: { media: { kind: 'url', value: 'https://x/a.png' } } },
    ]);
    expect(urlPlan.uploads).toEqual([]);
    expect(urlPlan.actions[0]).toMatchObject({ params: { photo: 'https://x/a.png' } });
    const filePlan = formatOutboundPlan(1, [
      { type: 'image', data: { media: { kind: 'file', value: 'fid-1' } } },
    ]);
    expect(filePlan.uploads).toEqual([]);
    expect(filePlan.actions[0]).toMatchObject({ params: { photo: 'fid-1' } });
  });

  it('drops media segments without canonical data.media with a warn', async () => {
    const { getLogger } = await import('@zhin.js/logger');
    const warn = vi.spyOn(getLogger('telegram'), 'warn');
    try {
      const plan = formatOutboundPlan('1001', [
        { type: 'text', data: { text: 'hi' } },
        { type: 'image', data: {} },
      ]);
      // 无 MediaRef 的媒体段被丢弃；文本仍经 sendMessage 投递
      expect(plan.actions).toEqual([{
        method: 'sendMessage',
        params: { chat_id: 1001, text: 'hi' },
      }]);
      expect(plan.uploads).toEqual([]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('telegram_outbound_media_dropped'),
      );
    } finally {
      warn.mockRestore();
    }
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
      conversation: expect.objectContaining({ kind: 'private', id: '1001' }),
      message: expect.objectContaining({ id: '42' }),
      content: 'hello',
      sender: expect.objectContaining({ id: '7', name: 'alice' }),
    }));

    await endpoint.stop();
    expect(fetch.calls.some((c) => c.method === 'getMe')).toBe(true);
    expect(fetch.calls.some((c) => c.method === 'deleteWebhook')).toBe(true);
  });

  it('marks mentioned when entities @ the bot username', async () => {
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
      conversation: expect.objectContaining({ kind: 'private', id: '1001' }),
      mentioned: true,
    }));

    await endpoint.stop();
  });

  it('does not mark mentioned when @ targets someone else', async () => {
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
    expect(receive.mock.calls[receive.mock.calls.length - 1]?.[0]?.mentioned).toBeFalsy();

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
    const messageId = await endpoint.send({ conversation: testConversation('private', '1001'), payload: 'pong' });
    expect(messageId).toBe('77');
    expect(fetch.calls.some((c) => (
      c.method === 'sendMessage'
      && c.body.chat_id === 1001
      && c.body.text === 'pong'
    ))).toBe(true);
    await endpoint.stop();
  });

  it('uses the native chat id from the structured conversation', async () => {
    const fetch = mockApiFetch({ sendMessage: { message_id: 78 } });
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
    await expect(endpoint.send({ conversation: testConversation('group', '-1001'), payload: 'pong' }))
      .resolves.toBe('78');
    expect(fetch.calls.some((call) => (
      call.method === 'sendMessage' && call.body.chat_id === -1001
    ))).toBe(true);
    await endpoint.stop();
  });

  it('uploads base64 image via multipart sendPhoto', async () => {
    const fetch = mockApiFetch({ sendPhoto: { message_id: 88 } });
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
    const messageId = await endpoint.send({
      conversation: testConversation('private', '1001'),
      payload: [
        { type: 'text', data: { text: 'look' } },
        {
          type: 'image',
          data: {
            media: {
              kind: 'base64',
              value: Buffer.from('png-bytes').toString('base64'),
              mime_type: 'image/png',
            },
            name: 'a.png',
          },
        },
      ],
    });
    expect(messageId).toBe('88');
    const formCall = fetch.forms.find((f) => f.method === 'sendPhoto');
    expect(formCall).toBeDefined();
    expect(formCall!.form.get('chat_id')).toBe('1001');
    expect(formCall!.form.get('caption')).toBe('look');
    const file = formCall!.form.get('photo') as File;
    expect(file.name).toBe('a.png');
    expect(file.type).toBe('image/png');
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('png-bytes');
    await endpoint.stop();
  });

  it('uploads local-path image via multipart sendPhoto (reads from disk)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zhin-telegram-upload-'));
    try {
      const filePath = path.join(dir, 'local.png');
      await writeFile(filePath, 'disk-bytes');
      const fetch = mockApiFetch({ sendPhoto: { message_id: 89 } });
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
      const messageId = await endpoint.send({
        conversation: testConversation('private', '1001'),
        payload: [{ type: 'image', data: { media: { kind: 'path', value: filePath } } }],
      });
      expect(messageId).toBe('89');
      const formCall = fetch.forms.find((f) => f.method === 'sendPhoto');
      expect(formCall).toBeDefined();
      const file = formCall!.form.get('photo') as File;
      expect(file.name).toBe('local.png');
      expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('disk-bytes');
      await endpoint.stop();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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
      conversation: expect.objectContaining({ kind: 'private', id: '1001' }),
      content: 'webhook hello',
      sender: expect.objectContaining({ id: '7', name: 'alice' }),
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
        if (token === telegramRuntimeStateToken) return createEndpointRuntimeState();
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
    const { getAdapterLogger } = await import('@zhin.js/logger');
    const warn = vi.spyOn(getAdapterLogger('telegram', 'no-secret-bot'), 'warn');
    const endpoint = new TelegramEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'telegram'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      http,
      config: resolveTelegramConfig({
        id: 'no-secret-bot',
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
