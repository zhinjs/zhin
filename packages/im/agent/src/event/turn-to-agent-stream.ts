/**
 * Maps internal TurnEvent to Eve-aligned AgentStreamEvent (ADR 0039 P0).
 */
import {
  AgentRunJournal,
  AgentStreamEventType,
  type AgentRunEventInput,
  type AgentStreamEvent,
} from '@zhin.js/ai/agent-stream';
import type { TurnEvent } from './turn-event.js';

export interface TurnToStreamContext {
  sessionId: string;
  turnId: string;
  journal?: AgentRunJournal;
}

function textFromOutput(output: unknown): string {
  if (!Array.isArray(output)) return '';
  return output
    .map((el) => {
      if (el && typeof el === 'object' && 'type' in el && (el as { type: string }).type === 'text') {
        return String((el as { content?: string }).content ?? '');
      }
      return '';
    })
    .join('\n')
    .trim();
}

/** Map one TurnEvent to zero or more wire events. */
export function mapTurnEventToAgentStreamEvents(
  event: TurnEvent,
  ctx: TurnToStreamContext,
): AgentStreamEvent[] {
  const mapped = mapTurnEvent(event, ctx);
  return ctx.journal ? mapped.flatMap((streamEvent) => {
    const appended = ctx.journal!.append(streamEvent);
    return appended ? [appended] : [];
  }) : mapped;
}

function mapTurnEvent(
  event: TurnEvent,
  ctx: TurnToStreamContext,
): AgentRunEventInput[] {
  const base = { timestamp: Date.now() };

  switch (event.type) {
    case 'turn_start':
      return [{
        ...base,
        type: AgentStreamEventType.TURN_STARTED,
        data: { sessionId: ctx.sessionId, turnId: ctx.turnId },
      }];
    case 'chunk':
      return [{
        ...base,
        type: AgentStreamEventType.MESSAGE_APPENDED,
        data: {
          messageDelta: event.text,
          message: event.accumulated,
        },
      }];
    case 'thinking':
      return [{
        ...base,
        type: AgentStreamEventType.REASONING_APPENDED,
        data: {
          reasoningDelta: event.text,
          reasoning: event.text,
        },
      }];
    case 'tool_call':
      return [{
        ...base,
        type: AgentStreamEventType.ACTIONS_REQUESTED,
        data: {
          callId: event.toolUseId,
          toolName: event.toolName,
          input: event.args,
        },
      }];
    case 'tool_result':
      return [{
        ...base,
        type: AgentStreamEventType.ACTION_RESULT,
        data: {
          callId: event.toolUseId,
          toolName: event.toolName,
          output: event.output,
          durationMs: event.durationMs,
        },
      }];
    case 'tool_denied':
      return [{ ...base, type: AgentStreamEventType.ACTION_RESULT, data: {
        callId: event.toolUseId, toolName: event.toolName, status: 'denied',
        policy: event.policy, reason: event.reason,
      } }];
    case 'tool_failed':
      return [{ ...base, type: AgentStreamEventType.ACTION_RESULT, data: {
        callId: event.toolUseId, toolName: event.toolName, status: 'failed',
        error: event.error, durationMs: event.durationMs,
      } }];
    case 'tool_cancelled':
      return [{ ...base, type: AgentStreamEventType.ACTION_RESULT, data: {
        callId: event.toolUseId, toolName: event.toolName, status: 'cancelled',
        reason: event.reason, durationMs: event.durationMs,
      } }];
    case 'turn_end': {
      const message = textFromOutput(event.output);
      return [
        {
          ...base,
          type: AgentStreamEventType.MESSAGE_COMPLETED,
          data: {
            message,
            finishReason: 'stop',
            usage: event.usage,
          },
        },
        terminalEvent('completed', AgentStreamEventType.TURN_COMPLETED, {
          usage: event.usage,
        }, ctx),
      ];
    }
    case 'error':
      return [terminalEvent('failed', AgentStreamEventType.TURN_FAILED, {
        code: 'TURN_ERROR',
        message: event.error.message,
        recoverable: event.recoverable,
      }, ctx)];
    case 'turn_cancelled':
      return [terminalEvent('cancelled', AgentStreamEventType.TURN_CANCELLED, {
        code: event.code,
        reason: event.reason,
      }, ctx)];
    case 'budget_exceeded':
      return [terminalEvent('budget_exceeded', AgentStreamEventType.TURN_BUDGET_EXCEEDED, {
        budget: event.budget,
        usage: event.usage,
      }, ctx)];
    case 'subagent_start':
      return [{
        ...base,
        type: AgentStreamEventType.SUBAGENT_CALLED,
        data: {
          taskId: event.taskId,
          agentName: event.agentName,
          description: event.description,
        },
      }];
    case 'subagent_end':
      return [{
        ...base,
        type: AgentStreamEventType.SUBAGENT_COMPLETED,
        data: {
          taskId: event.taskId,
          status: event.status,
          result: event.result,
        },
      }];
    case 'subagent_progress':
    case 'mcp_connect':
    case 'mcp_tool_call':
      return [];
    default:
      return [];
  }
}

function terminalEvent(
  terminal: NonNullable<AgentRunEventInput['terminal']>,
  type: AgentRunEventInput['type'],
  data: Record<string, unknown>,
  ctx: TurnToStreamContext,
): AgentRunEventInput {
  return {
    type,
    timestamp: Date.now(),
    terminal,
    data: { sessionId: ctx.sessionId, turnId: ctx.turnId, ...data },
  };
}
