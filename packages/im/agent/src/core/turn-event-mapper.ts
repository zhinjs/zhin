/**
 * Maps @zhin.js/ai agentLoop AgentEvent stream to TurnEvent union.
 */
import type { AgentEvent, AssistantMessage } from '@zhin.js/ai';
import type { TurnEvent } from '../event/turn-event.js';

export interface TurnEventMapperState {
  accumulatedText: string;
  accumulatedThinking: string;
  toolStartTimes: Map<string, number>;
  iteration: number;
  maxIterations: number;
}

export function createTurnEventMapperState(maxIterations = 15): TurnEventMapperState {
  return { accumulatedText: '', accumulatedThinking: '', toolStartTimes: new Map(), iteration: 0, maxIterations };
}

export function* mapAgentEventToTurnEvents(
  event: AgentEvent,
  state: TurnEventMapperState,
): Generator<TurnEvent> {
  switch (event.type) {
    case 'turn_start':
      state.iteration += 1;
      state.accumulatedText = '';
      state.accumulatedThinking = '';
      yield {
        type: 'iteration_start',
        iteration: state.iteration,
        maxIterations: state.maxIterations,
      };
      break;
    case 'message_end':
      if (event.message.role === 'assistant') {
        const usage = (event.message as AssistantMessage).usage;
        yield {
          type: 'usage',
          usage: {
            promptTokens: usage.input,
            completionTokens: usage.output,
            totalTokens: usage.totalTokens,
          },
        };
      }
      break;
    case 'message_update':
      if (event.delta?.type === 'text_delta') {
        state.accumulatedText += event.delta.text;
        yield {
          type: 'chunk',
          text: event.delta.text,
          accumulated: state.accumulatedText,
        };
      } else if (event.delta?.type === 'thinking_delta') {
        state.accumulatedThinking += event.delta.thinking;
        yield { type: 'thinking', text: event.delta.thinking };
      }
      break;
    case 'tool_execution_start':
      state.toolStartTimes.set(event.toolCallId, performance.now());
      yield {
        type: 'tool_call',
        toolName: event.toolCall.name,
        args: (event.toolCall.arguments ?? {}) as Record<string, unknown>,
        toolUseId: event.toolCallId,
      };
      break;
    case 'tool_execution_end': {
      const started = state.toolStartTimes.get(event.toolCallId);
      const durationMs = started != null ? performance.now() - started : 0;
      state.toolStartTimes.delete(event.toolCallId);
      const toolName =
        event.result.role === 'toolResult'
          ? String(event.result.toolName ?? 'unknown')
          : 'unknown';
      const output =
        event.result.role === 'toolResult' && Array.isArray(event.result.content)
          ? event.result.content
              .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
              .map((b) => b.text)
              .join('')
          : '';
      yield {
        type: 'tool_result',
        toolName,
        output,
        durationMs,
        toolUseId: event.toolCallId,
      };
      break;
    }
    default:
      break;
  }
}
