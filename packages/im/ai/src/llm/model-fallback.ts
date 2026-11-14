/**
 * Purpose fallback models (#1250 chat-purpose-no-fallback).
 *
 * `provider-resilience` retries one selected model and never changes model or
 * account. This module is the layer above it: when a whole model request fails
 * with a class that another account can fix (quota exhausted, billing / no
 * credit, authentication), the request is re-issued on the next configured
 * fallback of the same purpose.
 *
 * Rules:
 * - Only `quota_exhausted`, `billing` and `auth` switch. Timeouts, 5xx, rate
 *   limits, network errors, bad requests, content refusals and context overflow
 *   keep their current behaviour (same-model retry in `provider-resilience`,
 *   then the error) and never switch: another account does not fix them, and a
 *   slow primary must not silently move traffic to a paid fallback.
 * - Switching happens per request, inside one turn, from the current transcript.
 *   A failed request produced no tool calls, so nothing is replayed: tool calls
 *   that already ran stay in the transcript as results and the fallback continues
 *   from there. A request that already streamed text to the user (or whose caller
 *   forbids a retry) never switches.
 * - A model that failed this way is skipped (per account + model, in memory)
 *   until its reset time: the provider's reset hint when it sent one, otherwise
 *   the next midnight in America/Los_Angeles for a per-day quota (Gemini's daily
 *   free-tier quotas reset then), otherwise a fixed cooldown.
 */
import type { LlmCompletionPort, StreamOptions } from "./llm-api-runtime.js";
import type { Model } from "./types/model.js";
import type { Context } from "./types/context.js";
import type { AssistantMessage } from "./types/agent-message.js";
import {
  ProviderRequestError,
  classifyProviderError,
  type ProviderErrorClassification,
} from "./provider-resilience.js";

/** Failure classes another account / model can fix; the only ones that switch. */
export type ModelFallbackReason = "quota_exhausted" | "billing" | "auth";

/** User-visible note for a turn answered by a fallback model. */
export const MODEL_FALLBACK_NOTICE = "本轮由备用模型回答";

/** Cooldown for a non-daily quota without a provider reset hint. */
export const QUOTA_FALLBACK_COOLDOWN_MS = 60 * 60_000;
/** Cooldown for an account out of credit; credit is added by a person, not a clock. */
export const BILLING_FALLBACK_COOLDOWN_MS = 60 * 60_000;
/** Cooldown for an authentication failure; a fixed key is picked up after this. */
export const AUTH_FALLBACK_COOLDOWN_MS = 15 * 60_000;
/** Provider reset hints longer than this are capped (a broken header must not park a model for weeks). */
export const MAX_FALLBACK_SKIP_MS = 48 * 60 * 60_000;

const SWITCHING_KINDS = new Set<string>(["quota_exhausted", "billing", "auth"]);

/** The switching class of a failed request, or `undefined` when it must not switch. */
export function modelFallbackFailure(
  error: unknown
):
  | (ProviderErrorClassification & { readonly kind: ModelFallbackReason })
  | undefined {
  const classification =
    error instanceof ProviderRequestError
      ? { ...classifyProviderError(error.cause), kind: error.kind }
      : classifyProviderError(error);
  return SWITCHING_KINDS.has(classification.kind)
    ? (classification as ProviderErrorClassification & {
        readonly kind: ModelFallbackReason;
      })
    : undefined;
}

const PACIFIC = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Wall-clock fields of `at` in America/Los_Angeles, as if they were UTC. */
function pacificWallClock(at: number): number {
  const parts = Object.fromEntries(
    PACIFIC.formatToParts(new Date(at)).map((part) => [part.type, part.value])
  );
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
}

/** The next 00:00 in America/Los_Angeles after `now` (DST aware). */
export function nextPacificMidnight(now: number): number {
  const wall = new Date(pacificWallClock(now));
  const midnightWall = Date.UTC(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate() + 1
  );
  // Offset (wall - utc) at the target instant; one refinement covers a DST change in between.
  let candidate = midnightWall - (pacificWallClock(now) - now);
  candidate = midnightWall - (pacificWallClock(candidate) - candidate);
  return candidate;
}

/** When a model that failed with `failure` may be tried again. */
export function modelFallbackResetAt(
  failure: Pick<ProviderErrorClassification, "kind" | "retryAfterMs" | "quotaWindow">,
  now: number
): number {
  if (failure.retryAfterMs !== undefined && failure.retryAfterMs > 0 && failure.quotaWindow !== "day") {
    return now + Math.min(failure.retryAfterMs, MAX_FALLBACK_SKIP_MS);
  }
  if (failure.kind === "quota_exhausted") {
    if (failure.quotaWindow === "day") {
      // A per-day hint (Groq's rolling window) is honoured; Gemini's `retryDelay` is not
      // meaningful for a daily quota, which resets at Pacific midnight.
      return failure.retryAfterMs !== undefined && failure.retryAfterMs > 0
        ? Math.min(now + failure.retryAfterMs, nextPacificMidnight(now))
        : nextPacificMidnight(now);
    }
    return now + QUOTA_FALLBACK_COOLDOWN_MS;
  }
  return now + (failure.kind === "billing" ? BILLING_FALLBACK_COOLDOWN_MS : AUTH_FALLBACK_COOLDOWN_MS);
}

/** One account + model that is skipped until `until` (epoch ms). */
export interface ModelUnavailability {
  readonly accountId: string;
  readonly model: string;
  readonly reason: ModelFallbackReason;
  /** Epoch ms when it was marked. */
  readonly since: number;
  /** Epoch ms when it may be tried again. */
  readonly until: number;
}

export interface ModelFallbackEndpoint {
  readonly profileId: string;
  readonly accountId: string;
  readonly model: string;
}

/** One switch to a fallback model; `phase: 'selection'` = the primary was already being skipped. */
export interface ModelFallbackEvent {
  readonly purpose: string;
  readonly from: ModelFallbackEndpoint;
  readonly to: ModelFallbackEndpoint;
  readonly reason: ModelFallbackReason;
  readonly phase: "selection" | "request";
  /** Epoch ms. */
  readonly at: number;
  /** When `from` may be tried again (epoch ms). */
  readonly fromUntil?: number;
  readonly notice: typeof MODEL_FALLBACK_NOTICE;
}

/**
 * In-memory skip state per account + model, with expiry, plus a short log of
 * recent switches. Not persisted: a restart tries every model again once.
 */
export class ModelAvailabilityRegistry {
  readonly #entries = new Map<string, ModelUnavailability>();
  readonly #recent: ModelFallbackEvent[] = [];
  readonly #now: () => number;
  readonly #recentLimit: number;

  constructor(options: Readonly<{ now?: () => number; recentLimit?: number }> = {}) {
    this.#now = options.now ?? Date.now;
    this.#recentLimit = Math.max(1, options.recentLimit ?? 20);
  }

  now(): number {
    return this.#now();
  }

  markUnavailable(input: Readonly<{ accountId: string; model: string; reason: ModelFallbackReason; until: number }>): ModelUnavailability {
    const since = this.#now();
    const key = JSON.stringify([input.accountId, input.model]);
    const previous = this.#entries.get(key);
    const entry = Object.freeze({
      accountId: input.accountId,
      model: input.model,
      reason: input.reason,
      since,
      until: Math.max(input.until, previous && previous.until > since ? previous.until : 0),
    });
    this.#entries.set(key, entry);
    return entry;
  }

  /** The active skip of this account + model, if any. */
  unavailable(accountId: string, model: string): ModelUnavailability | undefined {
    const key = JSON.stringify([accountId, model]);
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.until <= this.#now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry;
  }

  /** Active skips, soonest reset first. */
  list(): readonly ModelUnavailability[] {
    const now = this.#now();
    for (const [key, entry] of this.#entries) if (entry.until <= now) this.#entries.delete(key);
    return Object.freeze([...this.#entries.values()].sort((a, b) => a.until - b.until));
  }

  recordFallback(event: ModelFallbackEvent): void {
    this.#recent.push(event);
    if (this.#recent.length > this.#recentLimit) this.#recent.splice(0, this.#recent.length - this.#recentLimit);
  }

  /** Recent switches, newest first. */
  recentFallbacks(): readonly ModelFallbackEvent[] {
    return Object.freeze([...this.#recent].reverse());
  }

  clear(): void {
    this.#entries.clear();
    this.#recent.length = 0;
  }
}

/** Process-wide skip state shared by every purpose and generation. */
export const modelAvailability = new ModelAvailabilityRegistry();

/** One resolved purpose candidate: the selected model and its completion port. */
export interface ModelFallbackTarget {
  readonly endpoint: ModelFallbackEndpoint;
  readonly model: Model;
  readonly completion: LlmCompletionPort;
}

/** A configured fallback, resolved (and validated) only when it is about to be used. */
export interface ModelFallbackCandidate {
  readonly endpoint: ModelFallbackEndpoint;
  resolve(): Promise<Omit<ModelFallbackTarget, "endpoint">>;
}

export interface FallbackCompletionOptions {
  readonly purpose: string;
  /** The model the caller selected; calls must pass this model. */
  readonly primary: ModelFallbackTarget;
  /** Ordered fallbacks after `primary`. */
  readonly fallbacks: readonly ModelFallbackCandidate[];
  readonly registry?: ModelAvailabilityRegistry;
  readonly onFallback?: (event: ModelFallbackEvent) => void;
  /** A fallback that cannot be resolved is skipped; this only reports it. */
  readonly onCandidateError?: (endpoint: ModelFallbackEndpoint, error: unknown) => void;
}

function sameModel(a: Model, b: Model): boolean {
  return a === b || (a.id === b.id && a.provider === b.provider && a.api === b.api);
}

/**
 * A completion port over one purpose's ordered candidates. It sits below
 * `provider-resilience` (which still retries each model) and switches only on
 * {@link ModelFallbackReason}. Once switched it stays on the fallback for the
 * rest of the operation.
 */
export function createFallbackCompletionPort(options: FallbackCompletionOptions): LlmCompletionPort {
  if (options.fallbacks.length === 0) return options.primary.completion;
  const registry = options.registry ?? modelAvailability;
  let active: ModelFallbackTarget = options.primary;
  let next = 0;

  const report = (event: ModelFallbackEvent) => {
    registry.recordFallback(event);
    try {
      options.onFallback?.(event);
    } catch {
      /* Diagnostics never change the answer. */
    }
  };

  /** The next configured candidate not currently skipped, resolved; `undefined` when none is left. */
  const advance = async (): Promise<ModelFallbackTarget | undefined> => {
    while (next < options.fallbacks.length) {
      const candidate = options.fallbacks[next++]!;
      if (registry.unavailable(candidate.endpoint.accountId, candidate.endpoint.model)) continue;
      try {
        return { endpoint: candidate.endpoint, ...(await candidate.resolve()) };
      } catch (error) {
        try {
          options.onCandidateError?.(candidate.endpoint, error);
        } catch {
          /* Diagnostic only. */
        }
      }
    }
    return undefined;
  };

  const run =
    (method: keyof LlmCompletionPort) =>
    async (model: Model, context: Context, streamOptions?: StreamOptions): Promise<AssistantMessage> => {
      // A model other than the selected one is the caller's error; the selected port reports it.
      if (!sameModel(model, options.primary.model)) return options.primary.completion[method](model, context, streamOptions);
      while (true) {
        const current = active;
        let streamed = false;
        const onTextDelta = streamOptions?.onTextDelta;
        try {
          return await current.completion[method](current.model, context, {
            ...streamOptions,
            ...(onTextDelta
              ? {
                  onTextDelta: (text: string) => {
                    if (text) streamed = true;
                    onTextDelta(text);
                  },
                }
              : {}),
          });
        } catch (error) {
          if (streamOptions?.signal?.aborted) throw error;
          const failure = modelFallbackFailure(error);
          if (!failure) throw error;
          const now = registry.now();
          const skipped = registry.markUnavailable({
            accountId: current.endpoint.accountId,
            model: current.endpoint.model,
            reason: failure.kind,
            until: modelFallbackResetAt(failure, now),
          });
          // Text already reached the user, or the caller forbids another attempt: no switch.
          if (streamed || streamOptions?.retryAllowed?.() === false) throw error;
          const target = await advance();
          if (!target) throw error;
          active = target;
          report(
            Object.freeze({
              purpose: options.purpose,
              from: current.endpoint,
              to: target.endpoint,
              reason: failure.kind,
              phase: "request",
              at: now,
              fromUntil: skipped.until,
              notice: MODEL_FALLBACK_NOTICE,
            })
          );
        }
      }
    };

  return Object.freeze({ complete: run("complete"), completeSimple: run("completeSimple") });
}
