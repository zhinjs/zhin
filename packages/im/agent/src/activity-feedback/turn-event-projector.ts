import { inheritActivityFeedbackSource } from './operation-source.js';
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
  const publish = (event: AIEventName, payload: AIEventPayload) =>
    options.publish(event, inheritActivityFeedbackSource(payload, options.payload));
  let thinkingSent = false;
  let accumulatedThinking = '';
  return (event) => {
    const payload = options.payload;
    if (event.type === 'tool_call') {
      publish('ai.tool.call', {
        ...payload,
        toolName: event.toolName,
        args: event.args,
      });
      return;
    }
    if (event.type === 'tool_result') {
      publish('ai.tool.result', {
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
      publish('ai.tool.result', {
        ...payload,
        toolName: event.toolName,
        error: event.type === 'tool_failed' ? event.error : event.reason,
        status: 'error',
      });
      return;
    }
    if (event.type === 'iteration_start' && event.iteration > 1) {
      // Base content is the user's input, not authored progress text. Keep it out of
      // this projected event while leaving explicit content on other events intact.
      const { content: _inputContent, ...context } = payload;
      publish('ai.processing.start', {
        ...context,
        iterations: event.iteration,
        ...(event.maxIterations !== undefined ? { iterationProgress: { current: event.iteration, total: event.maxIterations } } : {}),
      });
      return;
    }
    if (event.type !== 'thinking' || !event.text) return;
    accumulatedThinking += event.text;
    if (options.thinkingPreview) {
      const preview = accumulatedThinking.length > options.thinkingMaxLength
        ? accumulatedThinking.slice(0, options.thinkingMaxLength) + '...'
        : accumulatedThinking;
      publish('ai.thinking', { ...payload, thinking: preview });
    } else if (!thinkingSent) {
      thinkingSent = true;
      publish('ai.thinking', { ...payload, thinking: event.text });
    }
  };
}
