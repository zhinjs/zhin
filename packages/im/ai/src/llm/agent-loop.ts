import type { Context } from './types/context.js';
import type { AgentMessage, AssistantMessage, UserMessage } from './types/agent-message.js';
import type { AgentEvent, ThinkingLevel, ToolExecutionMode } from './types/agent-event.js';
import type { Model } from './types/model.js';
import type { LlmTool, ParsedToolCall } from './types/tool.js';
import { EMPTY_TOKEN_USAGE, isLlmAgentMessage } from './types/agent-message.js';
import { isContextOverflowError } from '../compaction/agent-message-compaction.js';
import { complete, type StreamOptions } from './api-registry.js';
import { validateToolCall } from './validate-tool-call.js';

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
  ) => Promise<AgentMessage>;
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

export async function* agentLoop(
  prompts: AgentMessage | AgentMessage[],
  initialContext: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const promptBatch = Array.isArray(prompts) ? prompts : [prompts];
  const tools = initialContext.tools;
  const messages: AgentMessage[] = [...initialContext.messages, ...promptBatch];
  const maxIterations = config.maxIterations ?? 8;
  const convertToLlm = config.convertToLlm ?? defaultConvertToLlm;
  const executeTool = config.executeTool ?? defaultExecuteTool;
  const emitted: AgentMessage[] = [];

  yield { type: 'agent_start' };

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (signal?.aborted) break;

    yield { type: 'turn_start' };

    const transformed = config.transformContext
      ? await config.transformContext(messages, signal)
      : messages;
    messages.splice(0, messages.length, ...transformed);

    const buildLlmContext = async (): Promise<Context> => {
      const llmMessages = await convertToLlm(messages);
      return {
        systemPrompt: initialContext.systemPrompt,
        messages: llmMessages,
        tools: tools.length > 0 ? tools : undefined,
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
            messages.splice(0, messages.length, ...compacted);
          }
          assistant = await complete(config.model, await buildLlmContext(), {
            ...config.streamOptions,
            signal,
            sessionId: config.sessionId,
            thinkingLevel: config.reasoning,
          });
        } catch (retryError) {
          error = retryError;
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

    if (toolCalls.length === 0 || assistant.stopReason !== 'toolCalls') {
      yield { type: 'turn_end', message: assistant, toolResults };
      break;
    }

    const runCalls = config.toolExecution === 'sequential'
      ? toolCalls
      : toolCalls;

    for (const rawCall of runCalls) {
      if (signal?.aborted) break;

      let toolCall = rawCall;
      try {
        toolCall = validateToolCall(tools, rawCall);
      } catch (error) {
        const result = createErrorToolResult(
          rawCall,
          error instanceof Error ? error.message : String(error),
        );
        toolResults.push(result);
        messages.push(result);
        emitted.push(result);
        yield { type: 'tool_execution_start', toolCallId: rawCall.id, toolCall: rawCall };
        yield { type: 'tool_execution_end', toolCallId: rawCall.id, result };
        continue;
      }

      if (config.beforeToolCall) {
        const gate = await config.beforeToolCall({ toolCall, tools }, signal);
        if (gate?.allowed === false) {
          const result = createErrorToolResult(toolCall, gate.reason ?? 'Tool call denied');
          toolResults.push(result);
          messages.push(result);
          emitted.push(result);
          yield { type: 'tool_execution_start', toolCallId: toolCall.id, toolCall };
          yield { type: 'tool_execution_end', toolCallId: toolCall.id, result };
          continue;
        }
        if (gate?.modifiedArguments) {
          toolCall = { ...toolCall, arguments: gate.modifiedArguments };
        }
      }

      yield { type: 'tool_execution_start', toolCallId: toolCall.id, toolCall };
      const result = await executeTool(toolCall, tools, signal);
      toolResults.push(result);
      messages.push(result);
      emitted.push(result);
      yield { type: 'tool_execution_end', toolCallId: toolCall.id, result };
      if (config.afterToolCall) {
        await config.afterToolCall({ toolCall, result }, signal);
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

  yield { type: 'agent_end', messages: emitted, userMessages: promptBatch };
}

export function agentContextFrom(context: Context): AgentContext {
  return {
    systemPrompt: context.systemPrompt,
    messages: [...context.messages],
    tools: context.tools ? [...context.tools] : [],
  };
}

export type { UserMessage };
