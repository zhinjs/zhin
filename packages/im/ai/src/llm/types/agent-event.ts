import type { AgentMessage, AssistantMessage } from './agent-message.js';
import type { ParsedToolCall } from './tool.js';

export type AgentEvent =
  | { type: 'agent_start' }
  | { type: 'agent_end'; messages: AgentMessage[]; userMessages?: AgentMessage[] }
  | { type: 'turn_start' }
  | { type: 'turn_end'; message: AssistantMessage; toolResults: AgentMessage[] }
  | { type: 'message_start'; message: AgentMessage }
  | { type: 'message_update'; message: AgentMessage; delta?: AgentMessageDelta }
  | { type: 'message_end'; message: AgentMessage }
  | { type: 'tool_execution_start'; toolCallId: string; toolCall: ParsedToolCall }
  | { type: 'tool_execution_end'; toolCallId: string; result: AgentMessage };

export type AgentMessageDelta =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'toolcall_delta'; toolCall: Partial<ParsedToolCall> };

export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';

export type ToolExecutionMode = 'parallel' | 'sequential';
