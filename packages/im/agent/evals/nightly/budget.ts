/**
 * Hard spending caps for the nightly real-model tier. Every request goes
 * through a {@link BudgetedCompletionPort}; once a cap is reached the next
 * request throws {@link BudgetExceededError} and the runner records the rest
 * of the matrix as `skipped` instead of spending more.
 */
import type { AssistantMessage, Context, LlmCompletionPort, Model, StreamOptions } from '@zhin.js/ai';

export interface NightlyBudget {
  /** Total model requests across the whole run (all models, cases, runs, judge calls). */
  readonly maxRequests: number;
  /** Total tokens (input + output) across the whole run. */
  readonly maxTotalTokens: number;
  /** Output-token cap per request. */
  readonly maxOutputTokens: number;
  /** Repetitions of each case per model, for a pass rate instead of a coin flip. */
  readonly runsPerCase: number;
  /** Wall-clock cap per request, in ms. */
  readonly requestTimeoutMs: number;
}

/**
 * Conservative defaults for one model at 3 runs per case: the 5 matrix cases
 * are 15 requests (~61k tokens with the long-context case; the multimodal
 * fixture is a 64x64 PNG, a few hundred tokens); the 7 live seed
 * cases are 2–3 harness requests each, ~50 requests and ~300k tokens (the full
 * agent system prompt rides on every request). The caps leave a little
 * headroom; anything past them is recorded as skipped, never spent.
 */
export const DEFAULT_NIGHTLY_BUDGET: Readonly<NightlyBudget> = Object.freeze({
  maxRequests: 120,
  maxTotalTokens: 600_000,
  maxOutputTokens: 1_024,
  runsPerCase: 3,
  requestTimeoutMs: 120_000,
});

export class BudgetExceededError extends Error {
  constructor(readonly limit: 'requests' | 'tokens', readonly used: number, readonly max: number) {
    super(`nightly budget exceeded: ${limit} ${used}/${max}`);
    this.name = 'BudgetExceededError';
  }
}

export interface BudgetUsage {
  readonly requests: number;
  readonly totalTokens: number;
}

/** Parse a positive integer override (e.g. from an env var); falls back on anything else. */
export function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveNightlyBudget(env: Readonly<Record<string, string | undefined>>): NightlyBudget {
  const d = DEFAULT_NIGHTLY_BUDGET;
  return {
    maxRequests: positiveInt(env.NIGHTLY_MAX_REQUESTS, d.maxRequests),
    maxTotalTokens: positiveInt(env.NIGHTLY_MAX_TOKENS, d.maxTotalTokens),
    maxOutputTokens: positiveInt(env.NIGHTLY_MAX_OUTPUT_TOKENS, d.maxOutputTokens),
    runsPerCase: positiveInt(env.NIGHTLY_RUNS_PER_CASE, d.runsPerCase),
    requestTimeoutMs: positiveInt(env.NIGHTLY_REQUEST_TIMEOUT_MS, d.requestTimeoutMs),
  };
}

export class BudgetedCompletionPort implements LlmCompletionPort {
  #requests = 0;
  #tokens = 0;

  constructor(
    private readonly base: LlmCompletionPort,
    private readonly budget: NightlyBudget,
  ) {}

  usage(): BudgetUsage {
    return { requests: this.#requests, totalTokens: this.#tokens };
  }

  complete(model: Model, context: Context, options?: StreamOptions): Promise<AssistantMessage> {
    return this.#run(() => this.base.complete(model, context, this.#options(options)));
  }

  completeSimple(model: Model, context: Context, options?: StreamOptions): Promise<AssistantMessage> {
    return this.#run(() => this.base.completeSimple(model, context, this.#options(options)));
  }

  #options(options: StreamOptions | undefined): StreamOptions {
    const signal = AbortSignal.timeout(this.budget.requestTimeoutMs);
    return {
      ...options,
      maxTokens: Math.min(options?.maxTokens ?? this.budget.maxOutputTokens, this.budget.maxOutputTokens),
      signal: options?.signal ? AbortSignal.any([options.signal, signal]) : signal,
    };
  }

  async #run(call: () => Promise<AssistantMessage>): Promise<AssistantMessage> {
    if (this.#requests >= this.budget.maxRequests) {
      throw new BudgetExceededError('requests', this.#requests, this.budget.maxRequests);
    }
    if (this.#tokens >= this.budget.maxTotalTokens) {
      throw new BudgetExceededError('tokens', this.#tokens, this.budget.maxTotalTokens);
    }
    this.#requests += 1;
    const message = await call();
    this.#tokens += message.usage?.totalTokens || (message.usage?.input ?? 0) + (message.usage?.output ?? 0);
    return message;
  }
}
