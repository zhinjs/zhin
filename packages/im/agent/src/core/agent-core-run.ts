/**
 * agentLoop turn runner (ADR 0009) — used when ContextRepository is wired.
 */

import { aiOutboundJsonSchema, buildAiOutboundPromptHint } from '@zhin.js/core';
import { formatCompact, truncatePreview, getLogger } from '@zhin.js/logger';
import { type AgentTool, type Usage, agentLoop, agentContextFrom, assistantText, createUserMessage, getLlmTransportModel, agentToolsToLlmTools, type AgentMessage, type ParsedToolCall, type AssistantMessage, type TokenUsage } from '@zhin.js/ai';
import type { AgentRunJournal } from '@zhin.js/ai/agent-stream';
import { tokenUsageToLegacy } from './agent-run-shared.js';
import { applyExecPolicyToTools } from '../security/exec-policy.js';
import { resolveModelHarness } from '../config/model-harness-runtime.js';
import { buildAgentPathSystemPrompt, buildChatPathSystemPrompt, describeAgentPathPromptSections } from '../prompt/assembly.js';
import { logPromptComposition } from '../internal/prompt-trace.js';
import { planToolRun } from '../tool/runtime.js';
import { sanitizeAssistantReply, unwrapJsonStringLayers } from './text-sanitize.js';
import { formatToolCallsForUser, type ToolCallRecord } from './tool-calls-user-format.js';
import { shouldSuppressReplyForSpawnDelegation } from './spawn-delegation.js';
import { transformContextWithCompaction } from '../memory/compaction-runtime.js';
import { logPhase, tokenUsageLogFields, logAgentLoopIterationEnd } from '../internal/phase-trace.js';
import { buildAgentPromptCacheStreamOptions, resolveSkillInstructionMaxChars } from '../config/index.js';
import type { HostPromptTurnHooks } from '../internal/host-types.js';
import type { AgentCore } from './agent-core.js';
import type { ZhinAgentPrivate, OnChunkCallback } from '../internal/agent-host.js';
import { buildLlmToolsForProvider } from '../tool/deferred-resolution.js';
import { applyToolToModelOutput } from '../tool/tool-model-output.js';
import { resolveAlwaysLoadedSet } from '../tool-catalog/resolve-config.js';
import { resolveDeferredApiTools } from '../tool-catalog/tool-catalog.js';
import type { ToolCatalogItem } from '../tool-catalog/types.js';
import type { TurnEvent } from '../event/turn-event.js';
import {
  createTurnEventMapperState,
  mapAgentEventToTurnEvents,
} from './turn-event-mapper.js';
import type { AgentPromptProfile } from '../prompt/turn-prompt-profile.js';
import type { TurnContextView } from '../context/turn-envelope.js';
import type { ToolExecutionAuthority } from './tool-execution-authority.js';
import type { PluginAILoopHookRegistry } from '../plugin-loop-hooks.js';
const logger = getLogger('ZhinAgent:AgentLoopTurn');

/** 入库前解开模型误包的 JSON 字符串，避免下一轮历史继续叠转义。 */
function normalizeAssistantMessageText(assistant: AssistantMessage): void {
  for (const block of assistant.content) {
    if (block.type === 'text' && block.text) {
      block.text = unwrapJsonStringLayers(block.text);
    }
  }
}

function resolveAssistantReplyText(assistant: AssistantMessage): string {
  normalizeAssistantMessageText(assistant);
  const text = assistantText(assistant);
  if (text.trim()) return text;
  if (assistant.errorMessage) {
    return `模型调用失败：${assistant.errorMessage}。请检查 API 密钥与网络后重试。`;
  }
  return text;
}

function logAssistantIterationFailure(
  assistant: AssistantMessage,
  modelId: string,
  sessionId: string,
): void {
  if (assistant.stopReason !== 'error' || !assistant.errorMessage) return;
  logger.warn(formatCompact({
    op: 'llm_error',
    session: sessionId,
    model: modelId,
    error: truncatePreview(assistant.errorMessage, 500),
  }));
}

/** ai.agent.outputSchema 配置 → 传给 LLM 的 JSON Schema（true/'segments' 用 zhin 出站契约）。 */
function resolveAgentOutputSchema(
  value: boolean | 'segments' | Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (value === true || value === 'segments') return aiOutboundJsonSchema;
  return value;
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

export interface AgentLoopTurnInput {
  host: ZhinAgentPrivate;
  core?: AgentCore;
  sessionId: string;
  /** 本轮 user 消息 extra（入库 agent_messages.extra） */
  userMessageExtra?: import('@zhin.js/ai').AgentMessageExtra;
  rawContent: string;
  promptProfile: AgentPromptProfile;
  turnContext: TurnContextView;
  allTools: AgentTool[];
  resolvedTools: AgentTool[];
  toolExecution: ToolExecutionAuthority;
  /** Canonical capability authority journals tool facts itself; classic loops map them. */
  toolEventSource?: 'loop' | 'authority';
  loopHooks?: PluginAILoopHookRegistry;
  promptRuntime?: Readonly<{
    bootstrapContext?: string;
    activeSkillsContext?: string;
    agentNickname?: string;
    modelId?: string;
    providerAlias?: string;
  }>;
  personaEnhanced: string;
  modelId: string;
  modelCandidates: string[];
  onChunk?: OnChunkCallback;
  initialMessages?: AgentMessage[];
  promptHooks?: HostPromptTurnHooks;
  signal?: AbortSignal;
  deferredStats?: string;
  /** Turn-owned deferred selection authority. Required for deferred loading. */
  deferredController?: Readonly<{ loadedToolNames(): string[] }>;
  /** Catalog paired with deferredController for this exact Turn. */
  toolCatalog?: readonly ToolCatalogItem[];
  /** Direct tool sets bypass deferred catalog/snapshot/meta-tool machinery. */
  toolLoading?: 'deferred' | 'direct';
  /** Isolated executions neither load nor append conversational history. */
  conversationPersistence?: 'session' | 'none';
  /** Tool name aliases: LLM-facing name → actual tool name */
  toolAliases?: Record<string, string>;
  /** Optional TurnEvent tap (processStream / diagnostics) */
  onTurnEvent?: (event: TurnEvent) => void;
  /** Ordered public event journal for this stream turn. */
  journal?: AgentRunJournal;
  /**
   * Snapshot generation for ToolRuntime validation.
   * Plugin Runtime hosts pass SnapshotStore / AgentCapabilities.generation;
   * legacy paths keep the `0` placeholder.
   */
  generation?: number;
}

export interface AgentLoopTurnResult {
  reply: string;
  usage: Usage;
  path: 'chat' | 'agent' | 'multimodal';
  iterations: number;
  model: string;
  toolCalls: ToolCallRecord[];
  thinking?: string;
}

export interface AgentLoopVisionTurnInput {
  host: ZhinAgentPrivate;
  core?: AgentCore;
  sessionId: string;
  visionSystemPrompt: string;
  userMessages: AgentMessage[];
  modelCandidates: string[];
  onChunk?: OnChunkCallback;
  promptHooks?: HostPromptTurnHooks;
  signal?: AbortSignal;
  onTurnEvent?: (event: TurnEvent) => void;
}

export type AgentLoopVisionTurnResult = AgentLoopTurnResult & { path: 'multimodal' };

function turnEndFromLegacyUsage(reply: string, usage: Usage): TurnEvent {
  return {
    type: 'turn_end',
    output: reply.trim() ? [{ type: 'text', content: reply }] : [],
    usage: {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    },
  };
}

async function* runAgentLoopVisionTurnOnceRun(
  input: AgentLoopVisionTurnInput & { modelId: string },
): AsyncGenerator<TurnEvent, AgentLoopVisionTurnResult> {
  const { host, sessionId, visionSystemPrompt, modelId, onChunk, promptHooks, signal } = input;
  const repo = host.contextRepository;
  const providerAlias = host.getTurnProvider().name;
  const llmModel = getLlmTransportModel(providerAlias, modelId);
  const loaded = await repo.loadContext(sessionId);
  const promptMessages = input.userMessages;

  let iterations = 0;
  let lastAssistantText = '';
  let lastUsage: TokenUsage | undefined;

  logPhase(host.phaseConfig, 'agent_loop.vision.start', sessionId, { model: modelId });

  const loopContext = agentContextFrom({
    systemPrompt: visionSystemPrompt,
    messages: loaded.messages,
    tools: [],
  });

  const loopConfig = {
    model: llmModel,
    maxIterations: 1,
    streamOptions: buildAgentPromptCacheStreamOptions(host.config, {
      modelSdk: llmModel.sdk,
      provider: providerAlias,
      modelId,
      label: 'vision',
    }),
    convertToLlm: (messages: AgentMessage[]) => messages,
    getSteeringMessages: promptHooks?.getSteeringMessages,
    getFollowUpMessages: promptHooks?.getFollowUpMessages,
  };

  const mapperState = createTurnEventMapperState();

  const emitTurnEvent = (event: TurnEvent) => {
    input.onTurnEvent?.(event);
  };

  for await (const event of agentLoop(promptMessages, loopContext, loopConfig, signal)) {
    for (const te of mapAgentEventToTurnEvents(event, mapperState)) {
      emitTurnEvent(te);
      yield te;
    }
    if (event.type === 'turn_start') {
      iterations += 1;
    }
    if (event.type === 'message_update' && event.delta?.type === 'text_delta') {
      onChunk?.(event.delta.text, lastAssistantText + event.delta.text);
    }
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const assistant = event.message as AssistantMessage;
      lastAssistantText = resolveAssistantReplyText(assistant);
      lastUsage = assistant.usage;
      logAssistantIterationFailure(assistant, modelId, sessionId);
      const toolNames = assistant.content
        .filter((b): b is Extract<typeof b, { type: 'toolCall' }> => b.type === 'toolCall')
        .map((b) => b.name)
        .join(',');
      logAgentLoopIterationEnd(host.phaseConfig, sessionId, {
        iteration: iterations,
        model: modelId,
        label: 'vision',
        usage: assistant.usage,
        stopReason: assistant.stopReason,
        toolNames: toolNames || undefined,
      });
      onChunk?.(lastAssistantText, lastAssistantText);
    }
    if (event.type === 'agent_end') {
      if (signal?.aborted) continue;
      const userBatch = event.userMessages ?? promptMessages;
      await repo.appendMessages(sessionId, [...userBatch, ...event.messages]);
    }
  }

  if (signal?.aborted) {
    const usage = lastUsage ? tokenUsageToLegacy(lastUsage) : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const endEvent = turnEndFromLegacyUsage('', usage);
    emitTurnEvent(endEvent);
    yield endEvent;
    return {
      reply: '',
      usage,
      path: 'multimodal',
      iterations,
      model: modelId,
      toolCalls: [],
    };
  }

  const reply = sanitizeAssistantReply(lastAssistantText);
  if (!reply.trim()) {
    throw new Error('Empty vision model response');
  }

  logPhase(host.phaseConfig, 'agent_loop.vision.end', sessionId, {
    iterations,
    ...tokenUsageLogFields(lastUsage),
  });

  const usage = lastUsage ? tokenUsageToLegacy(lastUsage) : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const endEvent = turnEndFromLegacyUsage(reply, usage);
  emitTurnEvent(endEvent);
  yield endEvent;
  return {
    reply,
    usage,
    path: 'multimodal',
    iterations,
    model: modelId,
    toolCalls: [],
  };
}

export async function* runAgentLoopVisionTurnRun(
  input: AgentLoopVisionTurnInput,
): AsyncGenerator<TurnEvent, AgentLoopVisionTurnResult> {
  const candidates = input.modelCandidates.filter(Boolean);
  if (candidates.length === 0) {
    throw new Error('No vision model candidates configured');
  }

  let lastError: Error | undefined;
  for (let i = 0; i < candidates.length; i++) {
    const modelId = candidates[i]!;
    try {
      return yield* runAgentLoopVisionTurnOnceRun({ ...input, modelId });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isLast = i === candidates.length - 1;
      if (isLast) break;
      logger.warn(formatCompact({
        mode: 'multimodal',
        fallback: `${modelId}→${candidates[i + 1]}`,
        error: lastError.message.slice(0, 120),
      }));
    }
  }
  throw lastError ?? new Error('All vision model candidates failed');
}

export async function collectAgentLoopTurnRun<R>(
  gen: AsyncGenerator<TurnEvent, R>,
  onTurnEvent?: (event: TurnEvent) => void,
): Promise<R> {
  while (true) {
    const step = await gen.next();
    if (step.done) return step.value;
    onTurnEvent?.(step.value);
  }
}

export async function* runAgentLoopTextTurnRun(
  input: AgentLoopTurnInput,
): AsyncGenerator<TurnEvent, AgentLoopTurnResult> {
  const {
    host,
    sessionId,
    userMessageExtra,
    allTools,
    resolvedTools,
    personaEnhanced,
    modelId,
    onChunk,
    promptHooks,
    signal,
  } = input;

  const repo = host.contextRepository;

  const providerAlias = host.getTurnProvider().name;
  const llmModel = getLlmTransportModel(providerAlias, modelId);
  const persistentConversation = input.conversationPersistence !== 'none';
  const loaded = persistentConversation
    ? await repo.loadContext(sessionId)
    : { messages: [] as AgentMessage[] };
  const promptMessages = input.initialMessages?.length
    ? input.initialMessages
    : [createUserMessage(input.rawContent)];

  const directTools = input.toolLoading === 'direct';
  const hasTools = directTools ? resolvedTools.length > 0 : allTools.length > 0;
  const toolRun = hasTools && !directTools
    ? await planToolRun(resolvedTools, host.config.preExecTimeout)
    : { mode: 'agent' as const, preExecution: { tools: [], data: '' } };

  const preData = toolRun.preExecution.data;
  const outputSchema = resolveAgentOutputSchema(host.config.outputSchema);
  let systemPrompt = hasTools
    ? await buildAgentPathSystemPrompt(host, {
        profile: input.promptProfile,
        turn: input.turnContext,
        content: input.rawContent,
        sessionId,
        personaEnhanced,
        preData,
      deferredStats: input.deferredStats,
      modelSdk: llmModel.sdk,
      runtime: input.promptRuntime,
      })
    : buildChatPathSystemPrompt(host, personaEnhanced, input.promptProfile);
  if (outputSchema) {
    systemPrompt = `${systemPrompt}\n\n${buildAiOutboundPromptHint({})}`;
  }

  const agentTools = hasTools
    ? applyExecPolicyToTools(host.config, resolvedTools, {
        approvalMode: host.config.execApprovalMode,
      })
    : [];

  const deferredController = directTools ? undefined : input.deferredController;
  const catalog = directTools ? [] : [...(input.toolCatalog ?? [])];
  if (!directTools && hasTools && (!deferredController || catalog.length === 0)) {
    throw new Error('Deferred tool loading requires a turn-owned controller and catalog');
  }

  const refreshResolvedTools = () => {
    if (directTools) return resolvedTools;
    const alwaysLoaded = resolveAlwaysLoadedSet(host.config);
    const loaded = deferredController!.loadedToolNames();
    return resolveDeferredApiTools(catalog, alwaysLoaded, loaded);
  };

  if (hasTools) {
    const sections = input.promptProfile.kind === 'interactive'
      ? await describeAgentPathPromptSections(host, {
          turn: input.turnContext,
          content: input.rawContent,
          sessionId,
          deferredStats: input.deferredStats,
          modelSdk: llmModel.sdk,
          runtime: input.promptRuntime,
        })
      : [];
    logPromptComposition({
      config: host.promptTraceConfig,
      sessionId,
      label: 'orchestrator',
      systemPrompt,
      sections,
      historyMessages: loaded.messages,
      tools: agentTools,
      userPreview: input.rawContent,
    });
  } else {
    logPromptComposition({
      config: host.promptTraceConfig,
      sessionId,
      label: 'chat',
      systemPrompt,
      historyMessages: loaded.messages,
      tools: [],
      userPreview: input.rawContent,
    });
  }

  const harness = resolveModelHarness(host.getTurnProvider().name, modelId, host.config.modelHarness);
  const maxIterations = hasTools
    ? (harness.maxIterations ?? host.config.maxIterations)
    : 1;

  const legacyByName = new Map(agentTools.map((t) => [t.name, t]));
  let llmTools = directTools
    ? agentToolsToLlmTools(agentTools)
    : buildLlmToolsForProvider(
        llmModel.sdk,
        catalog,
        agentTools,
        resolveAlwaysLoadedSet(host.config),
        deferredController?.loadedToolNames() ?? [],
      );
  const toolCalls: ToolCallRecord[] = [];
  let iterations = 0;
  let lastAssistantText = '';
  let lastUsage: TokenUsage | undefined;

  logPhase(host.phaseConfig, 'agent_loop.turn.start', sessionId, {
    model: modelId,
    maxIterations,
    toolCount: agentTools.length,
  });

  const loopContext = agentContextFrom({
    systemPrompt,
    messages: loaded.messages,
    tools: llmTools,
  });

  const rebuildLlmTools = () => {
    const nextAgentTools = applyExecPolicyToTools(host.config, refreshResolvedTools(), {
      approvalMode: host.config.execApprovalMode,
    });
    legacyByName.clear();
    for (const t of nextAgentTools) legacyByName.set(t.name, t);
    llmTools = directTools
      ? agentToolsToLlmTools(nextAgentTools)
      : buildLlmToolsForProvider(
          llmModel.sdk,
          catalog,
          nextAgentTools,
          resolveAlwaysLoadedSet(host.config),
          deferredController?.loadedToolNames() ?? [],
        );
    return llmTools;
  };

  const contextWindow = llmModel.contextWindow ?? host.config.contextTokens;
  const loopHooks = input.loopHooks;

  const loopConfig = {
    model: llmModel,
    maxIterations,
    sessionId,
    streamOptions: {
      ...buildAgentPromptCacheStreamOptions(host.config, {
        modelSdk: llmModel.sdk,
        provider: providerAlias,
        modelId,
        label: hasTools ? 'orchestrator' : 'chat',
      }),
      ...(outputSchema ? { outputSchema } : {}),
    },
    convertToLlm: (messages: AgentMessage[]) => messages,
    transformContext: async (messages: AgentMessage[], ctxSignal?: AbortSignal) =>
      persistentConversation ? transformContextWithCompaction(messages, ctxSignal, {
        host,
        sessionId,
        model: llmModel,
        compactionConfig: host.config.compaction,
        contextWindow,
        mode: 'text',
        loopHooks,
      }) : messages,
    onContextOverflow: async (messages: AgentMessage[], ctxSignal?: AbortSignal) =>
      persistentConversation ? transformContextWithCompaction(messages, ctxSignal, {
        host,
        sessionId,
        model: llmModel,
        compactionConfig: host.config.compaction,
        contextWindow,
        mode: 'text',
        force: true,
        loopHooks,
      }) : messages,
    getSteeringMessages: promptHooks?.getSteeringMessages,
    getFollowUpMessages: promptHooks?.getFollowUpMessages,
    executeTool: async (toolCall: ParsedToolCall, _tools: typeof llmTools, toolSignal?: AbortSignal) => {
      const hookRegistry = host.orchestrator?.hooks;
      const currentAliases = input.toolAliases;
      const resolvedName = currentAliases?.[toolCall.name] ?? toolCall.name;
      let effectiveArgs = toolCall.arguments;

      // PreToolUse interception
      if (hookRegistry) {
        const preDecision = await hookRegistry.triggerPreToolUse({
          type: 'preToolUse',
          toolName: resolvedName,
          toolInput: effectiveArgs,
          toolSource: legacyByName.get(resolvedName)?.source,
          sessionId,
          turn: input.turnContext,
        });
        if (preDecision.decision === 'deny') {
          const reason = preDecision.reason;
          toolCalls.push({ tool: resolvedName, args: effectiveArgs, result: reason });
          return toolResultToAgentMessage(toolCall, reason, true);
        }
        if (preDecision.decision === 'modify') {
          effectiveArgs = preDecision.modifiedInput;
        }
      }

      const legacy = legacyByName.get(resolvedName);
      if (!legacy) {
        return toolResultToAgentMessage(toolCall, `工具「${resolvedName}」执行失败：工具不存在或所属插件未启用。`, true);
      }

      try {
        const outcome = await input.toolExecution.execute(legacy, effectiveArgs, toolCall.id);
        if (outcome.status !== 'completed') {
          const reason = outcome.status === 'failed' ? outcome.error : outcome.reason;
          toolCalls.push({ tool: resolvedName, args: effectiveArgs, result: reason });
          return toolResultToAgentMessage(toolCall, reason, true);
        }
        const rawText = await applyToolToModelOutput(legacy, outcome.output, effectiveArgs);

        // PostToolUse interception
        let resultText = rawText;
        if (hookRegistry) {
          const postDecision = await hookRegistry.triggerPostToolUse({
            type: 'postToolUse',
            toolName: resolvedName,
            toolInput: effectiveArgs,
            toolOutput: rawText,
            durationMs: outcome.durationMs,
            sessionId,
            turn: input.turnContext,
          });
          if (postDecision.decision === 'reject') {
            toolCalls.push({ tool: resolvedName, args: effectiveArgs, result: postDecision.reason });
            return toolResultToAgentMessage(toolCall, postDecision.reason, true);
          }
          if (postDecision.decision === 'modify') {
            resultText = typeof postDecision.modifiedOutput === 'string'
              ? postDecision.modifiedOutput
              : JSON.stringify(postDecision.modifiedOutput);
          }
        }

        const finalText = resultText;
        toolCalls.push({ tool: resolvedName, args: effectiveArgs, result: finalText });
        return toolResultToAgentMessage(toolCall, finalText, false);
      } catch (err) {
        if (signal?.aborted) {
          throw signal.reason instanceof Error ? signal.reason : new Error('Tool execution cancelled');
        }
        const message = err instanceof Error ? err.message : String(err);
        const failure = `工具「${resolvedName}」执行失败：${message}`;
        toolCalls.push({ tool: resolvedName, args: effectiveArgs, result: failure });
        return toolResultToAgentMessage(toolCall, failure, true);
      }
    },
    beforeToolCall: async ({ toolCall }: { toolCall: ParsedToolCall }) =>
      loopHooks?.runBeforeToolCall({ toolCall, sessionId }),
    afterToolCall: async ({ toolCall, result }: { toolCall: ParsedToolCall; result: AgentMessage }) => {
      await loopHooks?.runAfterToolCall({ toolCall, result, sessionId });
    },
    refreshTools: hasTools ? () => rebuildLlmTools() : undefined,
    shouldRecompleteAfterTool: (result: AgentMessage) => {
      if (result.role !== 'toolResult' || !Array.isArray(result.content)) return false;
      return result.content.some(
        (block) =>
          block.type === 'text'
          && typeof block.text === 'string'
          && block.text.includes('__zhin_tools_mutated__'),
      );
    },
    maxRecompletePerIteration: 1,
    toolExecution: host.config.toolExecution ?? 'tiered',
  };

  const mapperState = createTurnEventMapperState();

  const emitTurnEvent = (event: TurnEvent) => {
    input.onTurnEvent?.(event);
  };

  for await (const event of agentLoop(promptMessages, loopContext, loopConfig, signal)) {
    for (const te of mapAgentEventToTurnEvents(event, mapperState)) {
      if (input.toolEventSource === 'authority'
        && (te.type === 'tool_call' || te.type === 'tool_result')) continue;
      emitTurnEvent(te);
      yield te;
    }
    if (event.type === 'turn_start') {
      iterations += 1;
    }
    if (event.type === 'message_update' && event.delta?.type === 'text_delta') {
      onChunk?.(event.delta.text, lastAssistantText + event.delta.text);
    }
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const assistant = event.message as AssistantMessage;
      lastAssistantText = resolveAssistantReplyText(assistant);
      lastUsage = assistant.usage;
      logAssistantIterationFailure(assistant, modelId, sessionId);
      const toolNames = assistant.content
        .filter((b): b is Extract<typeof b, { type: 'toolCall' }> => b.type === 'toolCall')
        .map((b) => b.name)
        .join(',');
      logAgentLoopIterationEnd(host.phaseConfig, sessionId, {
        iteration: iterations,
        model: modelId,
        label: hasTools ? 'orchestrator' : 'chat',
        usage: assistant.usage,
        stopReason: assistant.stopReason,
        toolNames: toolNames || undefined,
      });
      onChunk?.(lastAssistantText, lastAssistantText);
    }
    if (event.type === 'agent_end') {
      if (signal?.aborted) continue;
      const userBatch = event.userMessages ?? promptMessages;
      const batch = [...userBatch, ...event.messages];
      const messageExtras = batch.map((msg, i) => (
        msg.role === 'user' && i < userBatch.length ? userMessageExtra : undefined
      ));
      if (persistentConversation) {
        await repo.appendMessages(sessionId, batch, { messageExtras });
      }
    }
  }

  if (signal?.aborted) {
    const usage = lastUsage ? tokenUsageToLegacy(lastUsage) : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const endEvent = turnEndFromLegacyUsage('', usage);
    emitTurnEvent(endEvent);
    yield endEvent;
    const thinking = mapperState.accumulatedThinking.trim() || undefined;
    return {
      reply: '',
      usage,
      path: hasTools ? 'agent' : 'chat',
      iterations,
      model: modelId,
      toolCalls,
      thinking,
    };
  }

  const reply = sanitizeAssistantReply(lastAssistantText, {
    toolSummary: formatToolCallsForUser(toolCalls),
  });

  const spawnedSubagent = toolCalls.some(tc => tc.tool === 'spawn_task');
  if (spawnedSubagent) {
    await host.getActiveTurnTracker()?.waitForPendingSubagents();
  }
  const delegatedOnly = shouldSuppressReplyForSpawnDelegation(toolCalls)
    && !toolCalls.some(tc => tc.tool === 'run_deferred_task')
    && !toolCalls.some(tc =>
      tc.tool === 'generate_image'
      && tc.result
      && typeof tc.result === 'object'
      && typeof (tc.result as Record<string, unknown>).image === 'string',
    );
  const finalReply = delegatedOnly ? '' : reply;

  logPhase(host.phaseConfig, 'agent_loop.turn.end', sessionId, {
    iterations,
    ...tokenUsageLogFields(lastUsage),
  });

  const usage = lastUsage ? tokenUsageToLegacy(lastUsage) : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const endEvent = turnEndFromLegacyUsage(finalReply, usage);
  emitTurnEvent(endEvent);
  yield endEvent;
  const thinking = mapperState.accumulatedThinking.trim() || undefined;
  return {
    reply: finalReply,
    usage,
    path: hasTools ? 'agent' : 'chat',
    iterations,
    model: modelId,
    toolCalls,
    thinking,
  };
}
