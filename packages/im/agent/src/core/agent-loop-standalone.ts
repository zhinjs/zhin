/**
 * Standalone agentLoop runner (subagent / deferred worker) — isolated memory context.
 */
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { ToolInvocationPolicy } from '@zhin.js/tool';
import {
  BASH_TOOL_NAME,
  turnPolicyAllowsShell,
  withoutForbiddenShell,
} from '../plugin-runtime/native-bash-tool.js';
import { type AgentTool, type AIProvider, type Usage, type MediaContentBlock, agentLoop, agentContextFrom, assistantText, createUserMessage, createMemoryContextRepository, agentToolsToLlmTools, createLlmApiRuntime, sdkEntryFromProvider, type LlmApiRuntime, type AgentMessage, type ParsedToolCall, type AssistantMessage, type TokenUsage, type ToolResultTransform, type StreamOptions } from '@zhin.js/ai';
import { runWithCommMessage, runWithDirectAgentExecution } from '../security/comm-message-context.js';
import type { Message } from '../resource-hub/types.js';
import { sanitizeAssistantReply, unwrapJsonStringLayers } from '../core/text-sanitize.js';
import { type ToolCallRecord, formatToolCallsForUser } from '../core/tool-calls-user-format.js';
import type { AgentRunInput } from '../media/media-types.js';
import { type PhaseTraceConfig, logAgentLoopIterationEnd } from '../internal/phase-trace.js';
import {
  getActiveDeferredTurnController,
  runWithDeferredTurnController,
  TOOLS_MUTATED_MARKER,
} from '../tool-catalog/deferred-turn-controller.js';
import { ToolRuntime } from '../tool/tool-runtime.js';
import { resolveBuiltinToolPolicyInput } from '../tool/builtin-policy-extractors.js';
import { ExecutableToolRegistry } from '../tool/executable-tool-registry.js';
import type { ImageAssetPublisher } from '../media/image-assets.js';
import { publishReplyImages } from '../media/publish-image-reply.js';
import { LocalImageInspection } from '../media/local-image-inspection.js';
import { localImageScopeFromMessage, type LocalImageAssetStore, type LocalImageScope } from '../media/local-image-assets.js';
import { DEFAULT_PERCEPTION_SETTINGS, type MediaPerceptionPort } from '../media/perception.js';
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

function createStandaloneLlmRuntime(
  provider: AIProvider,
  resolveProvider?: (alias: string) => AIProvider | undefined,
): LlmApiRuntime {
  return createLlmApiRuntime(
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
  llmRuntime?: LlmApiRuntime;
  imageAssets?: ImageAssetPublisher;
  localAssets?: LocalImageAssetStore;
  localAssetScope?: LocalImageScope;
  mediaPerception?: MediaPerceptionPort;
  model: string;
  systemPrompt: string;
  tools: AgentTool[];
  userInput: AgentRunInput;
  maxIterations: number;
  /** Optional authenticated IM context. Its absence must remain fail-closed. */
  commMessage?: Message;
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
  /**
   * Parent Turn policy, when the caller has one. Without a shell policy bash is
   * neither offered nor loadable, matching the main agent loop.
   */
  turnPolicy?: Pick<ToolInvocationPolicy, 'shell' | 'filesystem'>;
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
  signal?.throwIfAborted();

  const llmRuntime = input.llmRuntime
    ?? createStandaloneLlmRuntime(provider, input.resolveProvider);
  const llmModel = llmRuntime.model(provider.name, model);
  const { repository } = createMemoryContextRepository();
  const sessionId = `standalone:${Date.now()}`;
  const assetScope = input.localAssetScope ?? localImageScopeFromMessage(commMessage, sessionId);
  let inspectionUsage: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const localInspection = input.localAssets && assetScope ? new LocalImageInspection(input.localAssets, assetScope,
    { remaining: (input.mediaPerception?.maxItemsPerTurn ?? DEFAULT_PERCEPTION_SETTINGS.maxItemsPerTurn)
      - (typeof userInput === 'string' ? 0 : userInput.filter(part => part.type === 'image').length) }, input.mediaPerception,
    usage => { inspectionUsage = { prompt_tokens: inspectionUsage.prompt_tokens + usage.prompt_tokens,
      completion_tokens: inspectionUsage.completion_tokens + usage.completion_tokens, total_tokens: inspectionUsage.total_tokens + usage.total_tokens }; },
  ) : undefined;
  const loaded = await repository.loadContext(sessionId);
  const promptMessages = buildUserMessages(userInput);

  // 子 agent 持有父 turn controller 的隔离 fork；加载只活在本 loop。
  const childDeferred = getActiveDeferredTurnController()?.fork();
  const shellAllowed = input.turnPolicy === undefined || turnPolicyAllowsShell(input.turnPolicy);
  const offered = shellAllowed ? tools : withoutForbiddenShell(input.turnPolicy, tools);
  const initialTools = childDeferred
    ? [...offered.filter(tool => !childDeferred.tools.some(meta => meta.name === tool.name)), ...childDeferred.tools as unknown as AgentTool[]]
    : [...offered];
  if (input.localAssets && assetScope && !initialTools.some(tool => tool.name === 'get_local_assets')) {
    initialTools.push({ name: 'get_local_assets', description: 'Inspect one private MCP image by asset_id in this conversation; never publish it.',
      parameters: { type: 'object', properties: { asset_id: { type: 'string' } }, required: ['asset_id'] }, source: 'builtin',
      execute: args => input.localAssets!.inspect(String(args.asset_id), assetScope, signal) });
  }
  const executableTools = new ExecutableToolRegistry(initialTools);
  let llmTools = agentToolsToLlmTools(initialTools);

  /** load_tool 命中后把 catalog 里的完整工具并入可执行集并重建 schema 列表 */
  const reloadDeferredTools = (): void => {
    if (!childDeferred) return;
    for (const name of childDeferred.loadedToolNames()) {
      if (!shellAllowed && name === BASH_TOOL_NAME) continue;
      const tool = childDeferred.tool(name);
      if (tool) executableTools.addMissing([tool]);
    }
    llmTools = agentToolsToLlmTools(executableTools.list());
  };

  const toolCalls: ToolCallRecord[] = [];
  let iterations = 0;
  let lastAssistantText = '';
  let lastUsage: TokenUsage | undefined;

  const toolRuntime = new ToolRuntime({
    localAssets: input.localAssets,
    localAssetScope: assetScope,
    generation: 0,
    signal: signal ?? AbortSignal.timeout(600_000),
    sessionId,
    commMessage,
    policyInputResolver: resolveBuiltinToolPolicyInput,
  });

  const runTool = async (toolCall: ParsedToolCall) => {
    const tool = executableTools.resolve(toolCall.name);
    if (!tool) {
      return toolResultToAgentMessage(toolCall, `Unknown tool: ${toolCall.name}`, true);
    }
    try {
      const exec = () => directExecution
        ? runWithDirectAgentExecution(commMessage, () =>
            toolRuntime.execute(tool, toolCall.arguments, { toolCallId: toolCall.id }),
          )
        : runWithCommMessage(commMessage, () =>
            toolRuntime.execute(tool, toolCall.arguments, { toolCallId: toolCall.id }),
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
      const resultText = transformed === rawText
        ? localInspection?.accept(outcome.output) ?? rawText
        : typeof transformed === 'string' ? transformed : String(transformed);
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

  const requestRuntime = localInspection ? localInspection.wrap(llmRuntime) : llmRuntime;
  const loopConfig = {
    model: llmModel,
    transport: input.imageAssets ? {
      complete: async (...args: Parameters<typeof llmRuntime.complete>) =>
        publishReplyImages(await requestRuntime.complete(...args), input.imageAssets!, args[2]?.signal),
      completeSimple: async (...args: Parameters<typeof llmRuntime.completeSimple>) =>
        publishReplyImages(await requestRuntime.completeSimple(...args), input.imageAssets!, args[2]?.signal),
    } : requestRuntime,
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

  // 独立 controller 下驱动 loop：load_tool 变更不污染父 turn。
  const pending = childDeferred
    ? runWithDeferredTurnController(childDeferred, drive)
    : drive();
  await (signal ? raceAbort(pending, signal) : pending);

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
    usage: { prompt_tokens: (lastUsage?.input ?? 0) + inspectionUsage.prompt_tokens,
      completion_tokens: (lastUsage?.output ?? 0) + inspectionUsage.completion_tokens,
      total_tokens: (lastUsage?.totalTokens ?? 0) + inspectionUsage.total_tokens },
    iterations,
    model,
    toolCalls,
  };
}

async function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return await new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(
      signal.reason ?? new DOMException('Standalone Agent cancelled', 'AbortError'),
    );
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
