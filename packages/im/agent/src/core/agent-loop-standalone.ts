/**
 * Standalone agentLoop runner (subagent / deferred worker) — isolated memory context.
 */
import { formatCompact, getLogger } from '@zhin.js/logger';
import { type AgentTool, type AIProvider, type Usage, type MediaContentBlock, agentLoop, agentContextFrom, assistantText, createUserMessage, createMemoryContextRepository, getLlmTransportModel, agentToolsToLlmTools, registerLlmApiFromProviders, sdkEntryFromProvider, getLoadedToolNamesFromSnapshot, type AgentMessage, type ParsedToolCall, type AssistantMessage, type TokenUsage, type ToolResultTransform, type StreamOptions } from '@zhin.js/ai';
import { runWithCommMessage, runWithDirectAgentExecution } from '../security/comm-message-context.js';
import type { Message } from '../orchestrator/types.js';
import { sanitizeAssistantReply, unwrapJsonStringLayers } from '../core/text-sanitize.js';
import { type ToolCallRecord, formatToolCallsForUser } from '../core/tool-calls-user-format.js';
import type { AgentRunInput } from '../media/media-types.js';
import { type PhaseTraceConfig, logAgentLoopIterationEnd } from '../internal/phase-trace.js';
import {
  getDeferredToolRuntime,
  runWithDeferredToolRuntime,
  TOOLS_MUTATED_MARKER,
} from '../builtin/deferred-tool-meta.js';
import { catalogToolByName } from '../tool-catalog/tool-catalog.js';
import { tokenUsageToLegacy } from './agent-run-shared.js';
import { createToolRuntime } from '../tool/tool-runtime.js';
import { registerBuiltinPolicyExtractors } from '../tool/builtin-policy-extractors.js';
const logger = getLogger('AgentLoopStandalone');

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

function buildUserMessages(input: AgentRunInput): AgentMessage[] {
  if (typeof input === 'string') {
    return [createUserMessage(input)];
  }
  const texts: string[] = [];
  const media: MediaContentBlock[] = [];
  for (const part of input) {
    if (part.type === 'text') {
      if (part.text.trim()) texts.push(part.text);
    } else {
      media.push(part);
    }
  }
  return [createUserMessage(texts.join(' ') || '[多模态消息]', media.length > 0 ? media : undefined)];
}

function ensureLlmApi(provider: AIProvider, resolveProvider?: (alias: string) => AIProvider | undefined): void {
  registerLlmApiFromProviders(
    [sdkEntryFromProvider(provider)],
    (alias) => {
      const p = alias === provider.name ? provider : resolveProvider?.(alias);
      return p?.models ?? [];
    },
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
  userInput: AgentRunInput;
  maxIterations: number;
  commMessage: Message;
  transformToolResult?: ToolResultTransform;
  callbacks?: AgentLoopStandaloneCallbacks;
  signal?: AbortSignal;
  /** Anthropic / OpenAI prompt cache */
  promptCache?: boolean;
  promptCacheKey?: string;
  promptCacheRetention?: 'in_memory' | '24h';
  /** 与 orchestrator 一致的 per-iteration phase trace */
  iterationTrace?: { config: PhaseTraceConfig; sessionId: string; label?: string };
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
    commMessage,
    transformToolResult,
    callbacks,
    signal,
    directExecution = true,
  } = input;

  ensureLlmApi(provider, input.resolveProvider);

  const llmModel = getLlmTransportModel(provider.name, model);
  const { repository } = createMemoryContextRepository();
  const sessionId = `standalone:${Date.now()}`;
  const loaded = await repository.loadContext(sessionId);
  const promptMessages = buildUserMessages(userInput);

  const legacyByName = new Map(tools.map((t) => [t.name, t]));
  let llmTools = agentToolsToLlmTools(tools);

  // 子 agent 专属 deferred runtime：snapshot 从父会话克隆（看得见父已加载工具），
  // 但 load_tool 的变更只活在本 loop（不写回父会话、不落库）。
  const parentDeferred = getDeferredToolRuntime(commMessage);
  const childDeferred = parentDeferred
    ? {
      ...parentDeferred,
      snapshot: structuredClone(parentDeferred.snapshot),
      persistSnapshot: async () => {},
    }
    : undefined;

  /** load_tool 命中后把 catalog 里的完整工具并入可执行集并重建 schema 列表 */
  const reloadDeferredTools = (): void => {
    if (!childDeferred) return;
    const byName = catalogToolByName(childDeferred.catalog);
    for (const name of getLoadedToolNamesFromSnapshot(childDeferred.snapshot)) {
      if (legacyByName.has(name)) continue;
      const item = byName.get(name);
      if (item) legacyByName.set(name, item.fullTool);
    }
    llmTools = agentToolsToLlmTools([...legacyByName.values()]);
  };

  const toolCalls: ToolCallRecord[] = [];
  let iterations = 0;
  let lastAssistantText = '';
  let lastUsage: TokenUsage | undefined;

  registerBuiltinPolicyExtractors();
  const toolRuntime = createToolRuntime({
    generation: 0,
    signal: signal ?? AbortSignal.timeout(600_000),
    sessionId,
    commMessage,
  });

  const runTool = async (toolCall: ParsedToolCall) => {
    const legacy = legacyByName.get(toolCall.name);
    if (!legacy) {
      return toolResultToAgentMessage(toolCall, `Unknown tool: ${toolCall.name}`, true);
    }
    try {
      const exec = () => directExecution
        ? runWithDirectAgentExecution(commMessage, () =>
            toolRuntime.execute(legacy, toolCall.arguments, { toolCallId: toolCall.id }),
          )
        : runWithCommMessage(commMessage, () =>
            toolRuntime.execute(legacy, toolCall.arguments, { toolCallId: toolCall.id }),
          );
      const outcome = await exec();
      if (outcome.denied) {
        toolCalls.push({ tool: toolCall.name, args: toolCall.arguments, result: String(outcome.output) });
        callbacks?.onToolResult?.(toolCall.name, outcome.output);
        return toolResultToAgentMessage(toolCall, outcome.output, true);
      }
      const rawText = typeof outcome.output === 'string' ? outcome.output : JSON.stringify(outcome.output ?? null);
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
      const failure = `工具「${toolCall.name}」执行失败：${message}`;
      toolCalls.push({ tool: toolCall.name, args: toolCall.arguments, result: failure });
      callbacks?.onToolResult?.(toolCall.name, failure);
      return toolResultToAgentMessage(toolCall, failure, true);
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
    streamOptions: {
      promptCache: input.promptCache !== false,
      promptCacheKey: input.promptCacheKey,
      promptCacheRetention: input.promptCacheRetention,
    } satisfies Pick<StreamOptions, 'promptCache' | 'promptCacheKey' | 'promptCacheRetention'>,
    convertToLlm: (messages: AgentMessage[]) => messages,
    beforeToolCall: async ({ toolCall }: { toolCall: ParsedToolCall }) => {
      callbacks?.onToolCall?.(toolCall.name, toolCall.arguments);
      return undefined;
    },
    executeTool: async (toolCall: ParsedToolCall) => runTool(toolCall),
    // 延迟加载：load_tool 命中标记后重建工具集再补全一轮（与主 loop 同一机制）
    ...(childDeferred
      ? {
        refreshTools: async () => {
          reloadDeferredTools();
          return llmTools;
        },
        shouldRecompleteAfterTool: (result: AgentMessage) =>
          result.role === 'toolResult'
          && Array.isArray(result.content)
          && result.content.some(
            (block) => block.type === 'text'
              && typeof block.text === 'string'
              && block.text.includes(TOOLS_MUTATED_MARKER),
          ),
        maxRecompletePerIteration: 1,
      }
      : {}),
  };

  const drive = async (): Promise<void> => {
    for await (const event of agentLoop(promptMessages, loopContext, loopConfig, signal)) {
    if (event.type === 'turn_start') {
      iterations += 1;
    }
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const assistant = event.message as AssistantMessage;
      for (const block of assistant.content) {
        if (block.type === 'text' && block.text) {
          block.text = unwrapJsonStringLayers(block.text);
        }
      }
      lastAssistantText = assistantText(assistant);
      if (!lastAssistantText.trim() && assistant.errorMessage) {
        lastAssistantText = `Something went wrong: ${assistant.errorMessage}. Please try again or rephrase your request.`;
      }
      lastUsage = assistant.usage;
      const trace = input.iterationTrace;
      if (trace) {
        const toolNames = assistant.content
          .filter((b): b is Extract<typeof b, { type: 'toolCall' }> => b.type === 'toolCall')
          .map((b) => b.name)
          .join(',');
        logAgentLoopIterationEnd(trace.config, trace.sessionId, {
          iteration: iterations,
          model,
          label: trace.label ?? 'standalone',
          usage: assistant.usage,
          stopReason: assistant.stopReason,
          toolNames: toolNames || undefined,
        });
      }
    }
    if (event.type === 'agent_end') {
      const userBatch = event.userMessages ?? promptMessages;
      await repository.appendMessages(sessionId, [...userBatch, ...event.messages]);
    }
    }
  };

  // 独立 deferred runtime 下驱动 loop：load_tool 变更不污染父会话
  if (childDeferred) {
    await runWithDeferredToolRuntime(childDeferred, drive);
  } else {
    await drive();
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
