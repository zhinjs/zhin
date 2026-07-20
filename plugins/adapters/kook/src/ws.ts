/**
 * KOOK WebSocket transport: kook-client wrapper and inbound message normalization.
 */
import path from 'node:path';
import { Client } from 'kook-client';
import {
  type KookInboundMessage,
  type ResolvedKookConfig,
  type ResolvedKookWebhookConfig,
  type ResolvedKookWebsocketConfig,
} from './protocol.js';

/** Minimal client surface used by the endpoint (real kook-client or test mock). */
export interface KookClientTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeAllListeners(): void;
  sendChannelMsg(
    channelId: string,
    message: string,
  ): Promise<{ msg_id?: string | number }>;
  sendPrivateMsg(
    userId: string,
    message: string,
  ): Promise<{ msg_id?: string | number }>;
  pickGuild(guildId: string): {
    kick(userId: string): Promise<boolean>;
    getRoleList(): Promise<Array<{
      role_id: string | number;
      name: string;
      color?: number;
      position?: number;
      permissions?: unknown;
    }>>;
    createRole(name: string): Promise<{ role_id: string | number; name: string }>;
    deleteRole(roleId: string): Promise<boolean>;
  };
  pickGuildMember(guildId: string, userId: string): {
    addToBlackList(remark?: string, delMsgDays?: number): Promise<boolean>;
    removeFromBlackList(): Promise<boolean>;
    grant(roleId: string): Promise<boolean>;
    revoke(roleId: string): Promise<boolean>;
    setNickname(nickname: string): Promise<boolean>;
  };
  getGuildUserList?(guildId: string, channelId?: string): Promise<unknown[]>;
  self_id?: string | number;
}

export type CreateKookClient = (config: ResolvedKookConfig) => KookClientTransport;

export function normalizeKookMessage(raw: unknown): KookInboundMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as {
    message_id?: string | number;
    message_type?: string;
    author_id?: string | number;
    timestamp?: number;
    raw_message?: string;
    channel_id?: string | number;
    author?: { info?: { nickname?: string; username?: string; bot?: boolean; roles?: number[] }; bot?: boolean; roles?: number[] };
    message?: Array<{ type?: string; text?: string }>;
    channel?: { info?: { guild_id?: string } };
  };
  if (msg.message_id == null || msg.author_id == null) return null;

  const channelKind = msg.message_type === 'channel' ? 'channel' : 'private';
  const channelId = channelKind === 'channel'
    ? String(msg.channel_id ?? '')
    : String(msg.author_id);
  if (!channelId) return null;

  const textParts: string[] = [];
  for (const seg of msg.message ?? []) {
    if (seg.type === 'text' || seg.type === 'markdown') {
      if (seg.text) textParts.push(seg.text);
    }
  }
  const content = textParts.join('') || msg.raw_message || '';

  return {
    id: String(msg.message_id),
    content,
    channelKind,
    channelId,
    authorId: String(msg.author_id),
    authorName: msg.author?.info?.nickname
      || msg.author?.info?.username
      || String(msg.author_id),
    authorBot: msg.author?.bot === true || msg.author?.info?.bot === true,
    authorRoles: msg.author?.info?.roles ?? msg.author?.roles,
    timestamp: msg.timestamp ?? Date.now(),
    guildId: msg.channel?.info?.guild_id,
    rawMessage: msg.raw_message,
  };
}

export function defaultCreateClient(config: ResolvedKookWebsocketConfig): KookClientTransport {
  return new Client({
    token: config.token,
    mode: 'websocket',
    data_dir: config.data_dir || path.join(process.cwd(), 'data', 'kook'),
    timeout: config.timeout,
    max_retry: config.max_retry,
    ignore: config.ignore,
    logLevel: config.logLevel,
  }) as unknown as KookClientTransport;
}

export function defaultCreateWebhookClient(config: ResolvedKookWebhookConfig): KookClientTransport {
  return new Client({
    token: config.token,
    mode: 'webhook',
    data_dir: path.join(process.cwd(), 'data', 'kook'),
    timeout: 10_000,
    max_retry: 3,
    ignore: config.ignore,
    logLevel: config.logLevel,
  }) as unknown as KookClientTransport;
}
