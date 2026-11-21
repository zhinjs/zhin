import { telegramFixture } from './fixture.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpHost, type HttpHost } from '@zhin.js/host-http/node';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import type { TelegramFetch } from '../src/endpoint.js';
import { resolveTelegramConfig, type TelegramMessage } from '../src/protocol.js';

const adapterFeature = featureId('zhin.adapter');
const hosts: HttpHost[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

function apiFetch(): TelegramFetch {
  return async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: true, result: { id: 1, username: 'fixture_bot', first_name: 'Fixture' } }),
    json: async () => ({ ok: true, result: true }),
  });
}

function textMessage(): TelegramMessage {
  return {
    message_id: 42,
    date: 1_700_000_000,
    chat: { id: 1001, type: 'private' },
    from: { id: 7, first_name: 'Alice', username: 'alice' },
    text: 'webhook hello',
  };
}

function webhookConfig(id: string, path: string, secretToken: string) {
  return resolveTelegramConfig({
    id,
    token: '123456:SYNTHETIC',
    apiBaseUrl: 'https://api.telegram.test',
    polling: false,
    webhook: { domain: 'https://fixture.invalid', path, secretToken },
  });
}

async function startWebhook(
  http: HttpHost,
  id: string,
  path: string,
  secretToken: string,
  receive: (payload: unknown) => unknown,
) {
  const endpoint = await telegramFixture({
    id: capabilityId(rootPluginId(), adapterFeature, id),
    http,
    config: webhookConfig(id, path, secretToken),
    fetch: apiFetch(),
  }, { receive, send: vi.fn(async () => 'sent') });
  await endpoint.start();
  endpoint.open();
  return endpoint;
}

describe('telegram webhook host routing and replay', () => {
  it('accepts each secret only on its own path', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const left = vi.fn(async () => undefined);
    const right = vi.fn(async () => undefined);
    const alpha = await startWebhook(http, 'hook-a', '/telegram/a', 'secret-a', left);
    const beta = await startWebhook(http, 'hook-b', '/telegram/b', 'secret-b', right);
    const { port } = await http.listen();
    const post = (path: string, secret: string | undefined, updateId: number) => fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}),
      },
      body: JSON.stringify({ update_id: updateId, message: textMessage() }),
    });

    expect((await post('/telegram/a', 'secret-b', 1)).status).toBe(403);
    expect((await post('/telegram/a', undefined, 2)).status).toBe(403);
    expect((await post('/telegram/missing', 'secret-a', 3)).status).toBe(404);
    expect(left).not.toHaveBeenCalled();
    expect(right).not.toHaveBeenCalled();

    expect((await post('/telegram/a', 'secret-a', 7)).status).toBe(200);
    await vi.waitFor(() => expect(left).toHaveBeenCalledTimes(1));
    expect(left).toHaveBeenCalledWith(expect.objectContaining({ content: 'webhook hello' }));
    expect(right).not.toHaveBeenCalled();

    expect((await post('/telegram/b', 'secret-b', 7)).status).toBe(200);
    await vi.waitFor(() => expect(right).toHaveBeenCalledTimes(1));
    expect(left).toHaveBeenCalledTimes(1);
    await alpha.stop();
    await beta.stop();
  });

  it('acks a repeated update once per generation and admits it again after restart', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => undefined);
    const create = () => startWebhook(http, 'hook-replay', '/telegram/replay', 'secret-replay', receive);
    let endpoint = await create();
    const { port } = await http.listen();
    const post = () => fetch(`http://127.0.0.1:${port}/telegram/replay`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': 'secret-replay',
      },
      body: JSON.stringify({ update_id: 42, message: textMessage() }),
    });

    expect((await post()).status).toBe(200);
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
    expect((await post()).status).toBe(200);
    await new Promise((done) => setImmediate(done));
    expect(receive).toHaveBeenCalledTimes(1);

    await endpoint.stop();
    expect((await post()).status).toBe(404);
    expect(receive).toHaveBeenCalledTimes(1);

    endpoint = await create();
    expect((await post()).status).toBe(200);
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(2));
    await endpoint.stop();
  });
});
