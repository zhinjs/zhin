import { createToken } from './token.js';

/**
 * 未锚定 endpoint 的会话地址（结构对齐 `@zhin.js/im-contract` 的
 * `Omit<ConversationRef, 'endpoint'>`；plugin-runtime 是零依赖 kernel 层，
 * 不能 import IM 契约，故此处独立声明，靠结构类型兼容）。
 */
export interface OutboundConversation {
  readonly kind: 'private' | 'group' | 'channel';
  readonly id: string;
  readonly parent?: Readonly<{
    readonly kind: 'group' | 'channel';
    readonly id: string;
  }>;
  readonly threadId?: string;
}

/**
 * Thin Host Resource for proactive Adapter outbound (RSS poll, lottery push,
 * activity-feedback typing text). Implementations typically wrap ImRuntime
 * `sendEndpointMessage` (resolve adapter/endpoint → AdapterIndex.send).
 */
export interface OutboundSendInput {
  readonly adapter: string;
  readonly endpointKey: string;
  readonly conversation: OutboundConversation;
  readonly content: string;
}

export interface OutboundReactionInput {
  readonly adapter: string;
  readonly endpointKey: string;
  readonly messageId: string;
  readonly emoji: string;
  readonly sceneType?: string;
  readonly channelId?: string;
}

export interface OutboundRemoveReactionInput {
  readonly adapter: string;
  readonly endpointKey: string;
  readonly messageId: string;
  readonly reactionId: string;
}

export interface OutboundRecallInput {
  readonly adapter: string;
  readonly endpointKey: string;
  readonly messageId: string;
}

export interface OutboundHost {
  /** Returns platform message id when available (activity-feedback needs it). */
  send(input: OutboundSendInput): Promise<string | null>;
  /** Optional: platform message reactions (icqq group emoji, etc.). */
  addReaction?(input: OutboundReactionInput): Promise<string | null>;
  removeReaction?(input: OutboundRemoveReactionInput): Promise<void>;
  /** Optional: recall/delete a status message (activity-feedback autoRemove). */
  recall?(input: OutboundRecallInput): Promise<void>;
}

export const outboundHostToken = createToken<OutboundHost>(
  'zhin.outbound.host',
  'Plugin Runtime outbound push host',
);
