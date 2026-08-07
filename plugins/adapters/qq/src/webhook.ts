/**
 * QQ HTTP webhook / middleware inbound via httpHostToken POST.
 */
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Bot, ReceiverMode, type Sendable } from 'qq-official-bot';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { ResolvedQqHttpConfig } from './protocol.js';
import type { QqBotTransport } from './ws.js';

const logger = getLogger('qq');

export type QqHttpBotTransport = QqBotTransport & {
  middleware: (ctx: unknown, next: () => Promise<void>) => Promise<unknown>;
};

export type CreateQqHttpBot = (config: ResolvedQqHttpConfig) => QqHttpBotTransport;

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

export function defaultCreateHttpBot(config: ResolvedQqHttpConfig): QqHttpBotTransport {
  const bot = new Bot({
    appid: config.appid,
    secret: config.secret,
    mode: ReceiverMode.MIDDLEWARE,
    platform: 'koa',
    sandbox: config.sandbox,
    dataDir: path.join(process.cwd(), 'data', 'qq'),
    // 关闭内置 log4js，与 WebSocket 模式一致走 zhin adapter logger
    logLevel: 'off',
  } as never) as Bot<ReceiverMode.MIDDLEWARE, 'koa'> & QqBotTransport;

  return {
    start: () => bot.start().then(() => undefined),
    stop: () => bot.stop().then(() => undefined),
    on: (event, listener) => {
      bot.on(event as never, listener as never);
    },
    removeAllListeners: () => {
      bot.removeAllListeners(undefined as never);
    },
    sendPrivateMessage: (userId, message) => bot.sendPrivateMessage(userId, message as Sendable),
    sendGroupMessage: (groupId, message) => bot.sendGroupMessage(groupId, message as Sendable),
    sendGuildMessage: (channelId, message) => bot.sendGuildMessage(channelId, message as Sendable),
    sendDirectMessage: (guildId, message) => bot.sendDirectMessage(guildId, message as Sendable),
    recallPrivateMessage: (userId, messageId) => bot.recallPrivateMessage(userId, messageId),
    recallGroupMessage: (groupId, messageId) => bot.recallGroupMessage(groupId, messageId),
    recallGuildMessage: (channelId, messageId) => bot.recallGuildMessage(channelId, messageId),
    recallDirectMessage: (guildId, messageId) => bot.recallDirectMessage(guildId, messageId),
    getGuilds: () => bot.guildService.getList(),
    getChannels: (guildId) => bot.channelService.getList(guildId),
    getChannelInfo: (channelId) => bot.channelService.getInfo(channelId),
    getGuildMember: (guildId, userId) => bot.memberService.getGuildMemberInfo(guildId, userId),
    getGuildRoles: (guildId) => bot.guildService.getRoles(guildId),
    createGuildRole: (guildId, name, color) =>
      bot.guildService.createRole(guildId, { name, color: color || 0, hoist: 0 }),
    addMemberRole: async (guildId, channelId, userId, roleId) => {
      await bot.memberService.addMemberRole(guildId, channelId, userId, roleId);
      return true;
    },
    removeMemberRole: async (guildId, channelId, userId, roleId) => {
      await bot.memberService.removeMemberRole(guildId, channelId, userId, roleId);
      return true;
    },
    middleware: (ctx, next) => bot.middleware(ctx as never, next as never),
  };
}
