/**
 * QQ HTTP webhook / middleware inbound via httpHostToken POST.
 */
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Bot, ReceiverMode } from 'qq-official-bot';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
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
    http.route('POST', webhookPath, async (request, response) => {
      await handleQqWebhookRequest(request, response, handler);
    }, { summary: 'QQ webhook callback', tags: ['qq'] }),
  ];
}

export async function handleQqWebhookRequest(
  request: IncomingMessage,
  response: ServerResponse,
  handler: QqWebhookHandler,
): Promise<void> {
  const bot = handler.getBot();
  if (!bot?.middleware) {
    response.writeHead(503, { 'Content-Type': 'text/plain' });
    response.end('QQ receiver not ready');
    return;
  }
  try {
    // 不预消费请求流：库的验签必须基于原始字节（JSON.parse → JSON.stringify
    // 会改变空白/转义/键序导致 401），body 留 undefined 让库自己读流；
    // 预消费还会让非 JSON body 时库监听已结束的 end 事件而挂死。
    await bot.middleware({
      req: request,
      res: response,
      request: { body: undefined },
      response: {},
    }, async () => undefined);
  } catch (error) {
    logger.error('QQ webhook error:', error);
    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.end('Internal Server Error');
    }
  }
}

export async function readRequestBodyText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_048_576) {
      request.destroy();
      throw new Error('Request body exceeds 1MB');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function qqHttpBotOptions(config: ResolvedQqHttpConfig): ConstructorParameters<typeof Bot<ReceiverMode.MIDDLEWARE, 'koa'>>[0] {
  return { handleProcessErrors: false, appid: config.appid, secret: config.secret,
    mode: ReceiverMode.MIDDLEWARE, platform: 'koa', sandbox: config.sandbox,
    dataDir: path.join(process.cwd(), 'data', 'qq'), logLevel: 'off' };
}
