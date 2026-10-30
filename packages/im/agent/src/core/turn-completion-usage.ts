import { randomUUID } from 'node:crypto';
import { EMPTY_TOKEN_USAGE, type AssistantMessage, type LlmCompletionPort, type TokenUsage, type Usage, type LlmRequestObservation } from '@zhin.js/ai';

import type { UsageEvent } from '../event/turn-event.js';
import { turnUsageEvent } from './turn-event-mapper.js';
import { noteTurnTrace } from '../trace/turn-trace-registry.js';

/**
 * Counts completed provider responses before reply validation, including rejected replies.
 * Each completion is one semantic request. Framework retries/fallbacks invoke it again;
 * the SDK may retry the same input internally, which does not create another request.
 */
export function trackTurnCompletionUsage(
  delegate: LlmCompletionPort,
  project?: (message: AssistantMessage, signal?: AbortSignal) => Promise<AssistantMessage>,
  trace?: Readonly<{ turnId?: string; recordBodies?: boolean }>,
): {
  transport: LlmCompletionPort;
  /** Alternate purpose transport sharing this turn's accounting and trace. */
  forTransport(delegate: LlmCompletionPort): LlmCompletionPort;
  readonly usage: TokenUsage;
  drainEvents(): UsageEvent[];
  hasReported(message: object): boolean;
  recordMediaUsage(usage: Usage, provider?: string, model?: string): void;
} {
  const total: TokenUsage = { ...EMPTY_TOKEN_USAGE, cost: { ...EMPTY_TOKEN_USAGE.cost } };
  const pending: UsageEvent[] = [];
  const reported = new WeakSet<object>();
  const record = (assistant: AssistantMessage, durationMs: number, requestId: string): AssistantMessage => {
    const usage = assistant.usage;
    pending.push(turnUsageEvent(usage, {
      provider: assistant.provider, model: assistant.model, stopReason: assistant.stopReason, durationMs, requestId,
    }));
    reported.add(assistant);
    total.input += usage.input;
    total.output += usage.output;
    total.cacheRead += usage.cacheRead;
    total.cacheWrite += usage.cacheWrite;
    total.totalTokens += usage.totalTokens;
    if (usage.reasoning !== undefined) total.reasoning = (total.reasoning ?? 0) + usage.reasoning;
    total.cost.input += usage.cost.input;
    total.cost.output += usage.cost.output;
    total.cost.cacheRead += usage.cost.cacheRead;
    total.cost.cacheWrite += usage.cost.cacheWrite;
    total.cost.total += usage.cost.total;
    return assistant;
  };
  const projectRecorded = async (assistant: AssistantMessage, signal?: AbortSignal): Promise<AssistantMessage> => {
    const result = project ? await project(assistant, signal) : assistant;
    reported.add(result);
    return result;
  };
  const complete = (method: keyof LlmCompletionPort, target: LlmCompletionPort): LlmCompletionPort['complete'] => async (model, context, options) => {
    const requestId = randomUUID();
    const started = performance.now();
    const request = { request_id: requestId, provider: model.provider, model: model.id, started_at: Date.now(), status: 'running' as const };
    const recordBody = trace?.recordBodies !== false;
    noteTurnTrace(trace?.turnId, { kind: 'model_request', request: {
      ...request, body_status: recordBody ? 'unsupported' : 'disabled',
    } });
    const onRequest = (observation: LlmRequestObservation) => {
      if (recordBody) noteTurnTrace(trace?.turnId, { kind: 'model_request', request: {
        ...request,
        body_status: observation.status === 'captured' ? 'recorded' : 'capture_failed',
        ...(observation.status === 'captured' ? { body: observation.input } : {}),
      } });
      try { void Promise.resolve(options?.onRequest?.(observation)).catch(() => undefined); } catch { /* Diagnostic observer only. */ }
    };
    let assistant: AssistantMessage;
    try {
      assistant = await target[method](model, context, {
        ...options,
        ...((recordBody && trace?.turnId) || options?.onRequest ? { onRequest } : {}),
      });
    } catch (error) {
      noteTurnTrace(trace?.turnId, { kind: 'model_request_end', request_id: requestId,
        status: options?.signal?.aborted ? 'cancelled' : 'failed', duration_ms: performance.now() - started });
      throw error;
    }
    const durationMs = performance.now() - started;
    noteTurnTrace(trace?.turnId, { kind: 'model_request_end', request_id: requestId,
      status: assistant.stopReason === 'aborted' ? 'cancelled' : assistant.stopReason === 'error' ? 'failed' : 'completed',
      duration_ms: durationMs, stop_reason: assistant.stopReason });
    return projectRecorded(record(assistant, durationMs, requestId), options?.signal);
  };
  const forTransport = (target: LlmCompletionPort): LlmCompletionPort => ({
    complete: complete('complete', target),
    completeSimple: complete('completeSimple', target),
  });
  return {
    transport: forTransport(delegate),
    forTransport,
    get usage() { return { ...total, cost: { ...total.cost } }; },
    drainEvents: () => pending.splice(0),
    hasReported: assistant => reported.has(assistant),
    recordMediaUsage: (usage, provider, model) => {
      const tokens: TokenUsage = { input: usage.prompt_tokens, output: usage.completion_tokens,
        totalTokens: usage.total_tokens, cacheRead: 0, cacheWrite: 0, cost: { ...EMPTY_TOKEN_USAGE.cost } };
      total.input += tokens.input;
      total.output += tokens.output;
      total.totalTokens += tokens.totalTokens;
      pending.push(turnUsageEvent(tokens, { provider: provider ?? 'media-perception', model: model ?? 'unknown', stopReason: 'stop' }));
    },
  };
}
