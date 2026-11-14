import type { AiOutboundSegmentProfile } from '@zhin.js/core';
import type { CoreReplyStream, ReplyStreamSnapshot } from '@zhin.js/core/runtime';
import { formatCompact, truncatePreview, getLogger } from '@zhin.js/logger';
import {
  estimateContextFixedTokens,
  agentToolsToLlmTools,
  createResilientCompletionPort,
  resolveProviderResilienceConfig,
  type AgentTool,
  type Usage,
  type AgentMessage,
  type ParsedToolCall,
  type ToolExecutionCause,
  type LlmCompletionPort,
} from '@zhin.js/ai';
import type { AgentRunJournal } from '@zhin.js/ai/agent-stream';
import type { ReplyStreamRun } from './reply-stream-run.js';
import type { ReplyPhaseLifecycle } from './reply-phase.js';
import type { AgentOutputElement } from '../outbound/agent-output.js';
import { applyExecPolicyToTools } from '../security/exec-policy.js';
import type { ToolCallRecord } from './tool-calls-user-format.js';
import { formatUnexecutedToolResult } from './unexecuted-tool-notice.js';
import { approvalPolicySnapshot, formatPolicyStamp } from '../security/approval-policy-fingerprint.js';
import { trackTurnCompletionUsage } from './turn-completion-usage.js';
import type { InteractiveRun } from './interactive-run.js';
import { createTurnSummaryExecutionResolver } from '../memory/summary-model.js';
import { AgentCompactionRuntime } from '../memory/compaction-runtime.js';
import { LocalImageInspection, type ImageInspectionBudget } from '../media/local-image-inspection.js';
import { DEFAULT_PERCEPTION_SETTINGS } from '../config/perception-config.js';
import type { HostPromptTurnHooks } from '../internal/host-types.js';
import { publishReplyImages } from '../media/publish-image-reply.js';
import type { AgentCore } from './agent-core.js';
import type { ZhinAgentPrivate, OnChunkCallback } from '../internal/agent-host.js';
import { buildLlmToolsForProvider } from '../tool/deferred-resolution.js';
import { applyToolToModelOutput } from '../tool/tool-model-output.js';
import type { ToolCatalogItem } from '../tool-catalog/types.js';
import type { TurnEvent } from '../event/turn-event.js';
import type { AgentPromptProfile } from '../prompt/turn-prompt-profile.js';
import type { TurnContextView } from '../context/turn-envelope.js';
import type { ToolExecutionAuthority } from './tool-execution-authority.js';
import type { PluginAILoopHookRegistry } from '../plugin-loop-hooks.js';
import { TurnJournalCommitError } from '../turn/journal-integrity.js';
import type { ExecutableToolRegistry } from '../tool/executable-tool-registry.js';
import { createMissingToolResolver } from './missing-tool-resolver.js';
import {
  type ExplorationBudget,
  LAST_ITERATION_NUDGE,
  type SpinDetector,
} from './exploration-budget.js';
import { isProgress, type ToolProgressKind } from './turn-progress.js';
import { noteTurnTrace } from '../trace/turn-trace-registry.js';

const logger = getLogger('ZhinAgent:AgentLoopTurn');

export interface AgentLoopTurnInput {
  /** Filled with the aliases of every projection this turn sends, for tool-argument resolution (ADR 0043 §5). */
  messageAliases?: import('@zhin.js/ai').MessageAliasTable;
  /** Shared image allowance, including media already processed at ingress. */
  imageInspectionBudget?: ImageInspectionBudget;
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
  /** Turn-owned unified outbound stream; absent preserves complete-message delivery. */
  replyStream?: CoreReplyStream;
  replyPhases?: ReplyPhaseLifecycle;
  allTools: AgentTool[];
  resolvedTools: AgentTool[];
  toolExecution: ToolExecutionAuthority;
  /** Canonical capability authority journals tool facts itself; classic loops map them. */
  toolEventSource?: 'loop' | 'authority';
  loopHooks?: PluginAILoopHookRegistry;
  promptRuntime?: Readonly<{
    bootstrapContext?: string;
    contextFiles?: readonly import('../bootstrap.js').ContextFile[];
    activeSkillsContext?: string;
    agentNickname?: string;
    modelId?: string;
    providerAlias?: string;
    /** Sender-/selection-dependent capability catalog: sent in the current message's runtime tail. */
    capabilityTail?: string;
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
  /** Admitted interactive root's live budget; inherited only by synchronous children. */
  interactiveRun?: InteractiveRun;
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
  /** Explicitly unfinished task; unlike a natural final answer, children must not label it complete. */
  stoppedReason?: string;
  progressive?: { run: ReplyStreamRun; snapshot?: ReplyStreamSnapshot };
  replyPhaseId?: string;
  replyPhaseStopped?: true;
  /** Conversation projection applied only after the durable terminal commits. */
  projectConversation?: (delivered?: {
    readonly messageId?: string;
    readonly messageIds?: readonly (string | null)[];
    readonly contextRefs?: readonly string[];
    readonly confirmedOutput?: AgentOutputElement[];
    readonly conversationSequence?: number;
    readonly conversationSequences?: readonly (number | null)[];
    readonly conversationKey?: string;
  }) => Promise<void>;
}

/** Turn id for trace notes; context views built outside TurnIngress carry none. */
export function traceTurnId(view: TurnContextView | undefined): string | undefined {
  const identity = (view as { identity?: { turnId?: unknown } } | undefined)?.identity;
  return typeof identity?.turnId === 'string' ? identity.turnId : undefined;
}

/** Wrap the selected chat model with same-model retries and timeouts only. */
export function createTurnCompletionPort(input: {
  host: ZhinAgentPrivate;
  providerAlias: string;
  harness: Readonly<{ emptyReplyRetries?: number; requestTimeoutMs?: number }>;
  sessionId: string;
  transport: LlmCompletionPort;
}): LlmCompletionPort {
  const { host, sessionId } = input;
  // Profile/Driver owns execution settings; global policy and explicit harness
  // control same-model retry behavior without a Provider alias directory.
  const config = resolveProviderResilienceConfig(
    host.config.providerResilience,
    host.getTurnExecution().model.executionPolicy,
    {
      emptyReplyRetries: input.harness.emptyReplyRetries,
      requestTimeoutMs: input.harness.requestTimeoutMs,
    },
  );
  return createResilientCompletionPort(input.transport, {
    config,
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

export function toolResultToAgentMessage(
  toolCall: ParsedToolCall,
  result: unknown,
  isError: boolean,
  /** #1250 review: set only for a framework policy denial; see `ToolResultMessage.deniedUnderPolicy`. */
  deniedUnderPolicy?: string,
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
    ...(deniedUnderPolicy ? { deniedUnderPolicy } : {}),
    timestamp: Date.now(),
  };
}

export interface TurnToolLoopState {
  answering: boolean;
  preparedCallId: string | undefined;
  activeTools: number;
  nudgedIteration: number;
  iterations: number;
  segmentStartIteration: number;
  currentLimit: number;
  replyRun: ReplyStreamRun | undefined;
  stopProgress(): void;
}

export function createTurnCompletionRuntime<TLlmTools extends ReturnType<typeof agentToolsToLlmTools>>(params: {
  input: AgentLoopTurnInput;
  providerAlias: string;
  llmModel: ReturnType<ZhinAgentPrivate['getTurnExecution']>['model'];
  persistentConversation: boolean;
  directTools: boolean;
  prepareReply: boolean;
  withReplyTransition: (tools: TLlmTools) => TLlmTools;
  turnShellPolicy: NonNullable<TurnContextView['policy']>['shell'];
  execPolicyConfig: ZhinAgentPrivate['config'];
  systemPrompt: string;
  outputSchema: unknown;
  catalog: readonly ToolCatalogItem[];
  deferredController: AgentLoopTurnInput['deferredController'];
  turnResidentTools: () => Set<string>;
  refreshResolvedTools: () => AgentTool[];
  harness: Readonly<{ emptyReplyRetries?: number; requestTimeoutMs?: number }>;
  executableTools: ExecutableToolRegistry;
  getLlmTools: () => TLlmTools;
  setLlmTools: (next: TLlmTools) => void;
  state: TurnToolLoopState;
}) {
  const {
    input,
    providerAlias,
    llmModel,
    persistentConversation,
    directTools,
    prepareReply,
    withReplyTransition,
    turnShellPolicy,
    execPolicyConfig,
    systemPrompt,
    outputSchema,
    catalog,
    deferredController,
    turnResidentTools,
    refreshResolvedTools,
    harness,
    executableTools,
    getLlmTools,
    setLlmTools,
    state,
  } = params;
  const { host, sessionId } = input;

  const completionUsage = trackTurnCompletionUsage(
    host.completion,
    host.imageAssets ? (message, replySignal) => publishReplyImages(message, host.imageAssets!, replySignal) : undefined,
    { turnId: traceTurnId(input.turnContext), recordBodies: host.config.recordRequestBodies },
    input.interactiveRun,
  );
  const localInspection = host.localAssets ? new LocalImageInspection(
    host.localAssets,
    { ...input.turnContext, sessionKey: input.turnContext.session.key },
    input.imageInspectionBudget ?? { remaining: host.mediaPerception?.maxItemsPerTurn ?? DEFAULT_PERCEPTION_SETTINGS.maxItemsPerTurn },
    host.mediaPerception,
    completionUsage.recordMediaUsage,
  ) : undefined;
  if (localInspection) completionUsage.transport = localInspection.wrap(completionUsage.transport);

  const rebuildLlmTools = (): TLlmTools => {
    // Provider requests omit schemas during answering; retain the local execution catalog
    // so an admitted follow-up can resume ordinary tools in its own phase.
    if (state.answering) return getLlmTools();
    const refreshed = refreshResolvedTools();
    const nextAgentTools = turnShellPolicy
      ? refreshed
      : applyExecPolicyToTools(execPolicyConfig, refreshed, {
          approvalMode: execPolicyConfig.execApprovalMode,
        });
    executableTools.replace(nextAgentTools);
    const nextLlmTools = withReplyTransition((directTools
      ? agentToolsToLlmTools(nextAgentTools)
      : buildLlmToolsForProvider({
          nativeDeferredTools: llmModel.nativeDeferredTools === true,
          catalog,
          apiTools: nextAgentTools,
          alwaysLoaded: turnResidentTools(),
          sessionLoadedNames: deferredController?.loadedToolNames() ?? [],
        })) as TLlmTools);
    setLlmTools(nextLlmTools);
    return nextLlmTools;
  };

  const contextWindow = llmModel.contextWindow || host.config.contextTokens;
  // System prompt and tool schemas count against the window too, so the
  // compaction threshold is measured on what is left for messages (#730).
  let budgetTools: TLlmTools | undefined;
  let fixedBudget: Promise<number> | undefined;
  const fixedPromptTokens = () => {
    const currentTools = getLlmTools();
    // 本回合系统提示不变；工具渐进披露替换数组后重新计算完整 Schema。
    if (!fixedBudget || budgetTools !== currentTools) {
      budgetTools = currentTools;
      fixedBudget = estimateContextFixedTokens({
        systemPrompt,
        tools: currentTools,
        model: llmModel,
        outputSchema: outputSchema as Parameters<typeof estimateContextFixedTokens>[0]['outputSchema'],
      });
    }
    return fixedBudget;
  };

  // The wrapper is inside resilience: every actual attempt gets an independent candidate epoch.
  const attempt = (method: keyof LlmCompletionPort): LlmCompletionPort['complete'] => async (model, context, options) => {
    if (!state.answering) return completionUsage.transport[method](model, context, options);
    const run = state.replyRun;
    if (!run) return completionUsage.transport[method](model, { ...context, tools: undefined }, options);
    const epoch = run.begin();
    return completionUsage.transport[method](model, { ...context, tools: undefined }, {
      ...options,
      signal: options?.signal ? AbortSignal.any([options.signal, run.failureSignal]) : run.failureSignal,
      onTextDelta: text => { options?.onTextDelta?.(text); run.append(text, epoch); },
      retryAllowed: () => !run.offered && options?.retryAllowed?.() !== false,
    });
  };
  const resilientCompletion = createTurnCompletionPort({
    host,
    providerAlias,
    harness,
    sessionId,
    transport: { complete: attempt('complete'), completeSimple: attempt('completeSimple') },
  });
  const complete = (method: keyof LlmCompletionPort): LlmCompletionPort['complete'] => async (model, context, options) => {
    state.preparedCallId = undefined;
    const assistant = await resilientCompletion[method](model, context, options);
    if (prepareReply && !state.answering && !assistant.errorMessage && assistant.stopReason === 'toolCalls') {
      const calls = assistant.content.filter(block => block.type === 'toolCall');
      if (calls.length === 1 && calls[0]!.name === 'prepare_reply') state.preparedCallId = calls[0]!.id;
    }
    return assistant;
  };
  const completionPort: LlmCompletionPort = { complete: complete('complete'), completeSimple: complete('completeSimple') };

  // An isolated child owns its circuit breaker; later turns must not inherit its failures.
  const compactionRuntime = !persistentConversation && input.interactiveRun
    ? new AgentCompactionRuntime() : host.compactionRuntime;

  const resolveSummary = createTurnSummaryExecutionResolver({ transport: host.completion, model: llmModel });
  const summaryExecution = async () => {
    const summary = await resolveSummary();
    return { transport: completionUsage.forTransport(summary.transport), model: summary.model };
  };

  return {
    completionUsage,
    localInspection,
    rebuildLlmTools,
    contextWindow,
    fixedPromptTokens,
    completionPort,
    compactionRuntime,
    summaryExecution,
  };
}

export function createTurnToolLoopHandlers<TLlmTool extends { readonly name: string }>(params: {
  input: AgentLoopTurnInput;
  hasTools: boolean;
  prepareReply: boolean;
  executableTools: ExecutableToolRegistry;
  catalog: readonly ToolCatalogItem[];
  deferredController: AgentLoopTurnInput['deferredController'];
  localInspection: LocalImageInspection | undefined;
  explorationBudget: ExplorationBudget | undefined;
  spinDetector: SpinDetector | undefined;
  toolCalls: ToolCallRecord[];
  recordProgress: (toolName: string, args: unknown, ok: boolean, output?: string) => ToolProgressKind;
  rebuildLlmTools: () => readonly TLlmTool[];
  state: TurnToolLoopState;
}) {
  const {
    input,
    hasTools,
    prepareReply,
    executableTools,
    catalog,
    deferredController,
    localInspection,
    explorationBudget,
    spinDetector,
    toolCalls,
    recordProgress,
    rebuildLlmTools,
    state,
  } = params;
  const { host, sessionId, signal, loopHooks } = input;
  const policySnapshot = approvalPolicySnapshot(host.config);
  const policyStamp = formatPolicyStamp(policySnapshot);

  return {
    executeTool: async (toolCall: ParsedToolCall, _tools: readonly TLlmTool[], _toolSignal?: AbortSignal, cause?: ToolExecutionCause) => {
      if (prepareReply && toolCall.name === 'prepare_reply') {
        if (state.answering || state.preparedCallId !== toolCall.id) {
          return toolResultToAgentMessage(toolCall, 'prepare_reply must be the only tool call in a completed assistant turn.', true);
        }
        state.answering = true;
        state.stopProgress();
        return toolResultToAgentMessage(toolCall, 'Final answer phase. All tools are unavailable; publish the structured reply now.', false);
      }
      if (state.answering) return toolResultToAgentMessage(toolCall, 'Tools are unavailable during the public answer.', true);
      const stopped = input.interactiveRun?.check();
      if (stopped) return toolResultToAgentMessage(toolCall, stopped, true);
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
          const sideEffect = executableTools.resolve(resolvedName)?.isReadOnly !== true;
          const reason = formatUnexecutedToolResult(resolvedName, 'denied', preDecision.reason, sideEffect);
          recordProgress(resolvedName, effectiveArgs, false);
          toolCalls.push({ tool: resolvedName, args: effectiveArgs, result: reason, status: 'denied', sideEffect });
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
        state.activeTools += 1;
        const outcome = await input.toolExecution.execute(tool, effectiveArgs, toolCall.id, cause);
        if (outcome.status === 'cancelled') {
          const cancellation = signal?.reason instanceof Error
            ? signal.reason
            : new DOMException(outcome.reason, 'AbortError');
          throw cancellation;
        }
        if (outcome.status !== 'completed') {
          // #1250: say plainly that the call did not run, so the reply cannot claim it did.
          const sideEffect = outcome.sideEffect ?? tool.isReadOnly !== true;
          const unexecuted = formatUnexecutedToolResult(resolvedName, outcome.status,
            outcome.status === 'failed' ? outcome.error : outcome.reason, sideEffect);
          // #1250: a denial records the policy it was decided under, so a later policy change can retire it.
          const reason = outcome.status === 'denied' ? `${unexecuted}\n${policyStamp}` : unexecuted;
          recordProgress(resolvedName, effectiveArgs, false);
          toolCalls.push({ tool: resolvedName, args: effectiveArgs, result: reason, status: outcome.status, sideEffect });
          return toolResultToAgentMessage(toolCall, reason, true,
            outcome.status === 'denied' ? policySnapshot.fingerprint : undefined);
        }
        const rawText = await applyToolToModelOutput(tool, outcome.output, effectiveArgs);
        let modelOutput = outcome.output;

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
            modelOutput = postDecision.modifiedOutput;
            resultText = typeof postDecision.modifiedOutput === 'string'
              ? postDecision.modifiedOutput
              : JSON.stringify(postDecision.modifiedOutput);
          }
        }
        // MCP capture already removed bytes before execution returned. Only enqueue
        // an authorized metadata reference after the output hook has accepted it.
        resultText = localInspection?.accept(modelOutput) ?? resultText;

        const progressKind = recordProgress(resolvedName, effectiveArgs, true, resultText);
        const budgetNote = explorationBudget?.record(resolvedName, isProgress(progressKind));
        const spin = spinDetector?.record(resolvedName, effectiveArgs, resultText);
        if (spin) noteTurnTrace(traceTurnId(input.turnContext), { kind: 'spin_hint', family: spin.family, calls: spin.calls, reason: spin.reason });
        const localIteration = state.iterations - state.segmentStartIteration;
        const lastStep = !input.interactiveRun && hasTools && state.currentLimit > 2 && localIteration === state.currentLimit - 1 && state.nudgedIteration !== state.iterations;
        if (lastStep) {
          state.nudgedIteration = state.iterations;
          noteTurnTrace(traceTurnId(input.turnContext), { kind: 'last_iteration_nudge', iteration: localIteration, limit: state.currentLimit });
        }
        const notes = [budgetNote, spin?.note, lastStep ? LAST_ITERATION_NUDGE : undefined].filter(Boolean).join('\n\n');
        const finalText = notes ? `${resultText}\n\n${notes}` : resultText;
        toolCalls.push({ tool: resolvedName, args: effectiveArgs, result: finalText, status: 'completed' });
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
        const sideEffect = tool.isReadOnly !== true;
        const failure = formatUnexecutedToolResult(resolvedName, 'failed', message, sideEffect);
        recordProgress(resolvedName, effectiveArgs, false);
        toolCalls.push({ tool: resolvedName, args: effectiveArgs, result: failure, status: 'failed', sideEffect });
        return toolResultToAgentMessage(toolCall, failure, true);
      } finally {
        state.activeTools -= 1;
      }
    },
    beforeToolCall: async ({ toolCall }: { toolCall: ParsedToolCall }) => {
      if (state.answering) return { allowed: false, reason: 'Tools are unavailable during the public answer.' };
      if (prepareReply && toolCall.name === 'prepare_reply') return;
      return loopHooks?.runBeforeToolCall({ toolCall, sessionId });
    },
    afterToolCall: async ({ toolCall, result }: { toolCall: ParsedToolCall; result: AgentMessage }) => {
      if (prepareReply && toolCall.name === 'prepare_reply') return;
      await loopHooks?.runAfterToolCall({ toolCall, result, sessionId });
    },
    refreshTools: hasTools ? () => rebuildLlmTools() as TLlmTool[] : undefined,
    // The model called a deferred catalog tool without load_tool: load it and
    // run the call. The catalog only holds tools this turn may use, and the
    // rebuilt list re-applies exec policy, so disallowed tools stay rejected.
    resolveMissingTool: hasTools
      ? async (name: string) => state.answering ? undefined : createMissingToolResolver<TLlmTool>({
          catalog,
          load: deferredController?.load?.bind(deferredController),
          rebuild: rebuildLlmTools,
        })?.(name)
      : undefined,
    shouldRecompleteAfterTool: (result: AgentMessage) => {
      if (state.answering && result.role === 'toolResult' && result.toolName === 'prepare_reply' && !result.isError) return true;
      if (result.role !== 'toolResult' || !Array.isArray(result.content)) return false;
      return result.content.some(
        (block) =>
          block.type === 'text'
          && typeof block.text === 'string'
          && block.text.includes('__zhin_tools_mutated__'),
      );
    },
  };
}
