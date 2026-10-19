import { EMPTY_TOKEN_USAGE, type AssistantMessage, type LlmCompletionPort, type TokenUsage } from '@zhin.js/ai';

/** Counts completed provider responses before reply validation, including rejected replies and retries. */
export function trackTurnCompletionUsage(delegate: LlmCompletionPort): {
  transport: LlmCompletionPort;
  readonly usage: TokenUsage;
  drainUsage(): TokenUsage[];
  hasReported(message: object): boolean;
} {
  const total: TokenUsage = { ...EMPTY_TOKEN_USAGE, cost: { ...EMPTY_TOKEN_USAGE.cost } };
  const pending: TokenUsage[] = [];
  const reported = new WeakSet<object>();
  const record = (assistant: AssistantMessage): AssistantMessage => {
    const usage = assistant.usage;
    pending.push({ ...usage, cost: { ...usage.cost } });
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
  return {
    transport: {
      complete: async (model, context, options) => record(await delegate.complete(model, context, options)),
      completeSimple: async (model, context, options) => record(await delegate.completeSimple(model, context, options)),
    },
    get usage() { return { ...total, cost: { ...total.cost } }; },
    drainUsage: () => pending.splice(0),
    hasReported: assistant => reported.has(assistant),
  };
}
