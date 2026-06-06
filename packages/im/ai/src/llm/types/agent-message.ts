import type {
  ContentBlock,
  ImageContent,
  ToolResultContentBlock,
  UserContentBlock,
} from './content-block.js';

/** Base fields shared by persisted agent messages. */
export interface AgentMessageBase {
  timestamp: number;
}

export interface UserMessage extends AgentMessageBase {
  role: 'user';
  content: UserContentBlock[];
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
  images?: ImageContent[],
  timestamp = Date.now(),
): UserMessage {
  const content: UserContentBlock[] = [{ type: 'text', text }];
  if (images?.length) {
    content.push(...images);
  }
  return { role: 'user', content, timestamp };
}
