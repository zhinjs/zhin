import { createHash, randomUUID } from 'node:crypto';
import { EMPTY_TOKEN_USAGE, type AssistantMessage, type LlmCompletionPort, type TokenUsage, type Usage, type LlmRequestObservation } from '@zhin.js/ai';

import type { UsageEvent } from '../event/turn-event.js';
import { turnUsageEvent } from './turn-event-mapper.js';
import { noteTurnTrace } from '../trace/turn-trace-registry.js';
import type { InteractiveRun } from './interactive-run.js';

/**
 * Counts completed provider responses before reply validation, including rejected replies.
 * Each completion is one semantic request. Framework retries/fallbacks invoke it again;
 * the SDK may retry the same input internally, which does not create another request.
 */
export function trackTurnCompletionUsage(
  delegate: LlmCompletionPort,
  project?: (message: AssistantMessage, signal?: AbortSignal) => Promise<AssistantMessage>,
  trace?: Readonly<{
    turnId?: string;
    recordBodies?: boolean;
    /**
     * Maps a request's `model.provider` (the account id of the bound profile) to the provider id
     * responses report (the service id), so the request timeline, `model_calls` and `ai.usage`
     * record one id for one request (#1250). Unmapped ids are recorded as given.
     */
    resolveProvider?: (provider: string) => string | undefined;
  }>,
  run?: InteractiveRun,
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
  const record = (assistant: AssistantMessage, durationMs: number, requestId: string, prefixHash?: string): AssistantMessage => {
    const usage = assistant.usage;
    run?.recordUsage(usage.totalTokens);
    pending.push(turnUsageEvent(usage, {
      provider: assistant.provider, model: assistant.model, stopReason: assistant.stopReason, durationMs, requestId,
      ...(prefixHash ? { prefixHash } : {}),
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
    const stopped = run?.check();
    if (stopped) throw new Error(stopped);
    const requestId = randomUUID();
    const started = performance.now();
    const provider = trace?.resolveProvider?.(model.provider) ?? model.provider;
    const request = { request_id: requestId, provider, model: model.id, started_at: Date.now(), status: 'running' as const };
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
      duration_ms: durationMs, stop_reason: assistant.stopReason,
      ...(assistant.provider ? { provider: assistant.provider } : {}),
      ...(assistant.model ? { model: assistant.model } : {}) });
    return projectRecorded(record(assistant, durationMs, requestId, requestPrefixHash(context)), options?.signal);
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
      run?.recordUsage(usage.total_tokens);
      const tokens: TokenUsage = { input: usage.prompt_tokens, output: usage.completion_tokens,
        totalTokens: usage.total_tokens, cacheRead: 0, cacheWrite: 0, cost: { ...EMPTY_TOKEN_USAGE.cost } };
      total.input += tokens.input;
      total.output += tokens.output;
      total.totalTokens += tokens.totalTokens;
      pending.push(turnUsageEvent(tokens, { provider: provider ?? 'media-perception', model: model ?? 'unknown', stopReason: 'stop' }));
    },
  };
}

/**
 * Hash of what a provider prompt cache keys on first: the system prompt and the tool
 * definitions, in request order (#1250 usage-cache-unsupported-hint). Never the messages.
 */
export function requestPrefixHash(context: Readonly<{ systemPrompt?: string; tools?: readonly unknown[] }> | undefined): string | undefined {
  if (!context) return undefined;
  try {
    const hash = createHash('sha256');
    hash.update(context.systemPrompt ?? '');
    for (const tool of context.tools ?? []) {
      hash.update('\u0000');
      hash.update(stableToolText(tool));
    }
    return hash.digest('hex').slice(0, 16);
  } catch {
    return undefined;
  }
}

function stableToolText(tool: unknown): string {
  if (!tool || typeof tool !== 'object') return String(tool);
  const { name, description, parameters } = tool as { name?: unknown; description?: unknown; parameters?: unknown };
  return `${String(name)}\u0001${String(description ?? '')}\u0001${safeJson(parameters)}`;
}

function safeJson(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === 'function') return undefined;
      if (item && typeof item === 'object') {
        if (seen.has(item)) return '[cycle]';
        seen.add(item);
      }
      return item;
    }) ?? '';
  } catch {
    return '';
  }
}
