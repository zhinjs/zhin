/**
 * agentLoop turn runner (ADR 0009) — used when ContextRepository is wired.
 */

import type { AiOutboundSegmentProfile } from '@zhin.js/core';
import { decodeStructuredReply, structuredReplyInstruction, structuredReplySchema } from '../outbound/structured-reply.js';
import { renderAgentOutput, type AgentOutputElement } from '../outbound/agent-output.js';
import { mergeToolOutboundElements } from '../media/media-tool-bridge.js';
import { formatCompact, truncatePreview, getLogger } from '@zhin.js/logger';
import { createPromptContextBlock, projectPromptContext, estimateContextFixedTokens, parseOutput, type AgentTool, type Usage, agentLoop, agentContextFrom, assistantText, createUserMessage, agentToolsToLlmTools, type AgentMessage, type ParsedToolCall, type AssistantMessage, type TokenUsage, type ToolExecutionCause, type LlmCompletionPort, type Model, type ModelInputModality, createResilientCompletionPort, isProviderFailureMessage, resolveProviderConfigResilience, resolveProviderResilienceConfig } from '@zhin.js/ai';
import type { AgentRunJournal } from '@zhin.js/ai/agent-stream';
import { tokenUsageToLegacy } from './agent-run-shared.js';
import { applyExecPolicyToTools } from '../security/exec-policy.js';
import { resolveModelHarness } from '../config/model-harness-runtime.js';
import { buildAgentPathSystemPrompt, buildChatPathSystemPrompt, describeAgentPathPromptSections } from '../prompt/assembly.js';
import { logPromptComposition } from '../internal/prompt-trace.js';
import { planToolRun } from '../tool/runtime.js';
import { sanitizeAssistantReply, unwrapJsonStringLayers } from './text-sanitize.js';
import { formatToolCallsForUser, type ToolCallRecord } from './tool-calls-user-format.js';
import { summarizeExhaustedTurn } from './exhausted-turn-reply.js';
import { decodeLenientStructuredReply, recoverStructuredReply } from './structured-reply-recovery.js';
import { chatFailureKindOf, chatFailureLine, type ChatFailureOptions } from '../outbound/chat-failure.js';
import { trackTurnCompletionUsage } from './turn-completion-usage.js';
import { shouldSuppressReplyForSpawnDelegation } from './spawn-delegation.js';
import { logPhase, tokenUsageLogFields, logAgentLoopIterationEnd } from '../internal/phase-trace.js';
import { buildAgentPromptCacheStreamOptions, resolveSkillInstructionMaxChars } from '../config/index.js';
import type { HostPromptTurnHooks } from '../internal/host-types.js';
import type { AgentCore } from './agent-core.js';
import type { ZhinAgentPrivate, OnChunkCallback } from '../internal/agent-host.js';
import { buildLlmToolsForProvider } from '../tool/deferred-resolution.js';
import { applyToolToModelOutput } from '../tool/tool-model-output.js';
import { resolveAlwaysLoadedSet } from '../tool-catalog/resolve-config.js';
import { resolveDeferredApiTools, residentToolNames } from '../tool-catalog/tool-catalog.js';
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
import { TurnJournalCommitError } from '../turn/journal-integrity.js';
import { ExecutableToolRegistry } from '../tool/executable-tool-registry.js';
import { withoutForbiddenShell } from '../plugin-runtime/native-bash-tool.js';
import { NETWORK_DISABLED_PROMPT_NOTE, NETWORK_TOOL_NAMES, withoutForbiddenNetwork } from '../security/network-authority.js';
import { createMissingToolResolver } from './missing-tool-resolver.js';
import {
  DEFAULT_EXPLORATION_BUDGET,
  EXPLORATION_GUIDANCE,
  ExplorationBudget,
} from './exploration-budget.js';
import {
  TurnProgressTracker,
  autoContinueAllowed,
  buildContinuationInstruction,
  isProgress,
  resolveToolBudget,
} from './turn-progress.js';
import { TurnProgressReporter, summarizeProgress } from './progress-reporter.js';
import { noteTurnTrace } from '../trace/turn-trace-registry.js';
import { buildContextBudgetReport } from '../trace/context-budget.js';
import { renderDeferredToolIndex } from '../skill/capability-catalog.js';
import type { PromptSectionDebugInfo } from '../prompt/system-prompt.js';
const logger = getLogger('ZhinAgent:AgentLoopTurn');

/** 入库前解开模型误包的 JSON 字符串，避免下一轮历史继续叠转义。 */
function normalizeAssistantMessageText(assistant: AssistantMessage): void {
  for (const block of assistant.content) {
    if (block.type === 'text' && block.text) {
      block.text = unwrapJsonStringLayers(block.text);
    }
  }
}

function resolveAssistantReplyText(assistant: AssistantMessage, chat?: ChatFailureOptions): string {
  normalizeAssistantMessageText(assistant);
  const text = assistantText(assistant);
  if (text.trim()) return text;
  // In a chat the failure is said like a member would say it; operators read the logs.
  if (assistant.errorMessage && chat) return chatFailureLine(chatFailureKindOf(assistant.errorMessage), chat);
  if (assistant.errorMessage && isProviderFailureMessage(assistant.errorMessage)) {
    return `${assistant.errorMessage}。`;
  }
  if (assistant.errorMessage) {
    return `模型调用失败：${assistant.errorMessage}。请检查 API 密钥与网络后重试。`;
  }
  return text;
}

/** Media kinds the turn's prompt carries as real media blocks (accepted by the primary model). */
export function requiredTurnInputModalities(messages: readonly AgentMessage[]): ModelInputModality[] {
  const kinds = new Set<ModelInputModality>();
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const media = (message as { media?: ReadonlyArray<{ type: ModelInputModality }> }).media;
    for (const block of media ?? []) kinds.add(block.type);
  }
  return [...kinds];
}

/**
 * Wrap the turn's completion port with retry / timeout / fallback. Fallback models come
 * from the already-resolved `modelCandidates`; candidates the provider does not know are
 * skipped rather than failing the turn, and so are candidates that cannot take the
 * media the turn carries (an accepted image must never silently become a placeholder
 * on fallback).
 */
function createTurnCompletionPort(input: {
  host: ZhinAgentPrivate;
  providerAlias: string;
  modelId: string;
  modelCandidates: readonly string[];
  harness: Readonly<{ emptyReplyRetries?: number; requestTimeoutMs?: number }>;
  sessionId: string;
  requiredInput?: readonly ModelInputModality[];
  transport: LlmCompletionPort;
}): LlmCompletionPort {
  const { host, providerAlias, modelId, sessionId } = input;
  const requiredInput = input.requiredInput ?? [];
  const fallbackModels: Model[] = [];
  for (const candidate of input.modelCandidates) {
    if (!candidate || candidate === modelId) continue;
    let model: Model;
    try {
      model = host.llmRuntime.model(providerAlias, candidate);
    } catch {
      logger.debug(formatCompact({ op: 'provider_fallback_skip', model: candidate }));
      continue;
    }
    const modelInput: readonly string[] = Array.isArray(model.input) ? model.input : ['text'];
    const missing = requiredInput.filter((kind) => !modelInput.includes(kind));
    if (missing.length > 0) {
      logger.debug(formatCompact({ op: 'provider_fallback_skip', model: candidate, reason: 'input_modalities', missing: missing.join(',') }));
      continue;
    }
    fallbackModels.push(model);
  }
  // Precedence: ai.providerResilience < provider `timeout` / `maxRetries` < model harness quirks.
  const providerConfig = host.llmRuntime.providerConfig?.(providerAlias);
  const config = resolveProviderResilienceConfig(
    host.config.providerResilience,
    resolveProviderConfigResilience(providerConfig),
    {
      emptyReplyRetries: input.harness.emptyReplyRetries,
      requestTimeoutMs: input.harness.requestTimeoutMs,
    },
  );
  return createResilientCompletionPort(input.transport, {
    config,
    fallbackModels,
    timers: host.config.providerTimers,
    onEvent: (event) => {
      const { type, error, ...fields } = event;
      logger.warn(formatCompact({
        op: `provider_${type}`,
        session: sessionId,
        ...fields,
        error: truncatePreview(error, 200),
      }));
    },
  });
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
  /** What the IM reply endpoint lets the model author (ReplyPort.segments). */
  replySegments?: AiOutboundSegmentProfile;
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
  deferredController?: Readonly<{
    loadedToolNames(): string[];
    modelOutputBlocks?(name: string, args: unknown, text: string): import('@zhin.js/ai').TextContentBlock[] | undefined;
    /** Optional: lets the loop auto-load a deferred tool the model called directly. */
    load?(name: string): Promise<boolean>;
  }>;
  /** Catalog paired with deferredController for this exact Turn. */
  toolCatalog?: readonly ToolCatalogItem[];
  /** Direct tool sets bypass deferred catalog/snapshot/meta-tool machinery. */
  toolLoading?: 'deferred' | 'direct';
  /** Isolated executions neither load nor append conversational history. */
  conversationPersistence?: 'session' | 'none';
  /** Explicit iteration cap (e.g. a sub-agent turn); takes precedence over harness/config. */
  maxIterations?: number;
  /** Hard cap on steps including progress extensions; defaults to ai.agent.toolBudget.maxTotalIterations. */
  maxTotalIterations?: number;
  /** `false` disables automatic continuation (sub-agents report back instead). */
  autoContinuation?: boolean;
  /** Sends a brief progress update to the conversation; absent = no updates (sub-agents, unattended). */
  progressSink?: (text: string) => Promise<void>;
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
  /** Validated final output, shared by terminal journal and delivery. */
  output?: AgentOutputElement[];
  usage: Usage;
  path: 'chat' | 'agent' | 'multimodal';
  iterations: number;
  model: string;
  toolCalls: ToolCallRecord[];
  thinking?: string;
  /** Conversation projection applied only after the durable terminal commits. */
  projectConversation?: () => Promise<void>;
}

/** @deprecated No production caller: image turns run through `runText` with media
 * blocks (plus the perception pre-pass for text-only models). This path has no
 * provider resilience and no tools. Removed in the next minor. */
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

/** @deprecated See {@link AgentLoopVisionTurnInput}; removed in the next minor. */
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
  const llmModel = host.llmRuntime.model(providerAlias, modelId);
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
    transport: host.llmRuntime,
    maxIterations: 1,
    streamOptions: buildAgentPromptCacheStreamOptions(host.config, {
      modelSdk: llmModel.sdk,
      provider: providerAlias,
      modelId,
      label: 'vision',
    }),
    convertToLlm: projectPromptContext,
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

/**
 * @deprecated No production caller: image turns run through `runText` with media
 * blocks (plus the perception pre-pass for text-only models). This path has no
 * provider resilience and no tools. Removed in the next minor.
 */
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
    personaEnhanced,
    modelId,
    onChunk,
    promptHooks,
    signal,
  } = input;

  const repo = host.contextRepository;

  // Bash and network tools are only offered when this turn's policy can
  // actually use them, so the model never burns a step on a tool that is
  // guaranteed to fail. Filtering the catalog also keeps load_tool /
  // auto-load from re-adding them.
  const turnPolicy = input.turnContext.policy;
  const allTools = withoutForbiddenNetwork(turnPolicy, withoutForbiddenShell(turnPolicy, input.allTools));
  const resolvedTools = withoutForbiddenNetwork(turnPolicy, withoutForbiddenShell(turnPolicy, input.resolvedTools));
  const networkWithheld = [...input.allTools, ...input.resolvedTools, ...(input.toolCatalog ?? [])]
    .some(tool => NETWORK_TOOL_NAMES.has(tool.name)) && !allTools.some(tool => NETWORK_TOOL_NAMES.has(tool.name));

  const providerAlias = host.getTurnProvider().name;
  const llmModel = host.llmRuntime.model(providerAlias, modelId);
  const persistentConversation = input.conversationPersistence !== 'none';
  const loaded = persistentConversation
    ? await repo.loadContext(sessionId)
    : { messages: [] as AgentMessage[] };
  let promptMessages = input.initialMessages?.length
    ? input.initialMessages
    : [createUserMessage(input.rawContent)];

  const directTools = input.toolLoading === 'direct';
  const hasTools = directTools ? resolvedTools.length > 0 : allTools.length > 0;
  const toolRun = hasTools && !directTools
    ? await planToolRun(resolvedTools, host.config.preExecTimeout)
    : { mode: 'agent' as const, preExecution: { tools: [], data: '' } };

  const preData = toolRun.preExecution.data;
  // IM conversations get a message contract. Detached/programmatic turns keep
  // their text/custom-schema contract and never inherit the IM preset.
  // ai.agent.outputSchema: true / 'segments' → zhin message contract; an object → caller's own schema.
  const configuredSchema = host.config.outputSchema ?? 'segments';
  const messagePreset = configuredSchema === true || configuredSchema === 'segments';
  const imReply = messagePreset && input.turnContext.origin.kind === 'im'
    && input.conversationPersistence !== 'none';
  const chatFailure: ChatFailureOptions | undefined = input.turnContext.origin.kind === 'im'
    ? { master: input.turnContext.principal.roles.includes('master') }
    : undefined;
  const outputSchema = imReply ? structuredReplySchema(input.replySegments)
    : messagePreset || !configuredSchema ? undefined : configuredSchema;
  const turnShellPolicy = input.turnContext.policy?.shell;
  const execPolicyConfig = turnShellPolicy
    ? {
        ...host.config,
        ...(turnShellPolicy.security ? { execSecurity: turnShellPolicy.security } : {}),
        ...(turnShellPolicy.execPreset ? { execPreset: turnShellPolicy.execPreset } : {}),
        ...(turnShellPolicy.approvalMode ? { execApprovalMode: turnShellPolicy.approvalMode } : {}),
      }
    : host.config;
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
    : buildChatPathSystemPrompt(host, personaEnhanced, input.promptProfile, input.promptRuntime);
  const proseSystemPrompt = systemPrompt;
  if (imReply) {
    systemPrompt = `${systemPrompt}\n\n${structuredReplyInstruction(input.replySegments)}`;
  }

  const agentTools = hasTools
    ? turnShellPolicy
      ? resolvedTools
      : applyExecPolicyToTools(execPolicyConfig, resolvedTools, {
        approvalMode: execPolicyConfig.execApprovalMode,
      })
    : [];

  const deferredController = directTools ? undefined : input.deferredController;
  const catalog = directTools ? [] : withoutForbiddenNetwork(turnPolicy, withoutForbiddenShell(turnPolicy, input.toolCatalog ?? []));
  if (!directTools && hasTools && (!deferredController || catalog.length === 0)) {
    throw new Error('Deferred tool loading requires a turn-owned controller and catalog');
  }

  // Config names plus tools the capability plan pinned (platform tools, `alwaysLoaded` plugin tools).
  const turnResidentTools = () => residentToolNames(catalog, resolveAlwaysLoadedSet(host.config));
  const refreshResolvedTools = () => {
    if (directTools) return resolvedTools;
    const alwaysLoaded = turnResidentTools();
    const loaded = deferredController!.loadedToolNames();
    return resolveDeferredApiTools(catalog, alwaysLoaded, loaded);
  };

  let promptSections: PromptSectionDebugInfo[] = [];
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
    promptSections = sections;
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
    ? (input.maxIterations ?? harness.maxIterations ?? host.config.maxIterations)
    : 1;
  const explorationBudget = hasTools
    ? new ExplorationBudget(harness.explorationBudget ?? DEFAULT_EXPLORATION_BUDGET)
    : undefined;
  if (hasTools && harness.explorationGuidance) {
    systemPrompt = `${systemPrompt}\n\n${EXPLORATION_GUIDANCE}`;
  }
  if (hasTools && !directTools) {
    const toolIndex = renderDeferredToolIndex(deferredCatalogTools(catalog, agentTools)
      .map((item) => ({ name: item.name, description: item.brief })));
    if (toolIndex) {
      const block = createPromptContextBlock('deferred-tools', toolIndex);
      const userIndex = promptMessages.map(message => message.role === 'user' && Array.isArray(message.content)).lastIndexOf(true);
      promptMessages = userIndex < 0
        ? [...promptMessages, { ...createUserMessage(''), content: [block] }]
        : promptMessages.map((message, index) => index === userIndex && Array.isArray(message.content)
          ? { ...message, content: [...message.content, block] }
          : message);
    }
  }
  if (networkWithheld) systemPrompt = `${systemPrompt}\n\n${NETWORK_DISABLED_PROMPT_NOTE}`;

  const executableTools = new ExecutableToolRegistry(agentTools);
  let llmTools = directTools
    ? agentToolsToLlmTools(agentTools)
    : buildLlmToolsForProvider(
        llmModel.sdk,
        catalog,
        agentTools,
        turnResidentTools(),
        deferredController?.loadedToolNames() ?? [],
      );
  if (hasTools) {
    noteTurnTrace(traceTurnId(input.turnContext), {
      kind: 'context_budget',
      report: buildContextBudgetReport({
        systemPrompt,
        outputSchema,
        sections: promptSections,
        bootstrapContext: input.promptRuntime?.bootstrapContext,
        activeSkillsContext: input.promptRuntime?.activeSkillsContext,
        loadedTools: agentTools,
        deferredToolCount: deferredCatalogTools(catalog, agentTools).length,
        historyMessages: loaded.messages,
        userMessages: promptMessages,
      }),
    });
  }
  const toolCalls: ToolCallRecord[] = [];
  let iterations = 0;
  let lastAssistantText = '';
  const completionUsage = trackTurnCompletionUsage(host.llmRuntime);
  const conversationBatches: Array<{
    messages: AgentMessage[];
    messageExtras: Array<import('@zhin.js/ai').AgentMessageExtra | undefined>;
  }> = [];
  /** This turn's prompt plus every message the loop produced; used for reply recovery. */
  let turnTranscript: AgentMessage[] = [];

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
    const refreshed = refreshResolvedTools();
    const nextAgentTools = turnShellPolicy
      ? refreshed
      : applyExecPolicyToTools(execPolicyConfig, refreshed, {
          approvalMode: execPolicyConfig.execApprovalMode,
        });
    executableTools.replace(nextAgentTools);
    llmTools = directTools
      ? agentToolsToLlmTools(nextAgentTools)
      : buildLlmToolsForProvider(
          llmModel.sdk,
          catalog,
          nextAgentTools,
          turnResidentTools(),
          deferredController?.loadedToolNames() ?? [],
        );
    return llmTools;
  };

  const contextWindow = llmModel.contextWindow ?? host.config.contextTokens;
  // System prompt and tool schemas count against the window too, so the
  // compaction threshold is measured on what is left for messages (#730).
  let budgetTools: typeof llmTools | undefined;
  let fixedBudget: Promise<number> | undefined;
  const fixedPromptTokens = () => {
    // 本回合系统提示不变；工具渐进披露替换数组后重新计算完整 Schema。
    if (!fixedBudget || budgetTools !== llmTools) {
      budgetTools = llmTools;
      fixedBudget = estimateContextFixedTokens({ systemPrompt, tools: llmTools, model: llmModel, outputSchema });
    }
    return fixedBudget;
  };
  const loopHooks = input.loopHooks;
  const completionPort = createTurnCompletionPort({
    host,
    providerAlias,
    modelId,
    modelCandidates: input.modelCandidates,
    harness,
    sessionId,
    transport: completionUsage.transport,
    requiredInput: requiredTurnInputModalities(promptMessages),
  });

  // Progress-aware budget: maxIterations is soft, extended while progressing.
  const toolBudget = resolveToolBudget(host.config.toolBudget, harness);
  const progress = new TurnProgressTracker(toolBudget);
  const turnStartedAt = Date.now();
  let segmentStartIteration = 0;
  let extensionPending = false;
  let lastReportIteration = 0;
  const segmentHardCap = Math.max(maxIterations, input.maxTotalIterations ?? toolBudget.maxTotalIterations);
  const hardLimitReached = () =>
    (toolBudget.maxWallClockMs > 0 && Date.now() - turnStartedAt >= toolBudget.maxWallClockMs)
    || (toolBudget.maxTotalTokens > 0 && completionUsage.usage.totalTokens >= toolBudget.maxTotalTokens);
  const nextIterationLimit = (iteration: number, limit: number): number => {
    if (iteration > 0 && hardLimitReached()) return iteration;
    if (iteration < limit) return limit;
    if (toolBudget.extendBy === 0 || limit >= segmentHardCap || progress.stalled) return limit;
    const windowStart = segmentStartIteration + iteration - toolBudget.progressWindow + 1;
    if (!progress.progressedSince(windowStart)) return limit;
    const next = Math.min(segmentHardCap, limit + toolBudget.extendBy);
    extensionPending = true;
    noteTurnTrace(traceTurnId(input.turnContext), { kind: 'budget_extended', from: limit, to: next });
    logPhase(host.phaseConfig, 'agent_loop.budget.extend', sessionId, { from: limit, to: next });
    return next;
  };
  const recordProgress = (toolName: string, args: unknown, ok: boolean, output?: string) =>
    progress.record(iterations, { toolName, args, ok, output });

  const loopConfig = {
    model: llmModel,
    transport: completionPort,
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
    convertToLlm: projectPromptContext,
    transformContext: async (messages: AgentMessage[], ctxSignal?: AbortSignal) =>
      persistentConversation ? host.compactionRuntime.transformContext(messages, ctxSignal, {
        host,
        sessionId,
        transport: completionUsage.transport,
        model: llmModel,
        compactionConfig: host.config.compaction,
        contextWindow,
        reservedTokens: await fixedPromptTokens(),
        toldLedger: host.toldLedger?.render(sessionId),
        mode: 'text',
        loopHooks,
      }) : messages,
    onContextOverflow: async (messages: AgentMessage[], ctxSignal?: AbortSignal) =>
      persistentConversation ? host.compactionRuntime.transformContext(messages, ctxSignal, {
        host,
        sessionId,
        transport: completionUsage.transport,
        model: llmModel,
        compactionConfig: host.config.compaction,
        contextWindow,
        reservedTokens: await fixedPromptTokens(),
        toldLedger: host.toldLedger?.render(sessionId),
        mode: 'text',
        force: true,
        loopHooks,
      }) : messages,
    getSteeringMessages: promptHooks?.getSteeringMessages,
    getFollowUpMessages: promptHooks?.getFollowUpMessages,
    executeTool: async (toolCall: ParsedToolCall, _tools: typeof llmTools, toolSignal?: AbortSignal, cause?: ToolExecutionCause) => {
      const hookRegistry = host.resourceHub?.hooks;
      const currentAliases = input.toolAliases;
      const resolvedName = currentAliases?.[toolCall.name] ?? toolCall.name;
      let effectiveArgs = toolCall.arguments;

      // PreToolUse interception
      if (hookRegistry) {
        const preDecision = await hookRegistry.triggerPreToolUse({
          type: 'preToolUse',
          toolName: resolvedName,
          toolInput: effectiveArgs,
          toolSource: executableTools.resolve(resolvedName)?.source,
          sessionId,
          turn: input.turnContext,
        });
        if (preDecision.decision === 'deny') {
          const reason = preDecision.reason;
          recordProgress(resolvedName, effectiveArgs, false);
          toolCalls.push({ tool: resolvedName, args: effectiveArgs, result: reason });
          return toolResultToAgentMessage(toolCall, reason, true);
        }
        if (preDecision.decision === 'modify') {
          effectiveArgs = preDecision.modifiedInput;
        }
      }

      const tool = executableTools.resolve(resolvedName);
      if (!tool) {
        recordProgress(resolvedName, effectiveArgs, false);
        return toolResultToAgentMessage(toolCall, `工具「${resolvedName}」执行失败：工具不存在或所属插件未启用。`, true);
      }

      try {
        const outcome = await input.toolExecution.execute(tool, effectiveArgs, toolCall.id, cause);
        if (outcome.status === 'cancelled') {
          const cancellation = signal?.reason instanceof Error
            ? signal.reason
            : new DOMException(outcome.reason, 'AbortError');
          throw cancellation;
        }
        if (outcome.status !== 'completed') {
          const reason = outcome.status === 'failed' ? outcome.error : outcome.reason;
          recordProgress(resolvedName, effectiveArgs, false);
          toolCalls.push({ tool: resolvedName, args: effectiveArgs, result: reason });
          return toolResultToAgentMessage(toolCall, reason, true);
        }
        const rawText = await applyToolToModelOutput(tool, outcome.output, effectiveArgs);

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
            recordProgress(resolvedName, effectiveArgs, false);
            toolCalls.push({ tool: resolvedName, args: effectiveArgs, result: postDecision.reason });
            return toolResultToAgentMessage(toolCall, postDecision.reason, true);
          }
          if (postDecision.decision === 'modify') {
            resultText = typeof postDecision.modifiedOutput === 'string'
              ? postDecision.modifiedOutput
              : JSON.stringify(postDecision.modifiedOutput);
          }
        }

        const progressKind = recordProgress(resolvedName, effectiveArgs, true, resultText);
        const budgetNote = explorationBudget?.record(resolvedName, isProgress(progressKind));
        const finalText = budgetNote ? `${resultText}\n\n${budgetNote}` : resultText;
        toolCalls.push({ tool: resolvedName, args: effectiveArgs, result: finalText });
        const result = toolResultToAgentMessage(toolCall, finalText, false);
        const blocks = deferredController?.modelOutputBlocks?.(resolvedName, effectiveArgs, finalText);
        return blocks ? { ...result, content: blocks } : result;
      } catch (err) {
        if (err instanceof TurnJournalCommitError) throw err;
        if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
          throw signal?.reason instanceof Error
            ? signal.reason
            : err instanceof Error
              ? err
              : new Error('Tool execution cancelled');
        }
        const message = err instanceof Error ? err.message : String(err);
        const failure = `工具「${resolvedName}」执行失败：${message}`;
        recordProgress(resolvedName, effectiveArgs, false);
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
    // The model called a deferred catalog tool without load_tool: load it and
    // run the call. The catalog only holds tools this turn may use, and the
    // rebuilt list re-applies exec policy, so disallowed tools stay rejected.
    resolveMissingTool: hasTools
      ? createMissingToolResolver({
          catalog,
          load: deferredController?.load?.bind(deferredController),
          rebuild: rebuildLlmTools,
        })
      : undefined,
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
    nextIterationLimit,
  };

  const mapperState = createTurnEventMapperState(maxIterations);

  const emitTurnEvent = (event: TurnEvent) => {
    input.onTurnEvent?.(event);
  };

  const autoContinue = hasTools
    && input.autoContinuation !== false
    && autoContinueAllowed(toolBudget.autoContinue, input.turnContext);
  let continuations = 0;
  let segmentPrompt = promptMessages;
  let segmentContext = loopContext;
  let lastAssistantHadToolCalls = false;
  let lastAssistantNeedsHostReply = false;
  const reporter = input.progressSink && hasTools && toolBudget.progressMaxUpdates > 0
    ? new TurnProgressReporter({
      sink: input.progressSink,
      minIntervalMs: toolBudget.progressMinIntervalMs,
      maxUpdates: toolBudget.progressMaxUpdates,
      summarize: () => summarizeProgress({
        transport: completionUsage.transport,
        model: llmModel,
        systemPrompt: proseSystemPrompt,
        messages: [...loaded.messages, ...turnTranscript, ...segmentMessages],
        sessionId,
        signal,
      }),
    })
    : undefined;
  // Messages of the running segment, for progress summaries before agent_end.
  let segmentMessages: AgentMessage[] = [];
  function* drainCompletionUsage(): Generator<TurnEvent> {
    for (const event of completionUsage.drainEvents()) {
      emitTurnEvent(event);
      yield event;
    }
  }
  // Each segment is one agentLoop run; continuations add segments to the same
  // Turn, so policy, approval ports and persisted history stay those of the Turn.
  while (true) {
    segmentStartIteration = iterations;
    progress.startSegment();
    lastAssistantHadToolCalls = false;
    segmentMessages = [...segmentPrompt];
    for await (const event of agentLoop(segmentPrompt, segmentContext, loopConfig, signal)) {
      yield* drainCompletionUsage();
      for (const te of mapAgentEventToTurnEvents(event, mapperState)) {
        if (te.type === 'usage' && event.type === 'message_end' && event.message.role === 'assistant'
          && completionUsage.hasReported(event.message)) continue;
        if (imReply && te.type === 'chunk') continue;
        if (input.toolEventSource === 'authority'
          && (te.type === 'tool_call' || te.type === 'tool_result')) continue;
        emitTurnEvent(te);
        yield te;
      }
      if (event.type === 'turn_start') {
        // Milestone updates between iterations keep long Turns from looking frozen.
        if (reporter && progress.progressedSince(lastReportIteration + 1)) {
          const sent = await reporter.report(extensionPending ? 'extension' : 'progress', {
            steps: iterations,
            interimText: !imReply && lastAssistantHadToolCalls ? lastAssistantText : undefined,
          });
          if (sent) lastReportIteration = iterations;
        }
        extensionPending = false;
        iterations += 1;
      }
      if (event.type === 'message_end') segmentMessages.push(event.message as AgentMessage);
      if (!imReply && event.type === 'message_update' && event.delta?.type === 'text_delta') {
        onChunk?.(event.delta.text, lastAssistantText + event.delta.text);
      }
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        const assistant = event.message as AssistantMessage;
        lastAssistantHadToolCalls = assistant.content.some((block) => block.type === 'toolCall');
        const answerText = assistant.content
          .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
          .map(block => block.text).join('');
        lastAssistantNeedsHostReply = Boolean(assistant.errorMessage)
          || (!lastAssistantHadToolCalls && !answerText.trim());
        lastAssistantText = imReply && !lastAssistantNeedsHostReply ? answerText
          : resolveAssistantReplyText(imReply ? { ...assistant, content: [] } : assistant, chatFailure);
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
        if (!imReply) onChunk?.(lastAssistantText, lastAssistantText);
      }
      if (event.type === 'agent_end') {
        if (signal?.aborted) continue;
        const userBatch = event.userMessages ?? segmentPrompt;
        const batch = [...userBatch, ...event.messages];
        turnTranscript = [...turnTranscript, ...batch];
        const messageExtras = batch.map((msg, i) => (
          msg.role === 'user' && i === 0 && continuations === 0 ? userMessageExtra : undefined
        ));
        if (persistentConversation) {
          conversationBatches.push({ messages: batch, messageExtras });
        }
      }
    }
    // Auto-continue only a Turn that stopped mid-task (model still calling tools)
    // after real progress, within the continuation and hard caps.
    if (!autoContinue
      || signal?.aborted
      || !lastAssistantHadToolCalls
      || !progress.segmentProgressed
      || continuations >= toolBudget.maxContinuations
      || hardLimitReached()
      || shouldSuppressReplyForSpawnDelegation(toolCalls)) break;
    const checkpoint = await summarizeExhaustedTurn({
      transport: completionUsage.transport,
      model: llmModel,
      systemPrompt: proseSystemPrompt,
      messages: [...loaded.messages, ...turnTranscript],
      maxIterations: iterations - segmentStartIteration,
      sessionId,
      signal,
    });
    if (!checkpoint.assistant || signal?.aborted) break;
    conversationBatches.at(-1)?.messages.push(checkpoint.assistant);
    conversationBatches.at(-1)?.messageExtras.push(undefined);
    turnTranscript = [...turnTranscript, checkpoint.assistant];
    continuations += 1;
    await reporter?.report('continuation', { steps: iterations, interimText: checkpoint.reply });
    lastReportIteration = iterations;
    noteTurnTrace(traceTurnId(input.turnContext), { kind: 'continuation', index: continuations });
    logPhase(host.phaseConfig, 'agent_loop.budget.continue', sessionId, { continuation: continuations });
    segmentPrompt = [createUserMessage(buildContinuationInstruction(continuations, toolBudget.maxContinuations, reporter?.reported))];
    segmentContext = agentContextFrom({
      systemPrompt,
      messages: [...loaded.messages, ...turnTranscript],
      tools: llmTools,
    });
  }

  // Progress updates already reached the user, finished or not (#730 ledger).
  if (persistentConversation && reporter) {
    for (const text of reporter.reported) {
      host.toldLedger?.record(sessionId, text, 'progress', traceTurnId(input.turnContext));
    }
  }

  yield* drainCompletionUsage();
  if (signal?.aborted) {
    const usage = tokenUsageToLegacy(completionUsage.usage);
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
      projectConversation: () => appendConversationBatches(repo, sessionId, conversationBatches),
    };
  }

  const spawnedSubagent = toolCalls.some(tc => tc.tool === 'spawn_task');
  if (spawnedSubagent) {
    await host.getActiveTurnTracker()?.waitForPendingSubagents();
  }
  const delegatedOnly = shouldSuppressReplyForSpawnDelegation(toolCalls)
    && !toolCalls.some(tc =>
      tc.tool === 'generate_image'
      && tc.result
      && typeof tc.result === 'object'
      && typeof (tc.result as Record<string, unknown>).image === 'string',
    );

  // The loop ran tools but never produced visible text (usually maxIterations
  // was hit mid-exploration). Ask the model for a tools-off summary instead of
  // showing raw tool output.
  const needsReplyRecovery = !delegatedOnly
    && hasTools
    && (toolCalls.length > 0 || iterations >= maxIterations)
    && (!lastAssistantText.trim() || (imReply && lastAssistantHadToolCalls));

  let rawReply = lastAssistantText;
  let hostReply = lastAssistantNeedsHostReply;
  if (needsReplyRecovery) {
    const summary = await summarizeExhaustedTurn({
      transport: completionUsage.transport,
      model: llmModel,
      systemPrompt,
      messages: [...loaded.messages, ...turnTranscript],
      maxIterations,
      sessionId,
      signal,
      outputSchema,
    });
    const lastBatch = conversationBatches.at(-1);
    if (summary.assistant && lastBatch) {
      lastBatch.messages.push(summary.assistant);
      lastBatch.messageExtras.push(undefined);
    }
    rawReply = summary.reply;
    hostReply = !summary.assistant;
  }
  const structuredReply = imReply && !hostReply;
  // A chat member does not announce how many steps a task took; only non-IM callers get the notice.
  const continuationPrefix = continuations > 0 && input.turnContext.origin.kind !== 'im'
    ? `（任务步骤较多，已自动续跑 ${continuations} 次）\n\n` : '';
  const proseReply = structuredReply ? ''
    : sanitizeAssistantReply(rawReply, {
      toolSummary: formatToolCallsForUser(toolCalls),
      ...(chatFailure ? { emptyMessage: chatFailureLine('malformed_tool_call', chatFailure) } : {}),
    });
  const textReply = delegatedOnly ? '' : proseReply.trim() ? continuationPrefix + proseReply : proseReply;
  let output: AgentOutputElement[] = delegatedOnly || structuredReply ? [] : parseOutput(textReply);
  if (!delegatedOnly && structuredReply) {
    try {
      output = decodeStructuredReply(rawReply, input.replySegments);
    } catch (error) {
      const messages = conversationBatches.at(-1)?.messages;
      const rejected = messages?.at(-1);
      const lenient = decodeLenientStructuredReply(rawReply, input.replySegments);
      if (lenient) {
        output = lenient.output;
        if (messages && rejected?.role === 'assistant') {
          messages[messages.length - 1] = { ...rejected, content: [{ type: 'text', text: lenient.text }] };
        }
      } else {
        const recovery = await recoverStructuredReply({
          transport: completionUsage.transport, model: llmModel, raw: rawReply,
          error: error instanceof Error ? error : new Error('Invalid structured reply'), signal,
          segments: input.replySegments,
          failureText: chatFailureLine('format', { ...chatFailure, random: 0 }),
        });
        output = recovery.output;
        // History must match what the user saw: the corrected reply, or the failure text. Never the
        // correction prompt (it embeds the rejected raw text) and never the rejected raw reply.
        if (messages && rejected?.role === 'assistant') {
          messages[messages.length - 1] = recovery.assistant
            ?? { ...rejected, content: [{ type: 'text', text: renderAgentOutput(recovery.output) }] };
        }
      }
    }
  }
  if (!delegatedOnly) {
    output = mergeToolOutboundElements(output, toolCalls);
  }
  const finalReply = imReply ? renderAgentOutput(output) : textReply;
  if (!imReply && needsReplyRecovery) onChunk?.(finalReply, finalReply);
  if (imReply && finalReply) {
    // Never expose partial JSON through streaming callbacks or activity ports.
    onChunk?.(finalReply, finalReply);
    const chunk: TurnEvent = { type: 'chunk', text: finalReply, accumulated: finalReply };
    emitTurnEvent(chunk);
    yield chunk;
  }

  yield* drainCompletionUsage();
  logPhase(host.phaseConfig, 'agent_loop.turn.end', sessionId, {
    iterations,
    ...tokenUsageLogFields(completionUsage.usage),
  });

  const usage = tokenUsageToLegacy(completionUsage.usage);
  const endEvent: TurnEvent = {
    type: 'turn_end', output,
    usage: { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens },
  };
  emitTurnEvent(endEvent);
  yield endEvent;
  const thinking = mapperState.accumulatedThinking.trim() || undefined;
  return {
    reply: finalReply,
    output,
    usage,
    path: hasTools ? 'agent' : 'chat',
    iterations,
    model: modelId,
    toolCalls,
    thinking,
    projectConversation: () => appendConversationBatches(repo, sessionId, conversationBatches),
  };
}

async function appendConversationBatches(
  repo: import('@zhin.js/ai').ContextRepository,
  sessionId: string,
  batches: readonly {
    messages: AgentMessage[];
    messageExtras: Array<import('@zhin.js/ai').AgentMessageExtra | undefined>;
  }[],
): Promise<void> {
  for (const batch of batches) {
    await repo.appendMessages(sessionId, batch.messages, { messageExtras: batch.messageExtras });
  }
}

/** Turn id for trace notes; context views built outside TurnIngress carry none. */
/** Catalog tools whose schema is not sent on this request (reachable via load_tool / discover). */
function deferredCatalogTools(catalog: readonly ToolCatalogItem[], loaded: readonly AgentTool[]): ToolCatalogItem[] {
  const loadedNames = new Set(loaded.map((tool) => tool.name));
  return catalog.filter((item) => item.source !== 'meta' && !loadedNames.has(item.name));
}

function traceTurnId(view: TurnContextView | undefined): string | undefined {
  const identity = (view as { identity?: { turnId?: unknown } } | undefined)?.identity;
  return typeof identity?.turnId === 'string' ? identity.turnId : undefined;
}
