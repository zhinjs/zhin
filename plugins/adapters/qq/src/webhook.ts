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
    let parsedBody: unknown;
    const raw = await readRequestBodyText(request);
    if (raw) {
      try {
        parsedBody = JSON.parse(raw);
      } catch {
        parsedBody = undefined;
      }
    }
    await bot.middleware({
      req: request,
      res: response,
      request: { body: parsedBody },
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
    sendPrivateMessage: (userId, message) => bot.sendPrivateMessage(userId, message),
    sendGroupMessage: (groupId, message) => bot.sendGroupMessage(groupId, message),
    sendGuildMessage: (channelId, message) => bot.sendGuildMessage(channelId, message),
    sendDirectMessage: (guildId, message) => bot.sendDirectMessage(guildId, message),
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
