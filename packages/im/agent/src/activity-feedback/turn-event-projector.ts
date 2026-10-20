import type { TurnEvent } from '../event/turn-event.js';
import type { AIEventName, AIEventPayload } from '../ai-event-subscriber.js';

export interface TurnActivityProjectorOptions {
  readonly payload: AIEventPayload;
  readonly publish: (event: AIEventName, payload: AIEventPayload) => void;
  readonly thinkingPreview: boolean;
  readonly thinkingMaxLength: number;
}

/** Projects canonical TurnEvents into the shared IM activity lifecycle. */
export function createTurnActivityProjector(options: TurnActivityProjectorOptions):
(event: TurnEvent) => void {
  let thinkingSent = false;
  let accumulatedThinking = '';
  return (event) => {
    const payload = options.payload;
    if (event.type === 'tool_call') {
      options.publish('ai.tool.call', {
        ...payload,
        toolName: event.toolName,
        args: event.args,
      });
      return;
    }
    if (event.type === 'tool_result') {
      options.publish('ai.tool.result', {
        ...payload,
        toolName: event.toolName,
        result: event.output,
        status: 'ok',
      });
      return;
    }
    if (
      event.type === 'tool_failed'
      || event.type === 'tool_denied'
      || event.type === 'tool_cancelled'
    ) {
      options.publish('ai.tool.result', {
        ...payload,
        toolName: event.toolName,
        error: event.type === 'tool_failed' ? event.error : event.reason,
        status: 'error',
      });
      return;
    }
    if (event.type === 'iteration_start' && event.iteration > 1) {
      options.publish('ai.processing.start', {
        ...payload,
        iterations: event.iteration,
        content: `处理中 [${event.iteration}/${event.maxIterations}]...`,
      });
      return;
    }
    if (event.type !== 'thinking' || !event.text) return;
    accumulatedThinking += event.text;
    if (options.thinkingPreview) {
      const preview = accumulatedThinking.length > options.thinkingMaxLength
        ? accumulatedThinking.slice(0, options.thinkingMaxLength) + '...'
        : accumulatedThinking;
      options.publish('ai.thinking', { ...payload, thinking: preview });
    } else if (!thinkingSent) {
      thinkingSent = true;
      options.publish('ai.thinking', { ...payload, thinking: event.text });
    }
  };
}
