/**
 * QQ WebSocket transport: bot factory and inbound message normalization.
 */
import path from 'node:path';
import { Bot, ReceiverMode } from 'qq-official-bot';
import { getLevel, toLog4jsLevel } from '@zhin.js/logger';
import type { QqChannelKind, QqInboundMessage, ResolvedQqWebsocketConfig } from './protocol.js';

/** Minimal bot surface used by the endpoint (real qq-official-bot or test mock). */
export interface QqBotTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeAllListeners(): void;
  sendPrivateMessage(userId: string, message: string): Promise<unknown>;
  sendGroupMessage(groupId: string, message: string): Promise<unknown>;
  sendGuildMessage(channelId: string, message: string): Promise<unknown>;
  sendDirectMessage?(guildId: string, message: string): Promise<unknown>;
  getGuilds(): Promise<unknown[]>;
  getChannels(guildId: string): Promise<unknown[]>;
  getChannelInfo(channelId: string): Promise<unknown>;
  getGuildMember(guildId: string, userId: string): Promise<unknown>;
  getGuildRoles(guildId: string): Promise<unknown[]>;
  createGuildRole(guildId: string, name: string, color?: number): Promise<unknown>;
  addMemberRole(
    guildId: string,
    channelId: string,
    userId: string,
    roleId: string,
  ): Promise<boolean>;
  removeMemberRole(
    guildId: string,
    channelId: string,
    userId: string,
    roleId: string,
  ): Promise<boolean>;
}

export type CreateQqBot = (config: ResolvedQqWebsocketConfig) => QqBotTransport;

export function bindQqBotInboundEvents(
  bot: QqBotTransport,
  admitRaw: (raw: unknown) => void,
): void {
  bot.on('message.group', admitRaw);
  bot.on('message.guild', admitRaw);
  bot.on('message.private', admitRaw);
}

export function normalizeQqMessage(raw: unknown): QqInboundMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as {
    message_id?: string | number;
    message_type?: string;
    sub_type?: string;
    user_id?: string | number;
    group_id?: string | number;
    group_openid?: string;
    channel_id?: string | number;
    guild_id?: string | number;
    raw_message?: string;
    message?: unknown;
    sender?: { user_id?: string | number; user_name?: string; roles?: (string | number)[] };
    member?: { roles?: (string | number)[] };
    author?: { member_openid?: string; user_openid?: string; id?: string; username?: string };
  };
  if (msg.message_id == null) return null;

  let channelKind: QqChannelKind = 'private';
  let channelId = '';
  if (msg.message_type === 'guild') {
    channelKind = msg.sub_type === 'direct' ? 'direct' : 'channel';
    channelId = channelKind === 'direct'
      ? String(msg.guild_id ?? '')
      : String(msg.channel_id ?? '');
  } else if (msg.message_type === 'group') {
    channelKind = 'group';
    channelId = String(msg.group_id ?? msg.group_openid ?? '');
  } else {
    channelKind = 'private';
    channelId = String(msg.user_id ?? msg.author?.user_openid ?? msg.author?.id ?? '');
  }
  if (!channelId) return null;

  const authorId = String(
    msg.sender?.user_id
    ?? msg.user_id
    ?? msg.author?.member_openid
    ?? msg.author?.user_openid
    ?? msg.author?.id
    ?? '',
  );
  const content = extractTextContent(msg.message) || msg.raw_message || '';
  const rawRoles = msg.member?.roles ?? msg.sender?.roles;
  const authorRoles = Array.isArray(rawRoles) ? rawRoles.map(String) : undefined;

  return {
    id: String(msg.message_id),
    content,
    channelKind,
    channelId,
    authorId,
    authorName: msg.sender?.user_name || msg.author?.username || authorId,
    authorRoles,
    timestamp: Date.now(),
    guildId: msg.guild_id != null ? String(msg.guild_id) : undefined,
    rawMessage: msg.raw_message,
  };
}

function extractTextContent(message: unknown): string {
  if (typeof message === 'string') return message;
  if (!Array.isArray(message)) return '';
  return message
    .map((seg) => {
      if (!seg || typeof seg !== 'object') return '';
      const item = seg as { type?: string; data?: { text?: string }; text?: string };
      if (item.type === 'text') return String(item.data?.text ?? item.text ?? '');
      return '';
    })
    .join('');
}

export function defaultCreateBot(config: ResolvedQqWebsocketConfig): QqBotTransport {
  const bot = new Bot({
    appid: config.appid,
    secret: config.secret,
    mode: ReceiverMode.WEBSOCKET,
    sandbox: config.sandbox,
    dataDir: path.join(process.cwd(), 'data', 'qq'),
    logLevel: toLog4jsLevel(getLevel()),
    ...(config.intents ? { intents: config.intents as never } : {}),
    ...(config.accessTokenUrl ? { accessTokenUrl: config.accessTokenUrl } : {}),
    ...(config.gatewayUrl ? { gatewayUrl: config.gatewayUrl } : {}),
  });

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
  };
}
