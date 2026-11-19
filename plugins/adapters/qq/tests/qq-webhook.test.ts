import { createHash } from 'node:crypto';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { type HttpHost } from '@zhin.js/host-http';
import { createHttpHost } from '@zhin.js/host-http/node';
import {
  registerQqWebhookRoutes,
  type QqHttpBotTransport,
  type QqWebhookHandler,
} from '../src/webhook.js';
import type { ResolvedQqHttpConfig } from '../src/protocol.js';

const hosts: HttpHost[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

/**
 * 复刻 qq-official-bot koa middleware 的关键行为：
 * `resolveBodyData(req, JSON.stringify(ctx.request.body))` ——
 * ctx.request.body 为 undefined 时库自己读流拿原始字节验签，
 * 否则用 JSON.stringify(parsed) 的重序列化结果验签。
 */
function createLibraryLikeBot(onDispatch: (packet: Record<string, unknown>) => void) {
  const middleware = async (ctx: {
    req: import('node:http').IncomingMessage;
    res: import('node:http').ServerResponse;
    request: { body: unknown };
  }, next: () => Promise<void>) => {
    if (next) await next();
    const { req, res } = ctx;
    const fallback = JSON.stringify(ctx.request.body) as string | undefined;
    const bodyData = fallback ?? await new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    const signature = req.headers['x-signature-ed25519']?.toString();
    const timestamp = req.headers['x-signature-timestamp']?.toString() ?? '';
    if (!signature) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing signature');
      return;
    }
    const expected = createHash('sha256').update(timestamp + bodyData).digest('hex');
    if (signature !== expected) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Invalid signature');
      return;
    }
    let packet: Record<string, unknown>;
    try {
      packet = JSON.parse(bodyData) as Record<string, unknown>;
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid JSON');
      return;
    }
    onDispatch(packet);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 0, message: 'success' }));
  };
  return { middleware } as unknown as QqHttpBotTransport;
}

function sign(timestamp: string, rawBody: string): string {
  return createHash('sha256').update(timestamp + rawBody).digest('hex');
}

async function startWebhook(bot: QqHttpBotTransport | null) {
  const http = createHttpHost({ host: '127.0.0.1', port: 0 });
  hosts.push(http);
  const config: ResolvedQqHttpConfig = {
    context: 'qq',
    mode: 'webhook',
    id: 'qq-test',
    appid: 'appid',
    secret: 'secret',
    webhookPath: '/qq/webhook',
    sandbox: false,
  };
  const handler: QqWebhookHandler = { config, getBot: () => bot };
  registerQqWebhookRoutes(http, handler);
  const { port } = await http.listen();
  return `http://127.0.0.1:${port}/qq/webhook`;
}

describe('qq webhook raw-body signature', () => {
  it('verifies signature against raw bytes (whitespace/escapes/key order preserved)', async () => {
    const dispatched = vi.fn();
    const url = await startWebhook(createLibraryLikeBot(dispatched));
    // 原始字节含多余空白、转义与非默认键序；重序列化后必然不同。
    const raw = '{ "t": "GROUP_AT_MESSAGE_CREATE",  "op": 0, "d": { "content": "a\\nb" } }';
    const timestamp = '1700000000';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature-ed25519': sign(timestamp, raw),
        'x-signature-timestamp': timestamp,
      },
      body: raw,
    });
    expect(response.status).toBe(200);
    expect(dispatched).toHaveBeenCalledTimes(1);
    expect(dispatched).toHaveBeenCalledWith(expect.objectContaining({ op: 0 }));
  });

  it('does not hang on non-JSON bodies', async () => {
    const dispatched = vi.fn();
    const url = await startWebhook(createLibraryLikeBot(dispatched));
    const raw = 'this is not json';
    const timestamp = '1700000001';
    const response = await Promise.race([
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'x-signature-ed25519': sign(timestamp, raw),
          'x-signature-timestamp': timestamp,
        },
        body: raw,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('webhook request hung')), 3000);
      }),
    ]);
    // 库验签通过后按 Invalid JSON 400 收尾，而不是挂死。
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('Invalid JSON');
    expect(dispatched).not.toHaveBeenCalled();
  });

  it('responds 503 when the bot is not ready', async () => {
    const url = await startWebhook(null);
    const response = await fetch(url, { method: 'POST', body: '{}' });
    expect(response.status).toBe(503);
  });

  it('rejects a missing or mismatched signature before dispatch', async () => {
    const dispatched = vi.fn();
    const url = await startWebhook(createLibraryLikeBot(dispatched));
    const raw = '{"op":0,"t":"GROUP_AT_MESSAGE_CREATE"}';
    const missing = await fetch(url, { method: 'POST', body: raw });
    expect(missing.status).toBe(400);
    expect(await missing.text()).toBe('Missing signature');
    const timestamp = '1700000002';
    const mismatched = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature-ed25519': sign(timestamp, '{"op":1}'),
        'x-signature-timestamp': timestamp,
      },
      body: raw,
    });
    expect(mismatched.status).toBe(401);
    expect(await mismatched.text()).toBe('Invalid signature');
    expect(dispatched).not.toHaveBeenCalled();
  });

  it('isolates callback paths and hands a repeated body to that receiver again', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const left = vi.fn();
    const right = vi.fn();
    const register = (path: string, onDispatch: (packet: Record<string, unknown>) => void) => {
      const config: ResolvedQqHttpConfig = {
        context: 'qq', mode: 'webhook', id: path, appid: 'appid', secret: 'secret', webhookPath: path, sandbox: false,
      };
      registerQqWebhookRoutes(http, { config, getBot: () => createLibraryLikeBot(onDispatch) });
    };
    register('/qq/left', left);
    register('/qq/right', right);
    const { port } = await http.listen();
    const raw = '{"op":0,"d":{"id":"m-1"}}';
    const timestamp = '1700000003';
    const post = (path: string, signature = sign(timestamp, raw)) => fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature-ed25519': signature,
        'x-signature-timestamp': timestamp,
      },
      body: raw,
    });
    expect((await post('/qq/left')).status).toBe(200);
    expect((await post('/qq/left')).status).toBe(200);
    expect(left).toHaveBeenCalledTimes(2);
    expect(right).not.toHaveBeenCalled();
    expect((await post('/qq/right', sign(timestamp, '{"op":9}'))).status).toBe(401);
    expect(right).not.toHaveBeenCalled();
    expect((await post('/qq/right')).status).toBe(200);
    expect(right).toHaveBeenCalledTimes(1);
    expect((await fetch(`http://127.0.0.1:${port}/qq/missing`, { method: 'POST', body: raw })).status).toBe(404);
    expect(left).toHaveBeenCalledTimes(2);
  });
});
