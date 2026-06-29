/**
 * im_transcripts 统一落库：入站 message.receive、出站 message.send（ADR 0009 D4）。
 */
import {
  type Message,
  type MessageSendPayload,
  type Plugin,
  resolveSubjectRoles,
  extractTextContent,
  isActionMessage,
} from '@zhin.js/core';
import type { AppConfig } from '../types.js';
import type { ImTranscriptWriteInput } from '@zhin.js/ai';

function getModel(plugin: Plugin, name: string): { create: (data: Record<string, unknown>) => Promise<unknown> } | null {
  const db = plugin.inject('database' as keyof Plugin.Contexts) as { models?: Map<string, unknown> } | undefined;
  const model = db?.models?.get(name) as { create: (data: Record<string, unknown>) => Promise<unknown> } | undefined;
  return model ?? null;
}

function serializeMediaJson(content: unknown): string {
  if (content == null) return '';
  if (Array.isArray(content)) {
    try {
      return JSON.stringify(content);
    } catch {
      return '';
    }
  }
  return '';
}

function hasInboundContent(message: Message): boolean {
  if (isActionMessage(message)) return false;
  const text = extractTextContent(message).trim();
  if (text) return true;
  const content = message.$content;
  return Array.isArray(content) && content.length > 0;
}

function recordTranscript(plugin: Plugin, input: ImTranscriptWriteInput): void {
  const model = getModel(plugin, 'im_transcripts');
  if (!model) return;

  const body = input.body ?? '';
  const media = input.media_json ?? '';
  if (!body.trim() && !media.trim()) return;

  model.create({
    message_id: input.message_id ?? '',
    platform: input.platform,
    endpoint_id: input.endpoint_id,
    scene_id: input.scene_id,
    scene_type: input.scene_type,
    sender_id: input.sender_id,
    sender_name: input.sender_name ?? '',
    sender_role: input.sender_role ?? 'user',
    direction: input.direction,
    body,
    media_json: media,
    time: input.time ?? Date.now(),
  }).catch(() => {});
}

function recordInbound(plugin: Plugin, message: Message): void {
  const sceneType = message.$channel?.type || 'private';
  const sceneId = message.$channel?.id || message.$sender.id;
  const roles = resolveSubjectRoles(plugin, message).roles;
  const senderRole = roles[0] ?? 'user';

  recordTranscript(plugin, {
    message_id: String(message.$id ?? ''),
    platform: message.$adapter,
    endpoint_id: String(message.$endpoint ?? ''),
    scene_id: String(sceneId),
    scene_type: sceneType,
    sender_id: String(message.$sender?.id ?? ''),
    sender_name: message.$sender?.name || message.$sender?.id || '',
    sender_role: senderRole,
    direction: 'inbound',
    body: extractTextContent(message),
    media_json: serializeMediaJson(message.$content),
    time: message.$timestamp || Date.now(),
  });
}

function extractOutboundBody(content: MessageSendPayload['options']['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'type' in part && part.type === 'text' && 'text' in part) {
          return String((part as { text: string }).text);
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function recordOutbound(plugin: Plugin, payload: MessageSendPayload): void {
  const { options, messageId, adapter } = payload;
  const body = extractOutboundBody(options.content);
  const mediaJson = serializeMediaJson(
    typeof options.content === 'string' ? [] : options.content,
  );

  recordTranscript(plugin, {
    message_id: String(messageId ?? ''),
    platform: adapter,
    endpoint_id: String(options.endpoint ?? ''),
    scene_id: String(options.id ?? ''),
    scene_type: options.type,
    sender_id: String(options.endpoint ?? ''),
    sender_name: String(options.endpoint ?? ''),
    sender_role: 'assistant',
    direction: 'outbound',
    body,
    media_json: mediaJson,
    time: Date.now(),
  });
}

/**
 * 在 database 就绪且 defineModel 已注册 im_transcripts 后调用（通常于 loadPlugins 之后）。
 */
export function registerChatMessageStore(plugin: Plugin, appConfig: AppConfig): void {
  if (!appConfig.database) return;

  const onReceive = (msg: Message) => {
    if (!hasInboundContent(msg)) return;
    recordInbound(plugin, msg);
  };

  const onSend = (payload: MessageSendPayload) => {
    recordOutbound(plugin, payload);
  };

  plugin.on('message.receive', onReceive);
  plugin.on('message.send', onSend);

  plugin.onDispose(() => {
    plugin.off('message.receive', onReceive);
    plugin.off('message.send', onSend);
  });
}
