import { EMPTY_TOKEN_USAGE, type AssistantMessage, type LlmCompletionPort, type TokenUsage, type Usage } from '@zhin.js/ai';

import type { UsageEvent } from '../event/turn-event.js';
import { turnUsageEvent } from './turn-event-mapper.js';

/** Counts completed provider responses before reply validation, including rejected replies and retries. */
export function trackTurnCompletionUsage(
  delegate: LlmCompletionPort,
  project?: (message: AssistantMessage, signal?: AbortSignal) => Promise<AssistantMessage>,
): {
  transport: LlmCompletionPort;
  readonly usage: TokenUsage;
  drainEvents(): UsageEvent[];
  hasReported(message: object): boolean;
  recordMediaUsage(usage: Usage, provider?: string, model?: string): void;
} {
  const total: TokenUsage = { ...EMPTY_TOKEN_USAGE, cost: { ...EMPTY_TOKEN_USAGE.cost } };
  const pending: UsageEvent[] = [];
  const reported = new WeakSet<object>();
  const record = (assistant: AssistantMessage, durationMs: number): AssistantMessage => {
    const usage = assistant.usage;
    pending.push(turnUsageEvent(usage, {
      provider: assistant.provider, model: assistant.model, stopReason: assistant.stopReason, durationMs,
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
  return {
    transport: {
      complete: async (model, context, options) => {
        const started = performance.now();
        return projectRecorded(record(await delegate.complete(model, context, options), performance.now() - started), options?.signal);
      },
      completeSimple: async (model, context, options) => {
        const started = performance.now();
        return projectRecorded(record(await delegate.completeSimple(model, context, options), performance.now() - started), options?.signal);
      },
    },
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
