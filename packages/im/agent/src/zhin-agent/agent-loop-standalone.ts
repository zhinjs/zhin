/**
 * Standalone agentLoop runner (subagent / deferred worker) — isolated memory context.
 */
import { formatCompact, Logger } from '@zhin.js/logger';
import type { AgentTool, AIProvider, ContentPart, Usage } from '@zhin.js/ai';
import {
  agentLoop,
  agentContextFrom,
  assistantText,
  createUserMessage,
  createMemoryContextRepository,
  getModel,
  convertLegacyTools,
  registerLlmApiFromProviders,
  type AgentMessage,
  type ParsedToolCall,
  type AssistantMessage,
  type TokenUsage,
  type ToolResultTransform,
} from '@zhin.js/ai';
import { runWithBashToolContext, runWithDirectAgentExecution } from '../security/bash-tool-context.js';
import type { ToolContext } from '../orchestrator/types.js';
import { sanitizeAssistantReply } from './text-sanitize.js';
import type { ToolCallRecord } from './tool-calls-user-format.js';
import { formatToolCallsForUser } from './tool-calls-user-format.js';
import { buildVisionUserMessage, summarizeMultimodalParts } from './multimodal-message.js';
import { DEFAULT_MULTIMODAL_CONFIG } from '../media/media-types.js';

const logger = new Logger(null, 'AgentLoopStandalone');

function tokenUsageToLegacy(usage: TokenUsage): Usage {
  return {
    prompt_tokens: usage.input,
    completion_tokens: usage.output,
    total_tokens: usage.totalTokens,
  };
}

function toolResultToAgentMessage(
  toolCall: ParsedToolCall,
  result: unknown,
  isError: boolean,
): AgentMessage {
  const text =
    typeof result === 'string'
      ? result
      : result == null
        ? ''
        : JSON.stringify(result);
  return {
    role: 'toolResult',
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: 'text', text: text || (isError ? 'Error' : '') }],
    isError,
    timestamp: Date.now(),
  };
}

async function buildUserMessages(input: string | ContentPart[]): Promise<AgentMessage[]> {
  if (typeof input === 'string') {
    return [createUserMessage(input)];
  }
  const text = summarizeMultimodalParts(input, true);
  const user = await buildVisionUserMessage(
    text,
    input,
    true,
    DEFAULT_MULTIMODAL_CONFIG.maxFileBytes,
  );
  return [user];
}

function ensureLlmApi(provider: AIProvider, resolveProvider?: (alias: string) => AIProvider | undefined): void {
  registerLlmApiFromProviders(
    [{
      alias: provider.name,
      provider,
      config: { api: 'openai-completions' },
      models: provider.models,
    }],
    (alias) => (alias === provider.name ? provider : resolveProvider?.(alias)),
  );
}

export interface AgentLoopStandaloneCallbacks {
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void;
  onToolResult?: (toolName: string, result: unknown) => void;
}

export interface AgentLoopStandaloneInput {
  provider: AIProvider;
  resolveProvider?: (alias: string) => AIProvider | undefined;
  model: string;
  systemPrompt: string;
  tools: AgentTool[];
  userInput: string | ContentPart[];
  maxIterations: number;
  toolContext: ToolContext;
  transformToolResult?: ToolResultTransform;
  callbacks?: AgentLoopStandaloneCallbacks;
  signal?: AbortSignal;
  /** 默认 true：子 agent / worker 在 direct bash 上下文执行 */
  directExecution?: boolean;
}

export interface AgentLoopStandaloneResult {
  content: string;
  usage: Usage;
  iterations: number;
  model: string;
  toolCalls: ToolCallRecord[];
}

export async function runAgentLoopStandaloneTurn(
  input: AgentLoopStandaloneInput,
): Promise<AgentLoopStandaloneResult> {
  const {
    provider,
    model,
    systemPrompt,
    tools,
    userInput,
    maxIterations,
    toolContext,
    transformToolResult,
    callbacks,
    signal,
    directExecution = true,
  } = input;

  ensureLlmApi(provider, input.resolveProvider);

  const llmModel = getModel(provider.name, model);
  const { repository } = createMemoryContextRepository();
  const sessionId = `standalone:${Date.now()}`;
  const loaded = await repository.loadContext(sessionId);
  const promptMessages = await buildUserMessages(userInput);

  const legacyByName = new Map(tools.map((t) => [t.name, t]));
  const llmTools = convertLegacyTools(tools);
  const toolCalls: ToolCallRecord[] = [];
  let iterations = 0;
  let lastAssistantText = '';
  let lastUsage: TokenUsage | undefined;

  const runTool = async (toolCall: ParsedToolCall) => {
    const legacy = legacyByName.get(toolCall.name);
    if (!legacy) {
      return toolResultToAgentMessage(toolCall, `Unknown tool: ${toolCall.name}`, true);
    }
    try {
      const exec = () => legacy.execute(toolCall.arguments);
      const raw = directExecution
        ? await runWithDirectAgentExecution(toolContext, exec)
        : await runWithBashToolContext(toolContext, exec);
      const rawText = typeof raw === 'string' ? raw : JSON.stringify(raw ?? null);
      const transformed = transformToolResult
        ? await transformToolResult({
            toolName: toolCall.name,
            toolCallId: toolCall.id,
            args: toolCall.arguments,
            result: rawText,
          })
        : rawText;
      const resultText = typeof transformed === 'string' ? transformed : String(transformed);
      toolCalls.push({ tool: toolCall.name, args: toolCall.arguments, result: resultText });
      callbacks?.onToolResult?.(toolCall.name, resultText);
      return toolResultToAgentMessage(toolCall, resultText, false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toolCalls.push({ tool: toolCall.name, args: toolCall.arguments, result: message });
      callbacks?.onToolResult?.(toolCall.name, message);
      return toolResultToAgentMessage(toolCall, message, true);
    }
  };

  const loopContext = agentContextFrom({
    systemPrompt,
    messages: loaded.messages,
    tools: llmTools,
  });

  const loopConfig = {
    model: llmModel,
    maxIterations,
    convertToLlm: (messages: AgentMessage[]) => messages,
    beforeToolCall: async ({ toolCall }: { toolCall: ParsedToolCall }) => {
      callbacks?.onToolCall?.(toolCall.name, toolCall.arguments);
      return undefined;
    },
    executeTool: async (toolCall: ParsedToolCall) => runTool(toolCall),
  };

  for await (const event of agentLoop(promptMessages, loopContext, loopConfig, signal)) {
    if (event.type === 'turn_start') {
      iterations += 1;
    }
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const assistant = event.message as AssistantMessage;
      lastAssistantText = assistantText(assistant);
      if (!lastAssistantText.trim() && assistant.errorMessage) {
        lastAssistantText = `Something went wrong: ${assistant.errorMessage}. Please try again or rephrase your request.`;
      }
      lastUsage = assistant.usage;
    }
    if (event.type === 'agent_end') {
      const userBatch = event.userMessages ?? promptMessages;
      await repository.appendMessages(sessionId, [...userBatch, ...event.messages]);
    }
  }

  const content = sanitizeAssistantReply(lastAssistantText, {
    toolSummary: formatToolCallsForUser(toolCalls),
  });

  logger.debug(formatCompact({
    mode: 'standalone',
    model,
    iterations,
    tool_calls: toolCalls.length,
  }));

  return {
    content,
    usage: lastUsage ? tokenUsageToLegacy(lastUsage) : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    iterations,
    model,
    toolCalls,
  };
}
