/**
 * QQ HTTP webhook / middleware inbound via httpHostToken POST.
 */
import path from 'node:path';
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
    return new Response('Internal Server Error', { status: 500, headers: { 'Content-Type': 'text/plain' } });
  }
}

export function qqHttpBotOptions(config: ResolvedQqHttpConfig): ConstructorParameters<typeof Bot<ReceiverMode.MIDDLEWARE, 'koa'>>[0] {
  return { handleProcessErrors: false, appid: config.appid, secret: config.secret,
    mode: ReceiverMode.MIDDLEWARE, platform: 'koa', sandbox: config.sandbox,
    dataDir: path.join(process.cwd(), 'data', 'qq'), logLevel: 'off' };
}
