/**
 * QQ HTTP webhook / middleware inbound via httpHostToken POST.
 */
import path from 'node:path';
import { Bot, ReceiverMode } from 'qq-official-bot';
import { EventEmitter } from 'node:events';
import { readBodyBytes, type HttpHost, type HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { ResolvedQqHttpConfig } from './protocol.js';
import type { QqBotTransport } from './ws.js';

const logger = getLogger('qq');

export type QqHttpBotTransport = Bot<ReceiverMode.MIDDLEWARE, 'koa'>;

export interface QqWebhookHandler {
  readonly config: ResolvedQqHttpConfig;
  getBot(): (QqHttpBotTransport & { middleware?: QqHttpBotTransport['middleware'] }) | null;
}

export function registerQqWebhookRoutes(
  http: HttpHost,
  handler: QqWebhookHandler,
): HttpRouteRegistration[] {
  const webhookPath = handler.config.webhookPath;
  return [
    http.route('POST', webhookPath, (request) => handleQqWebhookRequest(request, handler), { summary: 'QQ webhook callback', tags: ['qq'] }),
  ];
}

export async function handleQqWebhookRequest(
  request: Request,
  handler: QqWebhookHandler,
): Promise<Response> {
  const bot = handler.getBot();
  if (!bot?.middleware) {
    return new Response('QQ receiver not ready', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
  try {
    // 库的验签必须基于原始字节（JSON.parse → JSON.stringify 会改变空白/转义/键序导致 401）：
    // body 留 undefined，把原始字节作为库读取的 Node 风格请求流交给它。
    const raw = await readBodyBytes(request);
    const req = Object.assign(new EventEmitter(), { headers: Object.fromEntries(request.headers) });
    const res = new MiddlewareResponse();
    const handled = bot.middleware({ req, res, request: { body: undefined }, response: {} } as never, async () => undefined);
    queueMicrotask(() => {
      req.emit('data', Buffer.from(raw));
      req.emit('end');
    });
    await handled;
    return res.toResponse();
  } catch (error) {
    logger.error('QQ webhook error:', error);
    return new Response('Internal Server Error', { status: 500, headers: { 'Content-Type': 'text/plain' } });
  }
}

/** Collects what the library middleware writes with `writeHead` / `end`. */
class MiddlewareResponse {
  headersSent = false;
  #status = 200;
  #headers: Record<string, string> = {};
  #body: string | undefined;

  writeHead(status: number, headers?: Record<string, string>): this {
    this.#status = status;
    if (headers) this.#headers = { ...this.#headers, ...headers };
    this.headersSent = true;
    return this;
  }

  end(body?: string): void {
    this.headersSent = true;
    this.#body = body;
  }

  toResponse(): Response {
    return new Response(this.#body ?? null, { status: this.#status, headers: this.#headers });
  }
}

export function qqHttpBotOptions(config: ResolvedQqHttpConfig): ConstructorParameters<typeof Bot<ReceiverMode.MIDDLEWARE, 'koa'>>[0] {
  return { handleProcessErrors: false, appid: config.appid, secret: config.secret,
    mode: ReceiverMode.MIDDLEWARE, platform: 'koa', sandbox: config.sandbox,
    dataDir: path.join(process.cwd(), 'data', 'qq'), logLevel: 'off' };
}
