import { createToken } from './token.js';

/**
 * Thin Host Resource for proactive Adapter outbound (RSS poll, lottery push,
 * activity-feedback typing text). Implementations typically wrap ImRuntime
 * `sendEndpointMessage` (resolve adapter/endpoint → AdapterIndex.send).
 */
export interface OutboundSendInput {
  readonly adapter: string;
  readonly endpointId: string;
  readonly channelType: string;
  readonly channelId: string;
  readonly content: string;
}

export interface OutboundReactionInput {
  readonly adapter: string;
  readonly endpointId: string;
  readonly messageId: string;
  readonly emoji: string;
  readonly sceneType?: string;
  readonly channelId?: string;
}

export interface OutboundRemoveReactionInput {
  readonly adapter: string;
  readonly endpointId: string;
  readonly messageId: string;
  readonly reactionId: string;
}

export interface OutboundRecallInput {
  readonly adapter: string;
  readonly endpointId: string;
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
