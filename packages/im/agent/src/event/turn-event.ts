/**
 * TurnEvent — structured event union for the AsyncGenerator streaming API.
 *
 * Consumed by processMessageStream() callers; produced by the turn pipeline.
 */
import type { OutputElement, ToolExecutionCause, Usage } from '@zhin.js/ai';

export interface TurnUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type TurnEvent =
  | TurnStartEvent
  | ChunkEvent
  | CapabilityResolutionEvent
  | MediaResolutionEvent
  | IterationStartEvent
  | ToolCallEvent
  | ToolResultEvent
  | ToolDeniedEvent
  | ToolFailedEvent
  | ToolCancelledEvent
  | ThinkingEvent
  | UsageEvent
  | TurnEndEvent
  | TurnErrorEvent
  | TurnCancelledEvent
  | TurnBudgetExceededEvent
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

export interface IterationStartEvent {
  type: 'iteration_start';
  iteration: number;
  maxIterations: number;
}

/** Immutable capability plan selected before model execution. */
export interface CapabilityResolutionEvent {
  type: 'capability_resolution';
  mode: 'deferred' | 'direct';
  resolvedBy: 'execution-plan' | 'affinity' | 'session';
  tools: string[];
  skills: string[];
  missingTools: string[];
  missingSkills: string[];
}

/** Durable terminal fact for one inbound media item. */
export interface MediaResolutionEvent {
  type: 'media_resolution';
  index: number;
  mediaKind: 'image' | 'audio' | 'video' | 'file';
  status: 'accepted' | 'derived' | 'unsupported' | 'rejected' | 'failed';
  code: string;
}

export interface ToolCallEvent {
  type: 'tool_call';
  toolName: string;
  args: Record<string, unknown>;
  toolUseId: string;
  causedBy?: ToolExecutionCause;
}

export interface ToolResultEvent {
  type: 'tool_result';
  toolName: string;
  output: unknown;
  durationMs: number;
  toolUseId: string;
  causedBy?: ToolExecutionCause;
}

export interface ToolDeniedEvent {
  type: 'tool_denied';
  toolName: string;
  toolUseId: string;
  policy: string;
  reason: string;
  causedBy?: ToolExecutionCause;
}

export interface ToolFailedEvent {
  type: 'tool_failed';
  toolName: string;
  toolUseId: string;
  error: string;
  durationMs: number;
  causedBy?: ToolExecutionCause;
}

export interface ToolCancelledEvent {
  type: 'tool_cancelled';
  toolName: string;
  toolUseId: string;
  reason: string;
  durationMs: number;
  causedBy?: ToolExecutionCause;
}

export interface ThinkingEvent {
  type: 'thinking';
  text: string;
}

/** Per-model-iteration usage, emitted before the next tool/model iteration. */
export interface UsageEvent {
  type: 'usage';
  usage: TurnUsage;
}

export interface TurnEndEvent {
  type: 'turn_end';
  output: OutputElement[];
  usage: TurnUsage;
  /** Control-only ingress links its own principal/journal to the affected turn. */
  control?: Readonly<{
    intent: 'steer' | 'follow_up' | 'observe';
    targetTurnId?: string;
  }>;
}

export interface TurnErrorEvent {
  type: 'error';
  error: Error;
  recoverable: boolean;
  /** Stable failure taxonomy persisted with the terminal fact. */
  code?: string;
}

/** A turn stopped by timeout, replacement, explicit cancellation, or disposal. */
export interface TurnCancelledEvent {
  type: 'turn_cancelled';
  reason: string;
  code: 'cancelled' | 'superseded' | 'timeout' | 'disposed';
}

export interface TurnBudgetExceededEvent {
  type: 'budget_exceeded';
  budget: string;
  usage: TurnUsage;
}

export type TurnTerminalEvent = TurnEndEvent | TurnErrorEvent | TurnCancelledEvent | TurnBudgetExceededEvent;

export function isTurnTerminalEvent(event: TurnEvent): event is TurnTerminalEvent {
  return event.type === 'turn_end'
    || event.type === 'error'
    || event.type === 'turn_cancelled'
    || event.type === 'budget_exceeded';
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
