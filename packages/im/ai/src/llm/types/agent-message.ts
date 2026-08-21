import type {
  ContentBlock,
  MediaContentBlock,
  ToolResultContentBlock,
  UserContentBlock,
} from './content-block.js';

/** Base fields shared by persisted agent messages. */
export interface AgentMessageBase {
  timestamp: number;
}

/** Stable participant attribution carried by shared conversation history. */
export interface ConversationActor {
  readonly subjectId: string;
  readonly displayName?: string;
  readonly roles?: readonly string[];
  /** Shared-scene hint used only when rendering participant labels. */
  readonly scope?: 'private' | 'group' | 'channel';
}

/** Canonical ingress turn that introduced a participant message. */
export interface ConversationTurnCause {
  readonly turnId: string;
  readonly intent?: 'new' | 'steer' | 'follow_up' | 'supersede' | 'observe';
  readonly targetTurnId?: string;
}

export interface UserMessage extends AgentMessageBase {
  role: 'user';
  content: UserContentBlock[];
  actor?: ConversationActor;
  cause?: ConversationTurnCause;
  /**
   * 当前 turn 的媒体块（canonical Segment 子集同构，agent 层透传）。
   * 不随 session 历史持久化——持久化层写入前剥离该字段，历史中只留文本占位。
   */
  media?: MediaContentBlock[];
}

export interface AssistantMessage extends AgentMessageBase {
  role: 'assistant';
  content: ContentBlock[];
  api: string;
  provider: string;
  model: string;
  usage: TokenUsage;
  stopReason: AssistantStopReason;
  errorMessage?: string;
}

export interface ToolResultMessage extends AgentMessageBase {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: ToolResultContentBlock[];
  isError: boolean;
}

/** IM / product extensions via declaration merging in @zhin.js/agent. */
export interface CustomAgentMessage extends AgentMessageBase {
  role: string;
  [key: string]: unknown;
}

export type AgentMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | CustomAgentMessage;

export type AssistantStopReason =
  | 'stop'
  | 'length'
  | 'toolCalls'
  | 'error'
  | 'aborted';

export interface TokenCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: TokenCost;
}

export const EMPTY_TOKEN_USAGE: TokenUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export function isLlmAgentMessage(message: AgentMessage): message is UserMessage | AssistantMessage | ToolResultMessage {
  return message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult';
}

export function createUserMessage(
  text: string,
  media?: MediaContentBlock[],
  timestamp = Date.now(),
  actor?: ConversationActor,
  cause?: ConversationTurnCause,
): UserMessage {
  const content: UserContentBlock[] = [{ type: 'text', text }];
  return {
    role: 'user',
    content,
    ...(actor ? { actor } : {}),
    ...(cause ? { cause } : {}),
    ...(media?.length ? { media } : {}),
    timestamp,
  };
}
