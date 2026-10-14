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

export interface ScriptedToolCall {
  readonly name: string;
  readonly args?: Readonly<Record<string, unknown>>;
}

/** One model response: either a final text answer or one or more tool calls. */
export type ScriptStep =
  | Readonly<{ text: string }>
  | Readonly<{ toolCalls: readonly ScriptedToolCall[]; text?: string }>;

export interface ScriptedModelRequest {
  readonly index: number;
  /** Tool calls the script answered this request with. */
  readonly toolCalls: readonly string[];
  /** Tool names offered to the model on this request. */
  readonly offeredTools: readonly string[];
  /** Text of the latest user-role message, for failure reports. */
  readonly lastUserText: string;
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

export function createScriptedModel(script: readonly ScriptStep[]): ScriptedModel {
  const provider = new SdkProviderAdapter(PROVIDER_ALIAS, 'openai', { sdk: 'openai', apiKey: 'eval' }, [MODEL_ID]);
  const runtime = new LlmApiRuntime((alias) => (alias === PROVIDER_ALIAS ? [MODEL_ID] : []));
  runtime.registerProvider(PROVIDER_ALIAS, { sdk: 'openai', apiKey: 'eval' }, [MODEL_ID]);

  const requests: ScriptedModelRequest[] = [];
  const unofferedToolCalls: string[] = [];
  let cursor = 0;
  let exhausted = 0;

  const respond = (context: Context): AssistantMessage => {
    const index = requests.length;
    const offeredTools = (context.tools ?? []).map((tool) => tool.name);
    const step = script[cursor];
    const calls = step && 'toolCalls' in step ? step.toolCalls : [];
    requests.push({ index, offeredTools, toolCalls: calls.map((call) => call.name), lastUserText: lastUserText(context) });
    if (!step) {
      exhausted += 1;
      throw new ScriptExhaustedError(index, script.length);
    }
    cursor += 1;
    for (const call of calls) {
      if (!offeredTools.includes(call.name)) unofferedToolCalls.push(`${call.name} (request #${index + 1})`);
    }
    return toAssistantMessage(step, index);
  };

  const stream = (_model: Model, context: Context) =>
    createAssistantMessageEventStream(async (push) => {
      const message = respond(context);
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
    exhaustedRequests: () => exhausted,
    remainingSteps: () => script.length - cursor,
  };
}

function toAssistantMessage(step: ScriptStep, index: number): AssistantMessage {
  const content: AssistantMessage['content'] = [];
  if (step.text) content.push({ type: 'text', text: step.text });
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
    model: MODEL_ID,
    usage: { ...EMPTY_TOKEN_USAGE },
    stopReason: calls.length > 0 ? 'toolCalls' : 'stop',
    timestamp: 0,
  };
}

function lastUserText(context: Context): string {
  const message = [...context.messages].reverse().find((candidate) => candidate.role === 'user');
  const content = (message as { content?: unknown } | undefined)?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((block: { text?: string }) => block.text ?? '').join('');
}
