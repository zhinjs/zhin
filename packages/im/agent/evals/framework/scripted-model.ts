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
  LlmApiRuntime,
  SdkProviderAdapter,
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
 * HTTP-like `status`); `empty` returns an assistant message with no content;
 * `hang` never answers and instead advances the case's virtual clock until
 * the request is aborted (e.g. by `providerResilience.requestTimeoutMs`).
 */
export type ScriptFault =
  | Readonly<{ kind: 'error'; message: string; status?: number }>
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'hang' }>;

/**
 * One model response: a final text answer, one or more tool calls, or a fault.
 * `model` optionally pins which model id must receive this request (fallback cases).
 * `tokens` reports that many total tokens for the response (default 0), for quota cases.
 */
export type ScriptStep = (
  | Readonly<{ text: string; tokens?: number }>
  | Readonly<{ toolCalls: readonly ScriptedToolCall[]; text?: string; tokens?: number }>
  | Readonly<{ fault: ScriptFault }>
) & Readonly<{ model?: string }>;

export class ScriptedProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ScriptedProviderError';
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
  /** Model id this request was sent to. */
  readonly model: string;
}

export interface ScriptedModel {
  readonly providerAlias: string;
  readonly modelId: string;
  readonly provider: SdkProviderAdapter;
  readonly runtime: LlmApiRuntime;
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
}

export class ScriptExhaustedError extends Error {
  constructor(readonly requestIndex: number, readonly scriptLength: number) {
    super(`scripted model has no step for request #${requestIndex + 1} (script has ${scriptLength} steps)`);
    this.name = 'ScriptExhaustedError';
  }
}

const PROVIDER_ALIAS = 'eval-scripted';
const MODEL_ID = 'scripted-model';

export interface ScriptedModelOptions {
  /** Extra model ids registered after the primary `scripted-model`, in candidate (fallback) order. */
  readonly extraModels?: readonly string[];
  /** Virtual clock advanced by `hang` steps. */
  readonly clock?: EvalClock;
}

export class ScriptedHangError extends Error {
  constructor(requestIndex: number) {
    super(`hang step for request #${requestIndex + 1} has no pending timer to advance; set providerResilience.requestTimeoutMs`);
    this.name = 'ScriptedHangError';
  }
}

export function createScriptedModel(script: readonly ScriptStep[], options: ScriptedModelOptions = {}): ScriptedModel {
  const models = [MODEL_ID, ...(options.extraModels ?? []).filter((id) => id !== MODEL_ID)];
  const provider = new SdkProviderAdapter(PROVIDER_ALIAS, 'openai', { sdk: 'openai', apiKey: 'eval' }, models);
  const runtime = new LlmApiRuntime((alias) => (alias === PROVIDER_ALIAS ? models : []));
  runtime.registerProvider(PROVIDER_ALIAS, { sdk: 'openai', apiKey: 'eval' }, models);
  const modelMismatches: string[] = [];

  const requests: ScriptedModelRequest[] = [];
  const unofferedToolCalls: string[] = [];
  const unexpectedlyOfferedToolCalls: string[] = [];
  let cursor = 0;
  let exhausted = 0;

  const respond = (model: Model, context: Context): AssistantMessage | ScriptFault => {
    const index = requests.length;
    const offeredTools = (context.tools ?? []).map((tool) => tool.name);
    const step = script[cursor];
    const calls = step && 'toolCalls' in step ? step.toolCalls : [];
    requests.push({
      index,
      offeredTools,
      toolCalls: calls.map((call) => call.name),
      lastUserText: lastUserText(context),
      inputText: contextText(context),
      systemPrompt: context.systemPrompt ?? '',
      model: model.id,
    });
    if (!step) {
      exhausted += 1;
      throw new ScriptExhaustedError(index, script.length);
    }
    cursor += 1;
    if (step.model && step.model !== model.id) {
      modelMismatches.push(`request #${index + 1} went to ${model.id}, script expected ${step.model}`);
    }
    for (const call of calls) {
      const offered = offeredTools.includes(call.name);
      const label = `${call.name} (request #${index + 1})`;
      if (call.notOffered && offered) unexpectedlyOfferedToolCalls.push(label);
      if (!call.notOffered && !offered) unofferedToolCalls.push(label);
    }
    if ('fault' in step && step.fault.kind === 'error') throw new ScriptedProviderError(step.fault.message, step.fault.status);
    if ('fault' in step && step.fault.kind === 'hang') return step.fault;
    return toAssistantMessage(step, index, model.id);
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

  const stream = (model: Model, context: Context, streamOptions?: { signal?: AbortSignal }) =>
    createAssistantMessageEventStream(async (push) => {
      const response = respond(model, context);
      if (!('role' in response)) return hang(requests.length - 1, streamOptions?.signal);
      const message = response;
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
    provider,
    runtime,
    requests,
    unofferedToolCalls,
    unexpectedlyOfferedToolCalls,
    modelMismatches,
    exhaustedRequests: () => exhausted,
    remainingSteps: () => script.length - cursor,
  };
}

function toAssistantMessage(step: ScriptStep, index: number, modelId: string): AssistantMessage {
  const content: AssistantMessage['content'] = [];
  if ('text' in step && step.text) content.push({ type: 'text', text: step.text });
  const calls = 'toolCalls' in step ? step.toolCalls : [];
  calls.forEach((call, offset) => {
    content.push({
      type: 'toolCall',
      id: `call-${index + 1}-${offset + 1}`,
      name: call.name,
      arguments: { ...(call.args ?? {}) },
    });
  });
  return {
    role: 'assistant',
    content,
    api: 'ai-sdk',
    provider: PROVIDER_ALIAS,
    model: modelId,
    usage: scriptedUsage(step),
    stopReason: calls.length > 0 ? 'toolCalls' : 'stop',
    timestamp: 0,
  };
}

function scriptedUsage(step: ScriptStep): AssistantMessage['usage'] {
  const tokens = 'tokens' in step && typeof step.tokens === 'number' ? step.tokens : 0;
  return { ...EMPTY_TOKEN_USAGE, input: tokens, totalTokens: tokens };
}

function lastUserText(context: Context): string {
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

function contextText(context: Context): string {
  return context.messages
    .map((message) => `${message.role}: ${blockText((message as { content?: unknown }).content)}`)
    .join('\n');
}
