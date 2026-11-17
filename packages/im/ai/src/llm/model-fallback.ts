/**
 * Purpose fallback models (#1250 chat-purpose-no-fallback, #1270).
 *
 * `provider-resilience` retries one selected model and never changes model or
 * account. This module is the layer below it (it wraps the selected model's
 * transport): when a whole model request fails with a class that another
 * account can fix, the request is re-issued on the next configured fallback of
 * the same purpose.
 *
 * Rules:
 * - Switching classes: `quota_exhausted`, `billing`, and `auth` only when the
 *   credential itself was rejected (401, `UNAUTHENTICATED`, `API_KEY_*`-style
 *   codes). A plain 403 (often a gateway's content or region refusal) does not
 *   switch and does not mark the model.
 * - Timeouts of the provider attempt (the resilience per-attempt timer, first-response /
 *   first-chunk deadlines: anything `classifyProviderError` calls `timeout`, and the
 *   first-response deadline it calls `no_response`, but never a caller-supplied signal's
 *   `TimeoutError`) switch only after
 *   {@link CONSECUTIVE_TIMEOUTS_TO_SWITCH} consecutive timeouts of the same account +
 *   model within one operation; the next attempt then goes to the fallback. That switch
 *   is operation-local: one user's huge prompt must not move everyone to a paid
 *   fallback. Only when operations of {@link TIMEOUT_GLOBAL_OPERATIONS} distinct
 *   operations reach that threshold within {@link TIMEOUT_GLOBAL_WINDOW_MS} is the model
 *   skipped globally ({@link TIMEOUT_FALLBACK_COOLDOWN_MS}). A one-off timeout behaves
 *   as before (same-model retry).
 * - Network errors and 5xx (#1250 fallback-skips-network-and-5xx) switch once the selected
 *   model's same-model retries are used up (the request `provider-resilience` would give up on,
 *   see `StreamOptions.willRetry`); a fallback in use switches when its own retries are used up.
 *   Like timeouts the switch is operation-local; the model is skipped globally
 *   ({@link TRANSIENT_FALLBACK_COOLDOWN_MS}) only when {@link TIMEOUT_GLOBAL_OPERATIONS} distinct
 *   operations gave up on it within {@link TIMEOUT_GLOBAL_WINDOW_MS}.
 * - Rate limits, bad requests, content refusals and context overflow never switch.
 * - A failure that is not switched is reported (`onFallbackSkipped`) with why: no fallback is
 *   configured, the failure class does not switch, or every fallback was tried / passed over.
 * - Switching happens per request, from the current transcript. A failed
 *   request produced no tool calls, so nothing is replayed: executed tool calls
 *   stay in the transcript as results. A request that already streamed text to
 *   the user (or whose caller forbids another attempt) never switches.
 * - A fallback is used only when it can serve the request: its declared input
 *   modalities cover the transcript's media, the estimated context fits its
 *   `contextWindow`, and the transcript satisfies its tool-loop protocol
 *   (Anthropic thinking needs signed thinking on the open tool loop, otherwise
 *   thinking is turned off for that request; Gemini needs `thoughtSignature`
 *   and Mistral 9-character tool ids, otherwise the fallback is skipped).
 * - A switched request runs with the fallback's own `maxTokens` and execution
 *   policy (same-model retries, per-attempt timeout).
 * - A model that failed this way is skipped (per account + model, in memory)
 *   until its reset time: the provider's reset hint when it sent one, otherwise
 *   the next midnight in America/Los_Angeles for a per-day quota, otherwise a
 *   fixed cooldown.
 */
import type { LlmCompletionPort, StreamOptions } from "./llm-api-runtime.js";
import type { Model, ModelInputModality } from "./types/model.js";
import type { Context } from "./types/context.js";
import type { AgentMessage, AssistantMessage } from "./types/agent-message.js";
import type { ContentBlock } from "./types/content-block.js";
import {
  ProviderRequestError,
  classifyProviderError,
  createResilientCompletionPort,
  resolveProviderResilienceConfig,
  type ProviderErrorClassification,
} from "./provider-resilience.js";
import { estimateAgentMessagesTokens } from "../compaction/agent-message-tokens.js";
import { estimateTextTokens } from "../compaction/token-counter.js";

/** Failure classes that switch to the next fallback. */
/** `context_overflow`: a fallback in use no longer fits the growing context, so the next one takes over. */
/** `network` / `server`: the selected model's same-model retries were used up (#1250 fallback-skips-network-and-5xx). */
export type ModelFallbackReason = "quota_exhausted" | "billing" | "auth" | "timeout" | "network" | "server" | "context_overflow";

/** User-visible note for a turn answered by a fallback model. */
export const MODEL_FALLBACK_NOTICE = "本轮由备用模型回答";

/** Cooldown for a non-daily quota without a provider reset hint. */
export const QUOTA_FALLBACK_COOLDOWN_MS = 60 * 60_000;
/** Cooldown for an account out of credit; credit is added by a person, not a clock. */
export const BILLING_FALLBACK_COOLDOWN_MS = 60 * 60_000;
/** Cooldown for a rejected credential; a fixed key is picked up after this. */
export const AUTH_FALLBACK_COOLDOWN_MS = 15 * 60_000;
/** Cooldown after repeated timeouts: short, a slow model usually recovers soon. */
export const TIMEOUT_FALLBACK_COOLDOWN_MS = 5 * 60_000;
/** Cooldown after several operations gave up on a model for network errors / 5xx (same as timeouts). */
export const TRANSIENT_FALLBACK_COOLDOWN_MS = TIMEOUT_FALLBACK_COOLDOWN_MS;
/** Consecutive timeouts of one account + model within one operation before the next attempt switches (#1270). */
export const CONSECUTIVE_TIMEOUTS_TO_SWITCH = 2;
/** Distinct operations that must hit the timeout threshold before a model is skipped globally. */
export const TIMEOUT_GLOBAL_OPERATIONS = 2;
/** Window in which those operations must fall. */
export const TIMEOUT_GLOBAL_WINDOW_MS = 2 * 60_000;
/** Provider reset hints longer than this are capped (a broken header must not park a model for weeks). */
export const MAX_FALLBACK_SKIP_MS = 48 * 60 * 60_000;

function classify(error: unknown): ProviderErrorClassification {
  return error instanceof ProviderRequestError
    ? { ...classifyProviderError(error.cause), kind: error.kind }
    : classifyProviderError(error);
}

/**
 * The switching class of a failed request, or `undefined` when it does not switch
 * by itself (timeouts switch only when repeated, see {@link createFallbackCompletionPort}).
 */
export function modelFallbackFailure(
  error: unknown
):
  | (ProviderErrorClassification & { readonly kind: Exclude<ModelFallbackReason, "timeout"> })
  | undefined {
  const classification = classify(error);
  const switching = classification.kind === "quota_exhausted" || classification.kind === "billing"
    || (classification.kind === "auth" && classification.credential === true);
  return switching
    ? (classification as ProviderErrorClassification & { readonly kind: Exclude<ModelFallbackReason, "timeout"> })
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
  if (failure.kind === "timeout") return now + TIMEOUT_FALLBACK_COOLDOWN_MS;
  if (failure.kind === "network" || failure.kind === "server") return now + TRANSIENT_FALLBACK_COOLDOWN_MS;
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
  readonly #operationFailures = new Map<string, Array<{ readonly operation: object; readonly at: number }>>();
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

  /**
   * One operation hit the consecutive-timeout threshold on this account + model. Returns
   * true when {@link TIMEOUT_GLOBAL_OPERATIONS} distinct operations did so within
   * {@link TIMEOUT_GLOBAL_WINDOW_MS}: then the caller may skip the model globally.
   */
  noteOperationTimeouts(input: Readonly<{
    accountId: string;
    model: string;
    operation: object;
    /**
     * Which failure is counted; each is counted on its own. Default `timeout`; `transient` is an
     * operation that gave up on the model for network errors / 5xx (#1250 fallback-skips-network-and-5xx).
     */
    failure?: "timeout" | "transient";
  }>): boolean {
    const now = this.#now();
    const key = JSON.stringify([input.failure ?? "timeout", input.accountId, input.model]);
    const recent = (this.#operationFailures.get(key) ?? []).filter(entry => now - entry.at <= TIMEOUT_GLOBAL_WINDOW_MS);
    if (!recent.some(entry => entry.operation === input.operation)) recent.push({ operation: input.operation, at: now });
    this.#operationFailures.set(key, recent);
    if (recent.length < TIMEOUT_GLOBAL_OPERATIONS) return false;
    this.#operationFailures.delete(key);
    return true;
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
    this.#operationFailures.clear();
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

/** Why a fallback cannot serve one request; it is passed over, not marked unavailable. */
export type FallbackUnfitReason = "input" | "context_window" | "transcript";

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
  /** A fallback that cannot serve this request is skipped; this only reports it. */
  readonly onCandidateUnfit?: (endpoint: ModelFallbackEndpoint, reason: FallbackUnfitReason) => void;
  /**
   * A failed request that does not switch (#1250 fallback-skips-network-and-5xx), reported once per
   * final failure (one the same-model retries will not re-ask). `reason`: `no_fallbacks` (none
   * configured), `not_switching` (the failure class does not switch, or a single timeout),
   * `exhausted` (every fallback was used, is being skipped, or cannot serve the request),
   * `streamed` (text already reached the user), `retry_forbidden` (the caller allows no other attempt).
   */
  readonly onFallbackSkipped?: (event: Readonly<{
    purpose: string;
    /** The model whose failure was not switched. */
    from: ModelFallbackEndpoint;
    /** Classified failure (`network`, `server`, `rate_limit`, ...). */
    kind: ProviderErrorClassification["kind"];
    reason: "no_fallbacks" | "not_switching" | "exhausted" | "streamed" | "retry_forbidden";
    /** Epoch ms. */
    at: number;
  }>) => void;
  /** Reason reported when `fallbacks` is empty: `exhausted` when the selection already used them up. Default `no_fallbacks`. */
  readonly emptyFallbacksReason?: "no_fallbacks" | "exhausted";
  /** Attribute a fallback's answer (e.g. map its account id to the id usage reports use). */
  readonly annotate?: (message: AssistantMessage, endpoint: ModelFallbackEndpoint) => AssistantMessage;
}

function sameModel(a: Model, b: Model): boolean {
  return a === b || (a.id === b.id && a.provider === b.provider && a.api === b.api);
}

const MEDIA_TYPES = new Set<string>(["image", "audio", "video", "file"]);

/** Input modalities the transcript sends (media in user content, `media` and tool results). */
export function requiredInputModalities(context: Context): ReadonlySet<ModelInputModality> {
  const needed = new Set<ModelInputModality>();
  const scan = (blocks: readonly ContentBlock[] | undefined) => {
    for (const block of blocks ?? []) if (MEDIA_TYPES.has(block.type)) needed.add(block.type as ModelInputModality);
  };
  for (const message of context.messages) {
    if (message.role !== "user" && message.role !== "toolResult") continue;
    const content = (message as { content?: unknown }).content;
    if (Array.isArray(content)) scan(content as ContentBlock[]);
    scan((message as { media?: ContentBlock[] }).media);
  }
  return needed;
}

/** Estimated prompt size (messages, system prompt, tool names and descriptions); not a billing value. */
export function estimateRequestTokens(context: Context): number {
  return estimateAgentMessagesTokens(context.messages as AgentMessage[]) + estimateTextTokens(context.systemPrompt ?? "")
    + (context.tools ?? []).reduce((sum, tool) => sum + estimateTextTokens(`${tool.name} ${tool.description ?? ""}`), 0);
}

const MISTRAL_MODEL = /(?:^|[/:._-])(?:mistral|codestral|magistral|devstral|ministral|pixtral)/i;
const MISTRAL_TOOL_ID = /^[A-Za-z0-9]{9}$/;

/**
 * Whether the open tool loop (assistant tool calls after the last user message) can be sent
 * to `target` as is: `ok`; `no-thinking` (Anthropic with thinking needs signed thinking on
 * every tool-use turn, so send this request without thinking); or `skip` (Gemini needs a
 * `thoughtSignature` on tool calls, Mistral 9-character tool ids).
 */
export function fallbackTranscriptFit(target: Model, context: Context): "ok" | "no-thinking" | "skip" {
  const messages = context.messages;
  let start = messages.length;
  while (start > 0 && messages[start - 1]!.role !== "user") start--;
  const turns = messages.slice(start).filter((message): message is AssistantMessage => message.role === "assistant")
    .filter(message => message.content.some(block => block.type === "toolCall"));
  if (!turns.length) return "ok";
  const calls = turns.flatMap(message => message.content.filter(block => block.type === "toolCall"));
  if (MISTRAL_MODEL.test(target.id) && calls.some(call => !MISTRAL_TOOL_ID.test(call.id))) return "skip";
  if (target.promptFamily === "google" && calls.some(call =>
    !call.providerOptions?.google?.thoughtSignature && !call.providerOptions?.vertex?.thoughtSignature)) return "skip";
  if (target.promptFamily === "anthropic" && target.reasoning === true && turns.some(message => !message.content.some(block =>
    block.type === "thinking" && Boolean(block.providerOptions?.anthropic?.signature || block.providerOptions?.anthropic?.redactedData)))) {
    return "no-thinking";
  }
  return "ok";
}

/** Whether `target` can serve this request, and with which adjustments. */
function fitFor(target: Model, context: Context): { readonly ok: true; readonly noThinking: boolean } | { readonly ok: false; readonly reason: FallbackUnfitReason } {
  const inputs = new Set(target.input ?? ["text"]);
  for (const modality of requiredInputModalities(context)) if (!inputs.has(modality)) return { ok: false, reason: "input" };
  if (target.contextWindow > 0 && estimateRequestTokens(context) > target.contextWindow) return { ok: false, reason: "context_window" };
  const transcript = fallbackTranscriptFit(target, context);
  if (transcript === "skip") return { ok: false, reason: "transcript" };
  return { ok: true, noThinking: transcript === "no-thinking" };
}

function endpointKey(endpoint: ModelFallbackEndpoint): string {
  return JSON.stringify([endpoint.accountId, endpoint.model]);
}

interface ActiveTarget extends ModelFallbackTarget {
  /** Fallbacks run with their own execution policy; the selected model keeps the caller's. */
  readonly switched: boolean;
}

/**
 * A completion port over one purpose's ordered candidates. It sits below
 * `provider-resilience` (which still retries the selected model) and switches
 * only as described in the module comment. Once switched it stays on the
 * fallback for the rest of the operation.
 */
export function createFallbackCompletionPort(options: FallbackCompletionOptions): LlmCompletionPort {
  if (options.fallbacks.length === 0) {
    return options.onFallbackSkipped ? reportUnswitched(options) : options.primary.completion;
  }
  const registry = options.registry ?? modelAvailability;
  /** This port serves one operation; its identity counts distinct operations for global timeout skips. */
  const operation = {};
  let active: ActiveTarget = { ...options.primary, switched: false };
  let next = 0;
  const timeouts = new Map<string, number>();
  /** Set after repeated timeouts when the attempt could not continue (its signal was aborted). */
  let pending: { readonly from: ModelFallbackEndpoint; readonly until?: number } | undefined;

  const report = (event: ModelFallbackEvent) => {
    registry.recordFallback(event);
    try {
      options.onFallback?.(event);
    } catch {
      /* Diagnostics never change the answer. */
    }
  };
  const quietly = (run: () => void) => {
    try { run(); } catch { /* Diagnostic only. */ }
  };
  const skipped = (from: ModelFallbackEndpoint, kind: ProviderErrorClassification["kind"],
    reason: "not_switching" | "exhausted" | "streamed" | "retry_forbidden") => {
    quietly(() => options.onFallbackSkipped?.(Object.freeze({ purpose: options.purpose, from, kind, reason, at: registry.now() })));
  };

  /** The next configured candidate that is not skipped, resolves and can serve `context`. */
  const advance = async (context: Context): Promise<ActiveTarget | undefined> => {
    while (next < options.fallbacks.length) {
      const candidate = options.fallbacks[next++]!;
      if (registry.unavailable(candidate.endpoint.accountId, candidate.endpoint.model)) continue;
      let resolved: Omit<ModelFallbackTarget, "endpoint">;
      try {
        resolved = await candidate.resolve();
      } catch (error) {
        quietly(() => options.onCandidateError?.(candidate.endpoint, error));
        continue;
      }
      const fit = fitFor(resolved.model, context);
      if (!fit.ok) {
        quietly(() => options.onCandidateUnfit?.(candidate.endpoint, fit.reason));
        continue;
      }
      return { endpoint: candidate.endpoint, ...resolved, switched: true };
    }
    return undefined;
  };

  const switchTo = (target: ActiveTarget, from: ModelFallbackEndpoint, reason: ModelFallbackReason, at: number, until?: number) => {
    active = target;
    report(Object.freeze({ purpose: options.purpose, from, to: target.endpoint, reason, phase: "request",
      at, ...(until !== undefined ? { fromUntil: until } : {}), notice: MODEL_FALLBACK_NOTICE }));
  };

  /**
   * A fallback in use is re-checked on every request: the transcript grows, and a request that
   * no longer fits its window must not be sent (it would 400). Compaction still budgets against
   * the selected (primary) model's window; making it follow the answering fallback is a follow-up.
   */
  const ensureFits = async (context: Context): Promise<void> => {
    while (active.switched) {
      const fit = fitFor(active.model, context);
      if (fit.ok) return;
      const from = active.endpoint;
      const target = await advance(context);
      if (!target) {
        // Worded so `isContextOverflowError` / resilience classify it as `context_overflow`
        // (no retry; the agent loop compacts and asks once more).
        throw new Error(`Estimated prompt (~${estimateRequestTokens(context)} tokens) does not fit the context window of `
          + `fallback ${from.profileId} (${active.model.contextWindow} tokens) or any later fallback`);
      }
      switchTo(target, from, "context_overflow", registry.now());
    }
  };

  /** The fallback's own execution policy and output limit; thinking off when the transcript requires it. */
  const invoke = (method: keyof LlmCompletionPort, target: ActiveTarget, context: Context, streamOptions: StreamOptions | undefined) => {
    if (!target.switched) return target.completion[method](target.model, context, streamOptions);
    const fit = fitFor(target.model, context);
    const port = createResilientCompletionPort(target.completion, {
      config: resolveProviderResilienceConfig(target.model.executionPolicy),
    });
    const maxTokens = streamOptions?.maxTokens !== undefined && target.model.maxTokens > 0
      ? Math.min(streamOptions.maxTokens, target.model.maxTokens) : streamOptions?.maxTokens;
    return port[method](target.model, context, {
      ...streamOptions,
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(fit.ok && fit.noThinking ? { thinkingLevel: "off" as const } : {}),
    }).then(message => options.annotate ? options.annotate(message, target.endpoint) : message);
  };

  /**
   * Operation-local timeout / network / 5xx switch; a global skip only once several operations
   * fail the same way (see module comment).
   */
  const operationSkip = (endpoint: ModelFallbackEndpoint, reason: "timeout" | "network" | "server"): number | undefined => {
    if (!registry.noteOperationTimeouts({ accountId: endpoint.accountId, model: endpoint.model, operation,
      failure: reason === "timeout" ? "timeout" : "transient" })) return undefined;
    const now = registry.now();
    return registry.markUnavailable({ accountId: endpoint.accountId, model: endpoint.model, reason,
      until: modelFallbackResetAt({ kind: reason }, now) }).until;
  };

  const run =
    (method: keyof LlmCompletionPort) =>
    async (model: Model, context: Context, streamOptions?: StreamOptions): Promise<AssistantMessage> => {
      // A model other than the selected one is the caller's error; the selected port reports it.
      if (!sameModel(model, options.primary.model)) return options.primary.completion[method](model, context, streamOptions);
      if (pending && endpointKey(pending.from) === endpointKey(active.endpoint)) {
        const from = pending;
        pending = undefined;
        if (streamOptions?.retryAllowed?.() !== false) {
          const target = await advance(context);
          if (target) switchTo(target, from.from, "timeout", registry.now(), from.until);
        }
      }
      while (true) {
        await ensureFits(context);
        const current = active;
        let streamed = false;
        const onTextDelta = streamOptions?.onTextDelta;
        const signal = streamOptions?.signal;
        try {
          const message = await invoke(method, current, context, {
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
          timeouts.delete(endpointKey(current.endpoint));
          return message;
        } catch (error) {
          // An aborted signal is the caller cancelling (never switches), including a caller's own
          // `AbortSignal.timeout` (DOMException `TimeoutError`), or the resilience layer's
          // per-attempt timer, which is the provider attempt timing out and is counted below.
          const cause = signal?.aborted ? signal.reason : error;
          // A first-response deadline (`no_response`) is a provider-attempt timeout here: it counts
          // toward the consecutive-timeout switch like the whole-request timer.
          const classified = classify(cause).kind;
          const causeKind = countsAsTimeout(classified) ? "timeout" : classified;
          if (signal?.aborted && (causeKind !== "timeout" || isCallerTimeout(cause))) throw error;
          const failure = signal?.aborted ? undefined : modelFallbackFailure(error);
          // A fallback in use runs its own retries (see `invoke`): its failure is already final.
          const final = current.switched || streamOptions?.willRetry?.(error) !== true;
          let reason: ModelFallbackReason;
          let until: number | undefined;
          const now = registry.now();
          if (failure) {
            reason = failure.kind;
            until = registry.markUnavailable({ accountId: current.endpoint.accountId, model: current.endpoint.model,
              reason: failure.kind, until: modelFallbackResetAt(failure, now) }).until;
          } else if (causeKind === "network" || causeKind === "server") {
            // Same-model retries first (#1250 fallback-skips-network-and-5xx): switch on the request they give up on.
            if (!final) throw error;
            reason = causeKind;
            until = operationSkip(current.endpoint, causeKind);
          } else {
            if (causeKind !== "timeout") {
              if (final) skipped(current.endpoint, causeKind, "not_switching");
              throw error;
            }
            const key = endpointKey(current.endpoint);
            const count = (timeouts.get(key) ?? 0) + 1;
            timeouts.set(key, count);
            // A one-off timeout keeps the same-model retry of provider-resilience.
            if (count < CONSECUTIVE_TIMEOUTS_TO_SWITCH) {
              if (final && !signal?.aborted) skipped(current.endpoint, causeKind, "not_switching");
              throw error;
            }
            timeouts.delete(key);
            reason = "timeout";
            until = operationSkip(current.endpoint, "timeout");
          }
          // Text already reached the user, or the caller forbids another attempt: no switch.
          if (streamed || streamOptions?.retryAllowed?.() === false) {
            skipped(current.endpoint, causeKind, streamed ? "streamed" : "retry_forbidden");
            throw error;
          }
          // The attempt's signal is gone (resilience timer): the next attempt switches.
          if (signal?.aborted) {
            pending = { from: current.endpoint, ...(until !== undefined ? { until } : {}) };
            throw error;
          }
          const target = await advance(context);
          if (!target) {
            skipped(current.endpoint, causeKind, "exhausted");
            throw error;
          }
          switchTo(target, current.endpoint, reason, now, until);
        }
      }
    };

  return Object.freeze({ complete: run("complete"), completeSimple: run("completeSimple") });
}

/**
 * The selected model's port when the purpose has no fallback left: it only reports a final failure
 * as not switched (`no_fallbacks`, or `exhausted` when the selection already used the fallbacks up).
 */
function reportUnswitched(options: FallbackCompletionOptions): LlmCompletionPort {
  const registry = options.registry ?? modelAvailability;
  const run =
    (method: keyof LlmCompletionPort) =>
    async (model: Model, context: Context, streamOptions?: StreamOptions): Promise<AssistantMessage> => {
      try {
        return await options.primary.completion[method](model, context, streamOptions);
      } catch (error) {
        const signal = streamOptions?.signal;
        if (!signal?.aborted && sameModel(model, options.primary.model) && streamOptions?.willRetry?.(error) !== true) {
          try {
            options.onFallbackSkipped?.(Object.freeze({ purpose: options.purpose, from: options.primary.endpoint,
              kind: classify(error).kind, reason: options.emptyFallbacksReason ?? "no_fallbacks", at: registry.now() }));
          } catch { /* Diagnostic only. */ }
        }
        throw error;
      }
    };
  return Object.freeze({ complete: run("complete"), completeSimple: run("completeSimple") });
}

/** Failure kinds that count toward {@link CONSECUTIVE_TIMEOUTS_TO_SWITCH}. */
function countsAsTimeout(kind: ProviderErrorClassification["kind"]): boolean {
  return kind === "timeout" || kind === "no_response";
}

/** `AbortSignal.timeout()` aborts with a DOMException named `TimeoutError`: the caller's own deadline. */
function isCallerTimeout(reason: unknown): boolean {
  return typeof DOMException !== "undefined" && reason instanceof DOMException && reason.name === "TimeoutError";
}
