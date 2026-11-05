import { SyntheticCompletionRuntime } from '../../../ai/tests/helpers/synthetic-completion-runtime.js';
import type { Segment } from '@zhin.js/im-contract';
import { aiOutboundJsonSchema } from '@zhin.js/core';
/**
 * Step-scripted fake model for the PR-gate eval tier.
 *
 * Every model request made during a case consumes the next scripted step, in
 * order. Synchronous sub-agents run inline inside the parent's tool call, so
 * parent and child requests interleave deterministically and share a single
 * script. Requests are recorded so failures can show what the harness asked.
 */
import {
  createAssistantMessageEventStream,
  EMPTY_TOKEN_USAGE,
  resolveFinish,
  type AssistantMessage,
  type Context,
  type Model,
} from '@zhin.js/ai';
import type { EvalClock } from './fake-clock.js';

export interface ScriptedToolCall {
  readonly name: string;
  readonly args?: Readonly<Record<string, unknown>>;
  /**
   * The harness is expected NOT to offer this tool on this request (policy,
   * unknown name, deferred). The call is still sent so the harness's handling
   * of it is exercised; the case fails if the tool *was* offered.
   */
  readonly notOffered?: boolean;
}

/**
 * A provider-level fault instead of a response. Generic on purpose so
 * resilience cases (#724) can model rate limits, timeouts and broken
 * responses: `error` rejects the request with `message` (and an optional
 * HTTP-like `status`, plus an optional provider JSON `body` such as a Gemini
 * `{ error: { status, details } }`); `empty` returns an assistant message with
 * no content; `hang` never answers and instead advances the case's virtual
 * clock until the request is aborted (e.g. by `providerResilience.requestTimeoutMs`);
 * `finish` returns the reply the AI SDK bridge builds for a content-less finish
 * (e.g. Gemini `finishReason: 'content-filter'` with raw `SAFETY`, a prompt
 * `blockReason`, `error` with raw `MALFORMED_FUNCTION_CALL`, or DeepSeek's
 * `error` with raw `insufficient_system_resource`).
 */
export type ScriptFault =
  | Readonly<{ kind: 'error'; message: string; status?: number; body?: unknown }>
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'hang' }>
  | Readonly<{ kind: 'finish'; finishReason: string; raw?: string; blockReason?: string }>;

/**
 * One model response: a final text answer, one or more tool calls, or a fault.
 * `model` optionally pins which model id must receive this request (including fixed-model assertions).
 * `tokens` reports that many total tokens for the response (default 0), for quota cases.
 */
export type ScriptStep = (
  | Readonly<{ text: string; tokens?: number }>
  | Readonly<{ segments: readonly Segment[]; tokens?: number }>
  | Readonly<{ toolCalls: readonly ScriptedToolCall[]; text?: string; tokens?: number }>
  | Readonly<{ fault: ScriptFault }>
) & Readonly<{
  model?: string;
  /**
   * ADR 0048 H2: the Agent whose model request this step answers. Omitted means the entry agent. Each actor has
   * its own queue, consumed in script order by that actor's requests, so interleaving across actors cannot reorder
   * a script.
   */
  actor?: string;
}>;

/** The entry agent's actor name, for steps without an `actor` tag. */
export const ENTRY_ACTOR = 'zhin';

/**
 * Which actor made a request. The engine runs another agent's turn under the session id
 * `<root session key>#actor:<agent>` (carried as `StreamOptions.sessionId`); any other session id is the entry agent.
 */
export function actorOfSession(sessionId: string | undefined): string {
  const match = sessionId ? /#actor:([^#]+)/u.exec(sessionId) : null;
  return match?.[1] ?? ENTRY_ACTOR;
}

export class ScriptedProviderError extends Error {
  /** Raw provider body, as the AI SDK's `APICallError.responseBody` carries it. */
  readonly responseBody?: string;

  constructor(message: string, readonly status?: number, body?: unknown) {
    super(message);
    this.name = 'ScriptedProviderError';
    if (body !== undefined) this.responseBody = JSON.stringify(body);
  }
}

export interface ScriptedModelRequest {
  readonly index: number;
  /** Tool calls the script answered this request with. */
  readonly toolCalls: readonly string[];
  /** Tool names offered to the model on this request. */
  readonly offeredTools: readonly string[];
  /** Text of the latest user-role message, for failure reports. */
  readonly lastUserText: string;
  /** Text of every non-system message the model received (user, assistant, tool results). */
  readonly inputText: string;
  readonly systemPrompt: string;
  /** JSON of the tool definitions (name, description, parameters) sent on this request, for token budgeting. */
  readonly toolSchemaText: string;
  /** Model id this request was sent to. */
  readonly model: string;
  /** Actor that made this request (`zhin` for the entry agent, otherwise the peer agent's name). */
  readonly actor?: string;
  /** Image blocks attached to the messages of this request (multimodal cases). */
  readonly images: number;
}

export interface ScriptedModel {
  readonly providerAlias: string;
  readonly modelId: string;
  readonly modelIds: readonly string[];
  readonly runtime: SyntheticCompletionRuntime;
  readonly requests: readonly ScriptedModelRequest[];
  /**
   * Scripted tool calls the harness did not offer on that request. A real
   * model could not make them, so a passing case must not depend on them.
   */
  readonly unofferedToolCalls: readonly string[];
  /** `notOffered` tool calls that the harness did offer. */
  readonly unexpectedlyOfferedToolCalls: readonly string[];
  /** Steps whose `model` did not match the model the request was sent to. */
  readonly modelMismatches: readonly string[];
  /** Requests that arrived after the script ran out (the harness may swallow the error). */
  exhaustedRequests(): number;
  /** Steps that were never consumed. */
  remainingSteps(): number;
  /** Unconsumed steps per actor (only actors with any left). */
  remainingStepsByActor(): Readonly<Record<string, number>>;
  /** Requests after the actor's queue ran out, per actor (only actors with any). */
  exhaustedRequestsByActor(): Readonly<Record<string, number>>;
}

export class ScriptExhaustedError extends Error {
  constructor(readonly requestIndex: number, readonly scriptLength: number, readonly actor: string = ENTRY_ACTOR) {
    super(`scripted model has no step for request #${requestIndex + 1} (script has ${scriptLength} steps${actor === ENTRY_ACTOR ? '' : ` for actor ${actor}`})`);
    this.name = 'ScriptExhaustedError';
  }
}

const PROVIDER_ALIAS = 'eval-scripted';
const MODEL_ID = 'scripted-model';
/** Provider alias / model of the scripted perception model (`EvalCase.perception`). */
export const PERCEPTION_PROVIDER_ALIAS = 'eval-perception';
export const PERCEPTION_MODEL_ID = 'scripted-perception';

export interface ScriptedModelOptions {
  /** Model context window reported to the harness (drives compaction thresholds). */
  readonly contextWindow?: number;
  /** Input modalities the scripted model declares (default text only); `image` lets turn images through. */
  readonly input?: readonly ('text' | 'image' | 'audio' | 'video' | 'file')[];
  /** Extra model ids registered after the primary `scripted-model`, in registration order; fixed chat must not call them. */
  readonly extraModels?: readonly string[];
  /** Virtual clock advanced by `hang` steps. */
  readonly clock?: EvalClock;
  /** Per-model input overrides (e.g. a text-only alternative next to an image-capable primary). */
  readonly modelInputs?: Readonly<Record<string, readonly ('text' | 'image' | 'audio' | 'video' | 'file')[]>>;
  /** Also register the media-capable perception model (`eval-perception/scripted-perception`). */
  readonly perception?: boolean;
  /**
   * Awaited while a request is served, after its step was taken and before
   * the response is returned (`entryStep` is 1-based, entry actor only;
   * undefined for actor requests). Drives mid-turn Mail delivery.
   */
  readonly onRequest?: (entryStep: number | undefined) => Promise<void> | void;
}

export class ScriptedHangError extends Error {
  constructor(requestIndex: number) {
    super(`hang step for request #${requestIndex + 1} has no pending timer to advance; set providerResilience.requestTimeoutMs`);
    this.name = 'ScriptedHangError';
  }
}

/** SyntheticCompletionRuntime whose model descriptors can declare per-model input modalities. */
class ScriptedRuntime extends SyntheticCompletionRuntime {
  constructor(
    resolveModels: (alias: string) => string[],
    private readonly modelInputs: Readonly<Record<string, readonly ('text' | 'image' | 'audio' | 'video' | 'file')[]>>,
  ) {
    super(resolveModels);
  }

  override model(providerAlias: string, modelId: string): Model {
    const model = super.model(providerAlias, modelId);
    const input = this.modelInputs[modelId];
    return input ? { ...model, input: [...input] } : model;
  }
}

export function createScriptedModel(script: readonly ScriptStep[], options: ScriptedModelOptions = {}): ScriptedModel {
  const models = [MODEL_ID, ...(options.extraModels ?? []).filter((id) => id !== MODEL_ID)];
  const runtime = new ScriptedRuntime((alias) => (
    alias === PROVIDER_ALIAS ? models : alias === PERCEPTION_PROVIDER_ALIAS ? [PERCEPTION_MODEL_ID] : []
  ), options.modelInputs ?? {});
  runtime.registerProvider(PROVIDER_ALIAS, {
    sdk: 'openai',
    ...(options.contextWindow ? { contextWindow: options.contextWindow } : {}),
    ...(options.input?.length ? { input: [...options.input] } : {}),
  }, models);
  if (options.perception) {
    runtime.registerProvider(PERCEPTION_PROVIDER_ALIAS, {
      sdk: 'openai',
        input: ['text', 'image', 'video', 'file'],
    }, [PERCEPTION_MODEL_ID]);
  }
  const modelMismatches: string[] = [];

  const requests: ScriptedModelRequest[] = [];
  const unofferedToolCalls: string[] = [];
  const unexpectedlyOfferedToolCalls: string[] = [];
  // One queue per actor, each consumed in script order. Entry steps carry no `actor` tag.
  const queues = new Map<string, ScriptStep[]>();
  for (const step of script) {
    const actor = step.actor ?? ENTRY_ACTOR;
    const queue = queues.get(actor) ?? [];
    queue.push(step);
    queues.set(actor, queue);
  }
  const cursors = new Map<string, number>();
  const exhaustedBy = new Map<string, number>();
  let exhausted = 0;
  let consumed = 0;
  let entryRequests = 0;

  const respond = (model: Model, context: Context, sessionId: string | undefined): { response: AssistantMessage | ScriptFault; step: ScriptStep } => {
    const index = requests.length;
    const actor = actorOfSession(sessionId);
    const queue = queues.get(actor) ?? [];
    const cursor = cursors.get(actor) ?? 0;
    const offeredTools = (context.tools ?? []).map((tool) => tool.name);
    const step = queue[cursor];
    const calls = step && 'toolCalls' in step ? step.toolCalls : [];
    requests.push({
      index,
      offeredTools,
      toolCalls: calls.map((call) => call.name),
      lastUserText: lastUserText(context),
      inputText: contextText(context),
      systemPrompt: context.systemPrompt ?? '',
      toolSchemaText: toolSchemaTextOf(context),
      model: model.id,
      actor,
      images: countImages(context),
    });
    if (!step) {
      exhausted += 1;
      exhaustedBy.set(actor, (exhaustedBy.get(actor) ?? 0) + 1);
      throw new ScriptExhaustedError(index, queue.length, actor);
    }
    cursors.set(actor, cursor + 1);
    consumed += 1;
    if (step.model && step.model !== model.id) {
      modelMismatches.push(`request #${index + 1} went to ${model.id}, script expected ${step.model}`);
    }
    for (const call of calls) {
      const offered = offeredTools.includes(call.name);
      const label = `${call.name} (request #${index + 1})`;
      if (call.notOffered && offered) unexpectedlyOfferedToolCalls.push(label);
      if (!call.notOffered && !offered) unofferedToolCalls.push(label);
    }
    if ('fault' in step && step.fault.kind === 'error') throw new ScriptedProviderError(step.fault.message, step.fault.status, step.fault.body);
    if ('fault' in step && step.fault.kind === 'hang') return { response: step.fault, step };
    return { response: toAssistantMessage(step, index, model.id), step };
  };

  /** Never answer; advance virtual time until the caller aborts the request. */
  const hang = (index: number, signal: AbortSignal | undefined): Promise<never> =>
    new Promise((_, reject) => {
      const onAbort = () => reject(signal?.reason ?? new Error('aborted'));
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
      queueMicrotask(() => {
        while (!signal?.aborted) {
          if (!options.clock?.runNext()) {
            signal?.removeEventListener('abort', onAbort);
            reject(new ScriptedHangError(index));
            return;
          }
        }
      });
    });

  const stream = (model: Model, context: Context, streamOptions?: { signal?: AbortSignal; outputSchema?: Record<string, unknown>; sessionId?: string }) =>
    createAssistantMessageEventStream(async (push) => {
      const { response, step } = respond(model, context, streamOptions?.sessionId);
      if (options.onRequest) {
        const entryStep = actorOfSession(streamOptions?.sessionId) === ENTRY_ACTOR ? ++entryRequests : undefined;
        await options.onRequest(entryStep);
      }
      if (!('role' in response)) return hang(requests.length - 1, streamOptions?.signal);
      const message = response;
      if (streamOptions?.outputSchema === aiOutboundJsonSchema && step && !('segments' in step) && !message.errorMessage
        && message.content.length > 0 && !message.content.some(block => block.type === 'toolCall')) {
        const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('');
        message.content = [{ type: 'text', text: JSON.stringify({ segments: [{ type: 'text', data: { text } }] }) }];
      }
      const text = message.content
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map((block) => block.text)
        .join('');
      if (text) push({ type: 'text_delta', text });
      return message;
    });
  runtime.registerApiProvider({ api: 'ai-sdk', stream, streamSimple: stream });

  return {
    providerAlias: PROVIDER_ALIAS,
    modelId: MODEL_ID,
    modelIds: models,
    runtime,
    requests,
    unofferedToolCalls,
    unexpectedlyOfferedToolCalls,
    modelMismatches,
    exhaustedRequests: () => exhausted,
    remainingSteps: () => script.length - consumed,
    remainingStepsByActor: () => Object.fromEntries(
      [...queues].map(([actor, queue]) => [actor, queue.length - (cursors.get(actor) ?? 0)] as const).filter(([, left]) => left > 0),
    ),
    exhaustedRequestsByActor: () => Object.fromEntries(exhaustedBy),
  };
}

function toAssistantMessage(step: ScriptStep, index: number, modelId: string): AssistantMessage {
  const content: AssistantMessage['content'] = [];
  if ('text' in step && step.text) content.push({ type: 'text', text: step.text });
  if ('segments' in step) content.push({ type: 'text', text: JSON.stringify({ segments: step.segments }) });
  const calls = 'toolCalls' in step ? step.toolCalls : [];
  calls.forEach((call, offset) => {
    content.push({
      type: 'toolCall',
      id: `call-${index + 1}-${offset + 1}`,
      name: call.name,
      arguments: { ...(call.args ?? {}) },
    });
  });
  // A content-less finish goes through the same mapping as the real AI SDK bridge.
  const finish = 'fault' in step && step.fault.kind === 'finish'
    ? resolveFinish({
      finishReason: step.fault.finishReason,
      rawFinishReason: step.fault.raw,
      providerMetadata: step.fault.blockReason ? { google: { promptFeedback: { blockReason: step.fault.blockReason } } } : undefined,
      hasText: false,
      hasToolCalls: false,
    })
    : { stopReason: calls.length > 0 ? 'toolCalls' as const : 'stop' as const };
  return {
    role: 'assistant',
    content,
    api: 'ai-sdk',
    provider: PROVIDER_ALIAS,
    model: modelId,
    usage: scriptedUsage(step),
    stopReason: finish.stopReason,
    ...(finish.errorMessage ? { errorMessage: finish.errorMessage } : {}),
    timestamp: 0,
  };
}

function scriptedUsage(step: ScriptStep): AssistantMessage['usage'] {
  const tokens = 'tokens' in step && typeof step.tokens === 'number' ? step.tokens : 0;
  return { ...EMPTY_TOKEN_USAGE, input: tokens, totalTokens: tokens };
}

/** JSON of the tool definitions a request carries (what the provider bills as tool schema). */
export function toolSchemaTextOf(context: Context): string {
  return JSON.stringify((context.tools ?? []).map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.inputJsonSchema ?? tool.parameters })));
}

/** Image media blocks across the request's messages. */
export function countImages(context: Context): number {
  return context.messages.reduce((sum, message) => {
    const media = (message as { media?: ReadonlyArray<{ type?: string }> }).media;
    return sum + (media?.filter((block) => block.type === 'image').length ?? 0);
  }, 0);
}

export function lastUserText(context: Context): string {
  const message = [...context.messages].reverse().find((candidate) => candidate.role === 'user');
  const content = (message as { content?: unknown } | undefined)?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((block: { text?: string }) => block.text ?? '').join('');
}

function blockText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block: { type?: string; text?: string; name?: string; arguments?: unknown }) => {
      if (typeof block.text === 'string') return block.text;
      if (block.type === 'toolCall') return `[call ${block.name} ${JSON.stringify(block.arguments ?? {})}]`;
      return '';
    })
    .join('');
}

export function contextText(context: Context): string {
  return context.messages
    .map((message) => `${message.role}: ${blockText((message as { content?: unknown }).content)}`)
    .join('\n');
}
