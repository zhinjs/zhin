/**
 * TurnEvent — structured event union for the AsyncGenerator streaming API.
 *
 * Consumed by processMessageStream() callers; produced by the turn pipeline.
 */
import type { OutputElement, Usage } from '@zhin.js/ai';

export interface TurnUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type TurnEvent =
  | TurnStartEvent
  | ChunkEvent
  | ToolCallEvent
  | ToolResultEvent
  | ThinkingEvent
  | TurnEndEvent
  | TurnErrorEvent
  | SubagentStartEvent
  | SubagentProgressEvent
  | SubagentEndEvent
  | McpConnectEvent
  | McpToolCallEvent;

export interface TurnStartEvent {
  type: 'turn_start';
  sessionId: string;
  turnId: string;
}

export interface ChunkEvent {
  type: 'chunk';
  text: string;
  accumulated: string;
}

export interface ToolCallEvent {
  type: 'tool_call';
  toolName: string;
  args: Record<string, unknown>;
  toolUseId: string;
}

export interface ToolResultEvent {
  type: 'tool_result';
  toolName: string;
  output: unknown;
  durationMs: number;
  toolUseId: string;
}

export interface ThinkingEvent {
  type: 'thinking';
  text: string;
}

export interface TurnEndEvent {
  type: 'turn_end';
  output: OutputElement[];
  usage: TurnUsage;
}

export interface TurnErrorEvent {
  type: 'error';
  error: Error;
  recoverable: boolean;
}

export interface SubagentStartEvent {
  type: 'subagent_start';
  taskId: string;
  agentName?: string;
  description: string;
}

export interface SubagentProgressEvent {
  type: 'subagent_progress';
  taskId: string;
  summary: string;
}

export interface SubagentEndEvent {
  type: 'subagent_end';
  taskId: string;
  status: 'ok' | 'error';
  result?: string;
}

export interface McpConnectEvent {
  type: 'mcp_connect';
  serverName: string;
  status: 'connecting' | 'connected' | 'error';
}

export interface McpToolCallEvent {
  type: 'mcp_tool_call';
  serverName: string;
  toolName: string;
}
