/**
 * agentLoop turn runner (ADR 0009) — used when ContextRepository is wired.
 */

import type { Plugin } from '@zhin.js/core';
import type { AIService } from '../service.js';
import { formatCompact, Logger, truncatePreview } from '@zhin.js/logger';
import type { AgentTool, Usage } from '@zhin.js/ai';
import {
  agentLoop,
  agentContextFrom,
  assistantText,
  createUserMessage,
  getLlmTransportModel,
  agentToolsToLlmTools,
  type AgentMessage,
  type ParsedToolCall,
  type AssistantMessage,
  type TokenUsage,
} from '@zhin.js/ai';
import { runWithCommMessage } from '../security/comm-message-context.js';
import { applyExecPolicyToTools } from '../security/exec-policy.js';
import { createOwnerOrchestratedToolResultTransform } from '../orchestrator/owner-confirm-orchestration.js';
import { resolveModelHarness } from '../config/model-harness-runtime.js';
import { buildAgentPathSystemPrompt, buildChatPathSystemPrompt, describeAgentPathPromptSections } from '../prompt/assembly.js';
import { logPromptComposition } from '../internal/prompt-trace.js';
import { planToolRun } from '../tool/runtime.js';
import { sanitizeAssistantReply } from './text-sanitize.js';
import { formatToolCallsForUser, type ToolCallRecord } from './tool-calls-user-format.js';
import { transformContextWithCompaction } from '../memory/compaction-runtime.js';
import { logPhase, tokenUsageLogFields, logAgentLoopIterationEnd } from '../internal/phase-trace.js';
import { buildAgentPromptCacheStreamOptions, resolveSkillInstructionMaxChars } from '../config/index.js';
import type { HostPromptTurnHooks } from '../internal/host-types.js';
import type { AgentCore } from './agent-core.js';
import type { ZhinAgentPrivate, OnChunkCallback, Message } from '../internal/agent-host.js';
import { bindDeferredToolRuntime } from '../builtin/deferred-tool-meta.js';
import { persistDeferredToolSnapshot, buildLlmToolsForProvider } from '../tool/deferred-resolution.js';
import { resolveDeferredToolsConfig, resolveAlwaysLoadedSet } from '../tool-catalog/resolve-config.js';
import { resolveDeferredApiTools } from '../tool-catalog/tool-catalog.js';
import { getLoadedToolNamesFromSnapshot } from '@zhin.js/ai';
import { buildSkillLoadOptsForAgent } from '../skill/skill-load-opts.js';
import type { TurnEvent } from '../event/turn-event.js';
import {
  createTurnEventMapperState,
  mapAgentEventToTurnEvents,
} from './turn-event-mapper.js';

const logger = new Logger(null, 'ZhinAgent:AgentLoopTurn');

function resolveAssistantReplyText(assistant: AssistantMessage): string {
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

function resolveAIService(plugin?: Plugin): AIService | undefined {
  if (!plugin) return undefined;
  try {
    return plugin.inject?.('ai') as AIService | undefined;
  } catch {
    return undefined;
  }
}

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

export interface AgentLoopTurnInput {
  host: ZhinAgentPrivate;
  core?: AgentCore;
  sessionId: string;
  /** 本轮 user 消息 extra（入库 agent_messages.extra） */
  userMessageExtra?: import('@zhin.js/ai').AgentMessageExtra;
  rawContent: string;
  commMessage: Message;
  contextForTools: Message;
  allTools: AgentTool[];
  resolvedTools: AgentTool[];
  personaEnhanced: string;
  modelId: string;
  modelCandidates: string[];
  onChunk?: OnChunkCallback;
  initialMessages?: AgentMessage[];
  promptHooks?: HostPromptTurnHooks;
  signal?: AbortSignal;
  deferredStats?: string;
  /** Tool name aliases: LLM-facing name → actual tool name */
  toolAliases?: Record<string, string>;
  /** Optional TurnEvent tap (processStream / diagnostics) */
  onTurnEvent?: (event: TurnEvent) => void;
}

export interface AgentLoopTurnResult {
  reply: string;
  usage: Usage;
  path: 'chat' | 'agent' | 'multimodal';
  iterations: number;
  model: string;
  toolCalls: ToolCallRecord[];
}

export interface AgentLoopVisionTurnInput {
  host: ZhinAgentPrivate;
  core?: AgentCore;
  sessionId: string;
  commMessage: Message;
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
  const { host, sessionId, commMessage, visionSystemPrompt, modelId, onChunk, promptHooks, signal } = input;
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
    commMessage,
    contextForTools,
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
  const loaded = await repo.loadContext(sessionId);
  const promptMessages = input.initialMessages?.length
    ? input.initialMessages
    : [createUserMessage(input.rawContent)];

  const toolRun = allTools.length > 0
    ? await planToolRun(resolvedTools, host.config.preExecTimeout)
    : { mode: 'agent' as const, preExecution: { tools: [], data: '' } };

  const preData = toolRun.preExecution.data;
  const hasTools = allTools.length > 0;
  const systemPrompt = hasTools
    ? await buildAgentPathSystemPrompt(host, {
        content: input.rawContent,
        commMessage: contextForTools,
        sessionId,
        personaEnhanced,
        preData,
        deferredStats: input.deferredStats,
        modelSdk: llmModel.sdk,
      })
    : buildChatPathSystemPrompt(host, personaEnhanced, contextForTools);

  const agentTools = hasTools
    ? applyExecPolicyToTools(host.config, resolvedTools, {
        approvalMode: host.config.execApprovalMode,
      })
    : [];

  let sessionSnapshot = host.lastDeferredSessionSnapshot ?? { loadedTools: {}, loadedSkills: [] };
  const catalog = host.lastDeferredCatalog ?? [];
  const deferredCfg = resolveDeferredToolsConfig(host.config);

  if (hasTools && catalog.length > 0) {
    const skillLoadOpts = buildSkillLoadOptsForAgent(host);
    bindDeferredToolRuntime(contextForTools, {
      sessionId,
      catalog,
      skillRegistry: host.skillRegistry,
      snapshot: sessionSnapshot,
      maxLoadedPerSession: deferredCfg.maxLoadedPerSession,
      discoverTopK: deferredCfg.discoverTopK,
      persistSnapshot: async (snap) => {
        sessionSnapshot = snap;
        host.lastDeferredSessionSnapshot = snap;
        await persistDeferredToolSnapshot(host, sessionId, snap);
      },
      onSkillLoaded: (_name, instructions) => {
        host.appendActiveSkillsContext(instructions);
      },
      skillLoadOpts,
    });
  }

  const refreshResolvedTools = () => {
    const alwaysLoaded = resolveAlwaysLoadedSet(host.config);
    const loaded = getLoadedToolNamesFromSnapshot(sessionSnapshot);
    return resolveDeferredApiTools(catalog, alwaysLoaded, loaded);
  };

  if (hasTools) {
    const sections = await describeAgentPathPromptSections(host, {
      commMessage: contextForTools,
      content: input.rawContent,
      sessionId,
      deferredStats: input.deferredStats,
      modelSdk: llmModel.sdk,
    });
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

  const orchestrationPlugin = host.emitter.getHostPlugin() ?? undefined;
  if (!orchestrationPlugin) {
    logger.warn(formatCompact({ warn: 'no_host_plugin' }));
  }

  const transformToolResult = createOwnerOrchestratedToolResultTransform({
    commMessage: contextForTools,
    disableHardOrchestration: false,
    plugin: orchestrationPlugin,
  });

  const legacyByName = new Map(agentTools.map((t) => [t.name, t]));
  let llmTools = buildLlmToolsForProvider(
    llmModel.sdk,
    catalog,
    agentTools,
    resolveAlwaysLoadedSet(host.config),
    getLoadedToolNamesFromSnapshot(sessionSnapshot),
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

  if (hasTools) {
    await host.emitter.dispatch('ai.agent.start', host.emitter.createPayload(sessionId, contextForTools, 'text', {
      path: 'agent',
      model: modelId,
    }));
  }

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
    llmTools = buildLlmToolsForProvider(
      llmModel.sdk,
      catalog,
      nextAgentTools,
      resolveAlwaysLoadedSet(host.config),
      getLoadedToolNamesFromSnapshot(sessionSnapshot),
    );
    return llmTools;
  };

  const contextWindow = llmModel.contextWindow ?? host.config.contextTokens;
  const aiService = resolveAIService(orchestrationPlugin);
  const loopHooks = aiService?.loopHooks;

  const loopConfig = {
    model: llmModel,
    maxIterations,
    sessionId,
    streamOptions: buildAgentPromptCacheStreamOptions(host.config, {
      modelSdk: llmModel.sdk,
      provider: providerAlias,
      modelId,
      label: hasTools ? 'orchestrator' : 'chat',
    }),
    convertToLlm: (messages: AgentMessage[]) => messages,
    transformContext: async (messages: AgentMessage[], ctxSignal?: AbortSignal) =>
      transformContextWithCompaction(messages, ctxSignal, {
        host,
        sessionId,
        commMessage: contextForTools,
        model: llmModel,
        compactionConfig: host.config.compaction,
        contextWindow,
        mode: 'text',
        loopHooks,
      }),
    onContextOverflow: async (messages: AgentMessage[], ctxSignal?: AbortSignal) =>
      transformContextWithCompaction(messages, ctxSignal, {
        host,
        sessionId,
        commMessage: contextForTools,
        model: llmModel,
        compactionConfig: host.config.compaction,
        contextWindow,
        mode: 'text',
        force: true,
        loopHooks,
      }),
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
          commMessage: contextForTools,
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
        return toolResultToAgentMessage(toolCall, `Unknown tool: ${resolvedName}`, true);
      }
      const t0 = performance.now();
      try {
        const raw = await runWithCommMessage(contextForTools, () =>
          legacy.execute(effectiveArgs),
        );
        const durationMs = performance.now() - t0;
        const rawText = typeof raw === 'string' ? raw : JSON.stringify(raw ?? null);

        // PostToolUse interception
        let resultText = rawText;
        if (hookRegistry) {
          const postDecision = await hookRegistry.triggerPostToolUse({
            type: 'postToolUse',
            toolName: resolvedName,
            toolInput: effectiveArgs,
            toolOutput: rawText,
            durationMs,
            sessionId,
            commMessage: contextForTools,
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

        const transformed = await transformToolResult({
          toolName: resolvedName,
          toolCallId: toolCall.id,
          args: effectiveArgs,
          result: resultText,
        });
        const finalText = typeof transformed === 'string' ? transformed : String(transformed);
        toolCalls.push({ tool: resolvedName, args: effectiveArgs, result: finalText });
        host.emitter.emit('ai.tool.result', host.emitter.createPayload(sessionId, contextForTools, 'text', {
          path: 'agent',
          toolName: resolvedName,
          result: finalText,
        }));
        return toolResultToAgentMessage(toolCall, finalText, false);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toolCalls.push({ tool: resolvedName, args: effectiveArgs, result: message });
        return toolResultToAgentMessage(toolCall, message, true);
      }
    },
    beforeToolCall: async ({ toolCall }: { toolCall: ParsedToolCall }) => {
      host.emitter.emit('ai.tool.call', host.emitter.createPayload(sessionId, contextForTools, 'text', {
        path: 'agent',
        toolName: toolCall.name,
        args: toolCall.arguments,
      }));
      return loopHooks?.runBeforeToolCall({ toolCall, sessionId });
    },
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
      await repo.appendMessages(sessionId, batch, { messageExtras });
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
      path: hasTools ? 'agent' : 'chat',
      iterations,
      model: modelId,
      toolCalls,
    };
  }

  const reply = sanitizeAssistantReply(lastAssistantText, {
    toolSummary: formatToolCallsForUser(toolCalls),
  });

  const spawnedSubagent = toolCalls.some(tc => tc.tool === 'spawn_task');
  if (spawnedSubagent) {
    await host.getActiveTurnTracker()?.waitForPendingSubagents();
  }
  const delegatedOnly = spawnedSubagent
    && !toolCalls.some(tc => tc.tool === 'run_deferred_task')
    && !toolCalls.some(tc =>
      tc.tool === 'generate_image'
      && tc.result
      && typeof tc.result === 'object'
      && typeof (tc.result as Record<string, unknown>).image === 'string',
    );
  const finalReply = delegatedOnly ? '' : reply;

  if (hasTools) {
    await host.emitter.dispatch('ai.agent.finish', host.emitter.createPayload(sessionId, contextForTools, 'text', {
      path: 'agent',
      model: modelId,
      iterations,
    }));
  }

  logPhase(host.phaseConfig, 'agent_loop.turn.end', sessionId, {
    iterations,
    ...tokenUsageLogFields(lastUsage),
  });

  const usage = lastUsage ? tokenUsageToLegacy(lastUsage) : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const endEvent = turnEndFromLegacyUsage(finalReply, usage);
  emitTurnEvent(endEvent);
  yield endEvent;
  return {
    reply: finalReply,
    usage,
    path: hasTools ? 'agent' : 'chat',
    iterations,
    model: modelId,
    toolCalls,
  };
}
