import type { Context } from './types/context.js';
import { type AgentMessage, type AssistantMessage, type ConversationActor, type ConversationTurnCause, type UserMessage, EMPTY_TOKEN_USAGE, isLlmAgentMessage } from './types/agent-message.js';
import type { AgentEvent, ThinkingLevel, ToolExecutionMode } from './types/agent-event.js';
import type { Model } from './types/model.js';
import type { LlmTool, ParsedToolCall } from './types/tool.js';
import { isContextOverflowError } from '../compaction/agent-message-compaction.js';
import { complete, type StreamOptions } from './api-registry.js';
import { createIncrementalRepair } from './repair-agent-messages.js';
import { validateToolCall } from './validate-tool-call.js';
import { isTieredParallelTool } from './tiered-tool-buckets.js';
export interface BeforeToolCallContext {
  toolCall: ParsedToolCall;
  tools: LlmTool[];
}

export interface BeforeToolCallResult {
  allowed?: boolean;
  reason?: string;
  modifiedArguments?: Record<string, unknown>;
}

export interface AfterToolCallContext {
  toolCall: ParsedToolCall;
  result: AgentMessage;
}

/** Participant whose latest user message causally preceded a tool execution. */
export interface ToolExecutionCause {
  readonly principal?: ConversationActor;
  readonly turn?: ConversationTurnCause;
}

export interface AgentLoopConfig {
  model: Model;
  maxIterations?: number;
  reasoning?: ThinkingLevel;
  sessionId?: string;
  toolExecution?: ToolExecutionMode;
  convertToLlm?: (messages: AgentMessage[]) => AgentMessage[] | Promise<AgentMessage[]>;
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
  beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | void>;
  afterToolCall?: (
    context: AfterToolCallContext,
    signal?: AbortSignal,
  ) => Promise<void>;
  executeTool?: (
    toolCall: ParsedToolCall,
    tools: LlmTool[],
    signal?: AbortSignal,
    cause?: ToolExecutionCause,
  ) => Promise<AgentMessage>;
  /** Refresh tool list after meta-tool load (discover/load_*). */
  refreshTools?: () => LlmTool[] | Promise<LlmTool[]>;
  /** Detect tool result that expanded the session tool set. */
  shouldRecompleteAfterTool?: (result: AgentMessage) => boolean;
  /** Max LLM re-complete calls per iteration after tool mutation (default 1). */
  maxRecompletePerIteration?: number;
  getSteeringMessages?: () => Promise<AgentMessage[]>;
  getFollowUpMessages?: () => Promise<AgentMessage[]>;
  onContextOverflow?: (
    messages: AgentMessage[],
    signal?: AbortSignal,
  ) => Promise<AgentMessage[] | null | undefined>;
  streamOptions?: Omit<StreamOptions, 'signal'>;
}

export interface AgentContext {
  systemPrompt: string;
  messages: AgentMessage[];
  tools: LlmTool[];
}

function defaultConvertToLlm(messages: AgentMessage[]): AgentMessage[] {
  return messages.filter(isLlmAgentMessage);
}

function extractToolCalls(message: AssistantMessage): ParsedToolCall[] {
  return message.content
    .filter((block): block is Extract<typeof block, { type: 'toolCall' }> => block.type === 'toolCall')
    .map((block) => ({
      id: block.id,
      name: block.name,
      arguments: block.arguments,
    }));
}

function extractText(message: AssistantMessage): string {
  return message.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

function createErrorToolResult(toolCall: ParsedToolCall, error: string): AgentMessage {
  return {
    role: 'toolResult',
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: 'text', text: error }],
    isError: true,
    timestamp: Date.now(),
  };
}

async function defaultExecuteTool(
  toolCall: ParsedToolCall,
  _tools: LlmTool[],
  _signal?: AbortSignal,
): Promise<AgentMessage> {
  return createErrorToolResult(toolCall, `Tool execution not configured: ${toolCall.name}`);
}

function isParallelToolCall(name: string, mode: ToolExecutionMode | undefined): boolean {
  if (mode === 'sequential') return false;
  if (mode === 'parallel') return true;
  return isTieredParallelTool(name);
}

interface ExecuteToolCallsOptions {
  toolCalls: ParsedToolCall[];
  tools: LlmTool[];
  config: AgentLoopConfig;
  executeTool: NonNullable<AgentLoopConfig['executeTool']>;
  signal?: AbortSignal;
  cause?: ToolExecutionCause;
  onResult: (result: AgentMessage) => void;
  onEvent: (event: AgentEvent) => void;
}

async function executeToolCallsInTurn(options: ExecuteToolCallsOptions): Promise<void> {
  const { toolCalls, tools, config, executeTool, signal, cause, onResult, onEvent } = options;
  const mode = config.toolExecution ?? 'sequential';

  const runOne = async (
    rawCall: ParsedToolCall,
    emitResult: (result: AgentMessage) => void = onResult,
  ): Promise<void> => {
    if (signal?.aborted) return;

    let toolCall = rawCall;
    try {
      toolCall = validateToolCall(tools, rawCall);
    } catch (error) {
      const result = createErrorToolResult(
        rawCall,
        error instanceof Error ? error.message : String(error),
      );
      emitResult(result);
      onEvent({ type: 'tool_execution_start', toolCallId: rawCall.id, toolCall: rawCall });
      onEvent({ type: 'tool_execution_end', toolCallId: rawCall.id, result });
      return;
    }

    if (config.beforeToolCall) {
      const gate = await config.beforeToolCall({ toolCall, tools }, signal);
      if (gate?.allowed === false) {
        const result = createErrorToolResult(toolCall, gate.reason ?? 'Tool call denied');
        emitResult(result);
        onEvent({ type: 'tool_execution_start', toolCallId: toolCall.id, toolCall });
        onEvent({ type: 'tool_execution_end', toolCallId: toolCall.id, result });
        return;
      }
      if (gate?.modifiedArguments) {
        toolCall = { ...toolCall, arguments: gate.modifiedArguments };
      }
    }

    onEvent({ type: 'tool_execution_start', toolCallId: toolCall.id, toolCall });
    const result = await executeTool(toolCall, tools, signal, cause);
    emitResult(result);
    onEvent({ type: 'tool_execution_end', toolCallId: toolCall.id, result });
    if (config.afterToolCall) {
      await config.afterToolCall({ toolCall, result }, signal);
    }
  };

  const parallelCalls: ParsedToolCall[] = [];
  const sequentialCalls: ParsedToolCall[] = [];
  for (const call of toolCalls) {
    if (isParallelToolCall(call.name, mode)) {
      parallelCalls.push(call);
    } else {
      sequentialCalls.push(call);
    }
  }

  if (parallelCalls.length > 0) {
    // 并行执行、按调用序落列：toolResult 在消息流中的位置与 toolCall 一一对应，
    // 不依赖各工具完成先后（Anthropic 类协议对块顺序敏感）。
    const slots = new Array<AgentMessage | undefined>(parallelCalls.length);
    await Promise.all(parallelCalls.map((call, index) =>
      runOne(call, (result) => { slots[index] = result; })));
    for (const result of slots) {
      if (result) onResult(result);
    }
  }
  for (const call of sequentialCalls) {
    await runOne(call);
  }
}

function latestToolExecutionCause(messages: readonly AgentMessage[]): ToolExecutionCause | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || !isLlmAgentMessage(message) || message.role !== 'user') continue;
    if (!message.actor && !message.cause) return undefined;
    return {
      ...(message.actor ? { principal: message.actor } : {}),
      ...(message.cause ? { turn: message.cause } : {}),
    };
  }
  return undefined;
}

export async function* agentLoop(
  prompts: AgentMessage | AgentMessage[],
  initialContext: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const promptBatch = Array.isArray(prompts) ? prompts : [prompts];
  let tools = [...initialContext.tools];
  const messages: AgentMessage[] = [...initialContext.messages, ...promptBatch];
  const maxIterations = config.maxIterations ?? 8;
  const maxRecomplete = config.maxRecompletePerIteration ?? 1;
  const convertToLlm = config.convertToLlm ?? defaultConvertToLlm;
  const executeTool = config.executeTool ?? defaultExecuteTool;
  const emitted: AgentMessage[] = [];
  // 修复不变量由 loop 持有：消息 append-only，按最后 user 边界增量修复；
  // 历史被替换（transform/压缩）时重置检查点。
  const repairer = createIncrementalRepair();

  yield { type: 'agent_start' };

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (signal?.aborted) break;

    yield { type: 'turn_start' };

    const transformed = config.transformContext
      ? await config.transformContext(messages, signal)
      : messages;
    if (transformed !== messages) repairer.reset();
    messages.splice(0, messages.length, ...transformed);

    const buildLlmContext = async (): Promise<Context> => {
      const llmMessages = await convertToLlm(repairer.repair(messages));
      return {
        systemPrompt: initialContext.systemPrompt,
        messages: llmMessages,
        tools: tools.length > 0 ? tools : undefined,
        preRepaired: true,
      };
    };

    let assistant: AssistantMessage;
    try {
      assistant = await complete(config.model, await buildLlmContext(), {
        ...config.streamOptions,
        signal,
        sessionId: config.sessionId,
        thinkingLevel: config.reasoning,
      });
    } catch (error) {
      if (config.onContextOverflow && isContextOverflowError(error)) {
        try {
          const compacted = await config.onContextOverflow(messages, signal);
          if (compacted?.length) {
            repairer.reset();
            messages.splice(0, messages.length, ...compacted);
          }
          assistant = await complete(config.model, await buildLlmContext(), {
            ...config.streamOptions,
            signal,
            sessionId: config.sessionId,
            thinkingLevel: config.reasoning,
          });
        } catch (retryError) {
          error = retryError as Error; // eslint-disable-line no-ex-assign -- intentional re-assignment for retry
        }
      }
      if (!assistant!) {
        assistant = {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          api: config.model.api,
          provider: config.model.provider,
          model: config.model.id,
          usage: EMPTY_TOKEN_USAGE,
          stopReason: signal?.aborted ? 'aborted' : 'error',
          errorMessage: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        };
      }
    }

    yield { type: 'message_start', message: assistant };
    yield { type: 'message_end', message: assistant };
    messages.push(assistant);
    emitted.push(assistant);

    const toolCalls = extractToolCalls(assistant);
    const toolResults: AgentMessage[] = [];
    // 每轮独立计数：maxRecompletePerIteration 语义为单轮上限
    let recompleteCount = 0;

    if (toolCalls.length === 0) {
      yield { type: 'turn_end', message: assistant, toolResults };
      break;
    }

    const pendingEvents: AgentEvent[] = [];
    let recompletePending = false;
    await executeToolCallsInTurn({
      toolCalls,
      tools,
      config,
      executeTool,
      signal,
      cause: latestToolExecutionCause(messages),
      onResult: (result) => {
        toolResults.push(result);
        messages.push(result);
        emitted.push(result);
        if (config.shouldRecompleteAfterTool?.(result) === true) {
          recompletePending = true;
        }
      },
      onEvent: (event) => {
        pendingEvents.push(event);
      },
    });
    for (const event of pendingEvents) {
      yield event;
    }

    if (recompletePending && config.refreshTools && recompleteCount < maxRecomplete) {
      const refreshed = await config.refreshTools();
      tools = [...refreshed];
      recompleteCount += 1;
      try {
        const followUp = await complete(config.model, await buildLlmContext(), {
          ...config.streamOptions,
          signal,
          sessionId: config.sessionId,
          thinkingLevel: config.reasoning,
        });
        yield { type: 'message_start', message: followUp };
        yield { type: 'message_end', message: followUp };
        messages.push(followUp);
        emitted.push(followUp);
        const followCalls = extractToolCalls(followUp);
        if (followCalls.length > 0) {
          const followEvents: AgentEvent[] = [];
          await executeToolCallsInTurn({
            toolCalls: followCalls,
            tools,
            config,
            executeTool,
            signal,
            cause: latestToolExecutionCause(messages),
            onResult: (result) => {
              toolResults.push(result);
              messages.push(result);
              emitted.push(result);
            },
            onEvent: (event) => {
              followEvents.push(event);
            },
          });
          for (const event of followEvents) {
            yield event;
          }
        }
      } catch {
        // re-complete failure: keep original tool results
      }
    }

    yield { type: 'turn_end', message: assistant, toolResults };

    const steering = config.getSteeringMessages ? await config.getSteeringMessages() : [];
    if (steering.length > 0) {
      messages.push(...steering);
      emitted.push(...steering);
    }

    const last = messages[messages.length - 1];
    if (last?.role === 'assistant' && extractText(last as AssistantMessage).length > 0 && toolResults.length === 0) {
      break;
    }
  }

  if (config.getFollowUpMessages) {
    while (true) {
      const batch = await config.getFollowUpMessages();
      if (batch.length === 0) break;
      for await (const event of agentLoop(batch, {
        systemPrompt: initialContext.systemPrompt,
        messages,
        tools,
      }, config, signal)) {
        yield event;
        if (event.type === 'message_end') {
          emitted.push(event.message);
        }
      }
    }
  }

  // 事件不可变：发出去的快照不回看本地数组（生成器恢复后本地仍会继续 push）
  yield { type: 'agent_end', messages: [...emitted], userMessages: promptBatch };
}

export function agentContextFrom(context: Context): AgentContext {
  return {
    systemPrompt: context.systemPrompt,
    messages: [...context.messages],
    tools: context.tools ? [...context.tools] : [],
  };
}

export type { UserMessage };
