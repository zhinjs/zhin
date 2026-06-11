/**
 * Message enrich — 入站鉴权快照与合成通讯上下文
 */
import type { Plugin } from '../plugin.js';
import { Message, type MessageChannel } from '../message.js';
import type { Adapters } from '../adapter.js';
import type { MessageElement, SendContent } from '../types.js';
import type { SenderRole } from './roles.js';
import { hasSenderRole } from './roles.js';
import { resolveSubjectRoles } from './authorization.js';
import { getPlugin } from '../plugin.js';

/** Agent turn 可挂载在 Message 扩展字段上的元数据 */
export type AgentTurnMessage = Message<{ extra?: Record<string, unknown> }>;

function frameworkRolesFromSenderFlags(sender: {
  isMaster?: boolean;
  isTrusted?: boolean;
}): readonly SenderRole[] {
  if (sender.isMaster) return ['master'];
  if (sender.isTrusted) return ['trusted'];
  return ['user'];
}

export function senderRolesFromMessage(message: Message<any>): readonly SenderRole[] {
  const sender = message.$sender;
  if (sender.isMaster !== undefined || sender.isTrusted !== undefined) {
    return frameworkRolesFromSenderFlags(sender);
  }
  try {
    const plugin = getPlugin().root ?? getPlugin();
    return resolveSubjectRoles(plugin, message).roles;
  } catch {
    return ['user'];
  }
}

/**
 * 入站 enrich：写入 $sender.isMaster / isTrusted 快照（本 turn 只读）
 */
export function enrichMessageForAgent(plugin: Plugin, message: Message<any>): Message<any> {
  const { roles } = resolveSubjectRoles(plugin.root ?? plugin, message);
  message.$sender.isMaster = hasSenderRole(roles, 'master');
  message.$sender.isTrusted = !message.$sender.isMaster && hasSenderRole(roles, 'trusted');
  return message;
}

export interface SyntheticMessageInput {
  adapter: keyof Adapters | string;
  endpoint: string;
  sender: {
    id: string;
    name?: string;
    role?: string;
    isMaster?: boolean;
    isTrusted?: boolean;
  };
  channel: MessageChannel;
  id?: string;
  quote_id?: string;
  reply?: (content: SendContent, quote?: boolean | string) => Promise<string>;
  extra?: Record<string, unknown>;
}

/** cron / subagent / mission 等无真实入站时构造最小 Message */
export function createSyntheticMessage(input: SyntheticMessageInput): AgentTurnMessage {
  const id = input.id ?? `synthetic:${Date.now()}`;
  const reply = input.reply ?? (async () => id);
  return Message.from(
    { extra: input.extra },
    {
      $id: id,
      $adapter: input.adapter as keyof Adapters,
      $endpoint: input.endpoint,
      $content: [] as MessageElement[],
      $sender: { ...input.sender },
      $reply: reply,
      $recall: async () => {},
      $channel: input.channel,
      $timestamp: Date.now(),
      $raw: '',
      $quote_id: input.quote_id,
    },
  );
}

/** hook context 中的 commMessage 字段（AIHookEvent.context） */
export function commMessageFromHookContext(context: Record<string, unknown>): Message<any> | undefined {
  const raw = context.commMessage;
  if (raw && typeof raw === 'object' && '$sender' in raw) {
    return raw as Message<any>;
  }
  return undefined;
}

/** 兼容 tool parameters 上的 contextKey（endpointId / sceneId / scope 等） */
export function resolveContextKey(message: Message<any>, key: string): unknown {
  switch (key) {
    case 'platform':
      return message.$adapter;
    case 'endpointId':
      return message.$endpoint;
    case 'messageId':
      return message.$id;
    case 'sceneId':
      return message.$channel?.id ?? message.$sender.id;
    case 'senderId':
      return message.$sender.id;
    case 'scope':
      return message.$channel?.type ?? 'private';
    default: {
      if (key in message) {
        return (message as Record<string, unknown>)[key];
      }
      const extra = (message as AgentTurnMessage).extra;
      return extra?.[key];
    }
  }
}
