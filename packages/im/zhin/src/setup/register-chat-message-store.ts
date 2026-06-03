/**
 * chat_messages 统一落库：入站 message.receive、出站 message.send。
 * 不依赖 @zhin.js/ai 的 ContextManager 写入路径。
 */
import {
  segment,
  type Message,
  type MessageSendPayload,
  type Plugin,
  resolveSenderRoles,
  extractTextContent,
} from '@zhin.js/core';
import type { AppConfig } from '../types.js';
import type { MessageRecord } from '@zhin.js/ai';

function getModel(plugin: Plugin, name: string): { create: (data: Record<string, unknown>) => Promise<unknown> } | null {
  const db = plugin.inject('database' as keyof Plugin.Contexts) as { models?: Map<string, unknown> } | undefined;
  const model = db?.models?.get(name) as { create: (data: Record<string, unknown>) => Promise<unknown> } | undefined;
  return model ?? null;
}

function messageBody(message: Message): string {
  if (typeof message.$raw === 'string') return message.$raw;
  return segment.raw(message.$content);
}

function recordInbound(plugin: Plugin, message: Message): void {
  const model = getModel(plugin, 'chat_messages');
  if (!model) return;

  const sceneType = message.$channel?.type || 'private';
  const sceneId = message.$channel?.id || message.$sender.id;
  const roles = resolveSenderRoles(message, {}, undefined).roles;
  const senderRole = roles[0] ?? 'user';

  const record: Omit<MessageRecord, 'id'> = {
    message_id: String(message.$id ?? ''),
    platform: message.$adapter,
    bot_id: String(message.$bot ?? ''),
    scene_id: String(sceneId),
    scene_type: sceneType,
    scene_name: (message.$channel as { name?: string })?.name || '',
    sender_id: String(message.$sender?.id ?? ''),
    sender_name: message.$sender?.name || message.$sender?.id || '',
    sender_role: senderRole,
    direction: 'inbound',
    message: messageBody(message),
    time: message.$timestamp || Date.now(),
  };

  model.create(record).catch(() => {});
}

function recordOutbound(plugin: Plugin, payload: MessageSendPayload): void {
  const model = getModel(plugin, 'chat_messages');
  if (!model) return;

  const { options, messageId, adapter } = payload;
  const content =
    typeof options.content === 'string'
      ? options.content
      : segment.raw(options.content);

  const record: Omit<MessageRecord, 'id'> = {
    message_id: String(messageId ?? ''),
    platform: adapter,
    bot_id: String(options.bot ?? ''),
    scene_id: String(options.id ?? ''),
    scene_type: options.type,
    scene_name: '',
    sender_id: String(options.bot ?? ''),
    sender_name: String(options.bot ?? ''),
    sender_role: 'assistant',
    direction: 'outbound',
    message: content,
    time: Date.now(),
  };

  model.create(record).catch(() => {});
}

/**
 * 在 database 就绪且 defineModel 已注册 chat_messages 后调用（通常于 loadPlugins 之后）。
 */
export function registerChatMessageStore(plugin: Plugin, appConfig: AppConfig): void {
  if (!appConfig.database) return;

  plugin.on('message.receive', (msg: Message) => {
    const text = extractTextContent(msg).trim();
    if (!text && !messageBody(msg).trim()) return;
    recordInbound(plugin, msg);
  });

  plugin.on('message.send', (payload: MessageSendPayload) => {
    recordOutbound(plugin, payload);
  });
}
