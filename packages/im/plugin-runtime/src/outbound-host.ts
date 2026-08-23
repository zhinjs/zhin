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
  readonly message: OutboundMessage;
  readonly emoji: string;
  readonly sceneType?: string;
  readonly channelId?: string;
}

export interface OutboundRemoveReactionInput {
  readonly adapter: string;
  readonly endpointKey: string;
  readonly message: OutboundMessage;
  readonly reactionId: string;
}

export interface OutboundRecallInput {
  readonly adapter: string;
  readonly endpointKey: string;
  readonly message: OutboundMessage;
}

export type OutboundEndpointOperation = 'recall' | 'edit' | 'reaction' | 'typing';

export interface OutboundEndpointInput {
  readonly adapter: string;
  readonly endpointKey: string;
}

export interface OutboundEndpointCapabilities {
  readonly operations: readonly OutboundEndpointOperation[];
}

export interface OutboundEditInput extends OutboundEndpointInput {
  readonly message: OutboundMessage;
  readonly content: unknown;
}

export interface OutboundTypingInput extends OutboundEndpointInput {
  readonly conversation: OutboundMessage['conversation'];
  readonly active?: boolean;
}


/** Structured message identity; structurally compatible with IM MessageRef. */
export interface OutboundMessage {
  readonly conversation: OutboundConversation & Readonly<{
    readonly endpoint: Readonly<{ readonly id: string; readonly adapter: string }>;
  }>;
  readonly id: string;
}

export interface OutboundHost {
  /** Exact operations declared by one live Endpoint. */
  capabilities?(input: OutboundEndpointInput): OutboundEndpointCapabilities | undefined;
  /** Returns platform message id when available (activity-feedback needs it). */
  send(input: OutboundSendInput): Promise<string | null>;
  /** Optional: platform message reactions (icqq group emoji, etc.). */
  addReaction?(input: OutboundReactionInput): Promise<string | null>;
  removeReaction?(input: OutboundRemoveReactionInput): Promise<void>;
  /** Optional: recall/delete a status message (activity-feedback autoRemove). */
  recall?(input: OutboundRecallInput): Promise<void>;
  /** Optional: update a previously sent status message. */
  edit?(input: OutboundEditInput): Promise<string | null>;
  /** Optional: toggle the platform-native typing indicator. */
  typing?(input: OutboundTypingInput): Promise<void>;
}

export const outboundHostToken = createToken<OutboundHost>(
  'zhin.outbound.host',
  'Plugin Runtime outbound push host',
);
