/**
 * agentLoop turn runner (ADR 0009) — used when ContextRepository is wired.
 */

import {
  agentLoop,
  agentContextFrom,
  createUserMessage,
  type AgentMessage,
  type AssistantMessage,
} from '@zhin.js/ai';
import type { ReplyPhaseFacts } from './reply-phase.js';
import type { AgentOutputElement } from '../outbound/agent-output.js';
import { tokenUsageToLegacy } from './agent-run-shared.js';
import type { ToolCallRecord } from './tool-calls-user-format.js';
import { summarizeExhaustedTurn } from './exhausted-turn-reply.js';
import { turnReplyMessages } from './turn-reply-messages.js';
import { logPhase, tokenUsageLogFields, logAgentLoopIterationEnd } from '../internal/phase-trace.js';
import type { TurnEvent } from '../event/turn-event.js';
import {
  createTurnEventMapperState,
  mapAgentEventToTurnEvents,
} from './turn-event-mapper.js';
import {
  TurnProgressTracker,
  autoContinueAllowed,
  buildContinuationInstruction,
  resolveToolBudget,
} from './turn-progress.js';
import { TurnProgressReporter, summarizeProgress } from './progress-reporter.js';
import { stampAssistantHeaders } from '../session/participant-header-stamp.js';
import { noteTurnTrace } from '../trace/turn-trace-registry.js';
import {
  resolveAssistantReplyText,
  logAssistantIterationFailure,
  turnEndFromLegacyUsage,
  collectAgentLoopTurnRun,
  prepareAgentLoopTurnSetup,
} from './agent-loop-turn-setup.js';
import {
  createTurnCompletionRuntime,
  createTurnToolLoopHandlers,
  traceTurnId,
  type AgentLoopTurnInput,
  type AgentLoopTurnResult,
  type TurnToolLoopState,
} from './agent-core-ports.js';
import {
  createTurnReplyPhaseController,
  createTurnContextCallbacks,
  finalizeTurnReplyAndOutput,
  appendConversationBatches,
  type ConversationBatch,
  type TurnReplyPhaseState,
} from './agent-core-settlement.js';
import {
  extractCompletedToolRoundMessages,
  isCheckpointResumePrompt,
  type TurnCheckpointRecord,
} from '../turn/turn-checkpoint-store.js';

export {
  collectAgentLoopTurnRun,
  type AgentLoopTurnInput,
  type AgentLoopTurnResult,
};

export async function* runAgentLoopTextTurnRun(
  input: AgentLoopTurnInput,
): AsyncGenerator<TurnEvent, AgentLoopTurnResult> {
  const {
    host,
    sessionId,
    userMessageExtra,
    modelId,
    onChunk,
    promptHooks,
    signal,
  } = input;

  const repo = host.contextRepository;
  const persistentConversation = input.conversationPersistence !== 'none';
  const loaded = persistentConversation
    ? await repo.loadContext(sessionId)
    : { messages: [] as AgentMessage[] };

  let resumedCheckpoint: TurnCheckpointRecord | undefined;
  let resumedWithExplicitContinue = false;
  if (persistentConversation && host.turnCheckpoints) {
    const existingCheckpoint = await host.turnCheckpoints.peek(sessionId);
    if (existingCheckpoint) {
      const persistedToolCallIds = new Set(
        loaded.messages
          .filter((m): m is Extract<AgentMessage, { role: 'toolResult' }> => m.role === 'toolResult')
          .map((m) => m.toolCallId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      );
      const alreadyPersisted = existingCheckpoint.messages.some(
        (m) =>
          m.role === 'toolResult' &&
          typeof m.toolCallId === 'string' &&
          persistedToolCallIds.has(m.toolCallId),
      );
      if (alreadyPersisted) {
        await host.turnCheckpoints.clear(sessionId);
      } else {
        const resumeMatch = isCheckpointResumePrompt(input.rawContent, existingCheckpoint.promptText);
        if (resumeMatch.resume) {
          resumedCheckpoint = await host.turnCheckpoints.consume(sessionId);
          resumedWithExplicitContinue = resumeMatch.isExplicitContinue;
          logPhase(host.phaseConfig, 'agent_loop.checkpoint.resume', sessionId, {
            checkpointIterations: existingCheckpoint.iterations,
            checkpointMessages: existingCheckpoint.messages.length,
            explicitContinue: resumedWithExplicitContinue,
          });
        } else {
          await host.turnCheckpoints.clear(sessionId);
        }
      }
    }
  }
  const checkpointPromptText = resumedCheckpoint?.promptText || input.rawContent || '';
  const effectiveUserMessageExtra = resumedCheckpoint?.userMessageExtra ?? userMessageExtra;
  const effectiveInput: AgentLoopTurnInput = resumedCheckpoint
    ? {
        ...input,
        rawContent: checkpointPromptText,
        userMessageExtra: effectiveUserMessageExtra,
      }
    : input;

  const setup = await prepareAgentLoopTurnSetup(effectiveInput, loaded.messages);
  const {
    providerAlias, llmModel, promptMessages, historyWindow, historyTracker,
    directTools, hasTools, imReply, replyPhases, initialReplyPhase, initialReplyRun,
    prepareReply, withReplyTransition, chatFailure, outputSchema, turnShellPolicy,
    execPolicyConfig, proseSystemPrompt, systemPrompt, systemPromptCacheBreakpoint,
    agentTools, deferredController, catalog, turnResidentTools, refreshResolvedTools,
    harness, maxIterations, explorationBudget, spinDetector, executableTools,
  } = setup;
  let llmTools = setup.initialLlmTools;

  let stopProgressFn: (() => void) | undefined;
  const state: TurnReplyPhaseState & TurnToolLoopState = {
    replyPhaseId: initialReplyPhase?.id, replyRun: initialReplyRun,
    phaseSettled: false, phaseStopped: false, phaseAssistant: undefined,
    phaseLastAssistant: undefined, phaseToolStart: 0,
    settledPhaseOutput: [] as AgentOutputElement[], settledPhaseCount: 0,
    answering: !!initialReplyRun && !hasTools, preparedCallId: undefined,
    nudgedIteration: 0, activeTools: 0, iterations: 0, segmentStartIteration: 0,
    currentLimit: maxIterations, lastAssistantText: '',
    lastAssistantHadToolCalls: false, lastAssistantNeedsHostReply: false,
    segmentMessages: [] as AgentMessage[], turnTranscript: [] as AgentMessage[],
    continuations: 0, stopProgress: () => { stopProgressFn?.(); },
  };

  const toolCalls: ToolCallRecord[] = [];
  const conversationBatches: ConversationBatch[] = [];
  const conversationProjectionCopies = new Map<AgentMessage, AgentMessage[]>();
  const conversationPhaseFacts = new Map<AgentMessage, ReplyPhaseFacts>();

  const {
    completionUsage, localInspection, rebuildLlmTools, contextWindow,
    fixedPromptTokens, completionPort, compactionRuntime, summaryExecution,
  } = createTurnCompletionRuntime({
    input, providerAlias, llmModel, persistentConversation, directTools,
    prepareReply, withReplyTransition, turnShellPolicy, execPolicyConfig,
    systemPrompt, outputSchema, catalog, deferredController, turnResidentTools,
    refreshResolvedTools, harness, executableTools,
    getLlmTools: () => llmTools, setLlmTools: (next) => { llmTools = next; }, state,
  });

  logPhase(host.phaseConfig, 'agent_loop.turn.start', sessionId, {
    model: modelId,
    maxIterations,
    toolCount: agentTools.length,
  });

  const loopContext = agentContextFrom({
    systemPrompt,
    systemPromptCacheBreakpoint,
    messages: loaded.messages,
    tools: llmTools,
  });

  // Progress-aware budget: maxIterations is soft, extended while progressing.
  const toolBudget = resolveToolBudget(host.config.toolBudget, harness);
  const progress = new TurnProgressTracker(toolBudget, !!input.interactiveRun);
  const turnStartedAt = Date.now();
  let extensionPending = false;
  let lastReportIteration = 0;
  const segmentHardCap = Math.max(maxIterations, input.maxTotalIterations ?? toolBudget.maxTotalIterations);
  const hardLimitReached = () =>
    input.interactiveRun ? !!input.interactiveRun.check()
      : (toolBudget.maxWallClockMs > 0 && Date.now() - turnStartedAt >= toolBudget.maxWallClockMs)
        || (toolBudget.maxTotalTokens > 0 && completionUsage.usage.totalTokens >= toolBudget.maxTotalTokens);
  const nextIterationLimit = (iteration: number, limit: number): number => {
    state.currentLimit = limit;
    if (input.interactiveRun) return state.phaseStopped || hardLimitReached() || progress.stalled ? iteration : iteration + 1;
    if (state.phaseStopped || iteration > 0 && hardLimitReached()) return iteration;
    if (iteration < limit) return limit;
    if (toolBudget.extendBy === 0 || limit >= segmentHardCap || progress.stalled) return limit;
    const windowStart = state.segmentStartIteration + iteration - toolBudget.progressWindow + 1;
    if (!progress.progressedSince(windowStart)) return limit;
    const next = Math.min(segmentHardCap, limit + toolBudget.extendBy);
    state.currentLimit = next;
    extensionPending = true;
    noteTurnTrace(traceTurnId(input.turnContext), { kind: 'budget_extended', from: limit, to: next });
    logPhase(host.phaseConfig, 'agent_loop.budget.extend', sessionId, { from: limit, to: next });
    return next;
  };
  const recordProgress = (toolName: string, args: unknown, ok: boolean, output?: string) =>
    progress.record(state.iterations, { toolName, args, ok, output });

  let loopDepth = 0;
  const pendingToolResults = new Map<string, AgentMessage>();
  const flushToolResults = () => {
    const assistant = [...state.segmentMessages].reverse().find(message => message.role === 'assistant') as AssistantMessage | undefined;
    for (const block of assistant?.content ?? []) {
      if (block.type !== 'toolCall') continue;
      const result = pendingToolResults.get(block.id);
      if (result) { state.segmentMessages.push(result); pendingToolResults.delete(block.id); }
    }
    for (const result of pendingToolResults.values()) state.segmentMessages.push(result);
    pendingToolResults.clear();
  };

  const reporter = input.progressSink && toolBudget.progressMaxUpdates > 0 && (input.interactiveRun || hasTools)
    ? new TurnProgressReporter({
        locale: input.turnContext.input?.locale,
        sink: input.progressSink,
        minIntervalMs: toolBudget.progressMinIntervalMs,
        maxUpdates: input.interactiveRun ? undefined : toolBudget.progressMaxUpdates,
        signal,
        summarize: () => input.interactiveRun ? Promise.resolve(undefined) : summarizeProgress({
          locale: input.turnContext.input?.locale,
          transport: completionUsage.transport,
          model: llmModel,
          systemPrompt: proseSystemPrompt,
          messages: [...loaded.messages, ...state.turnTranscript, ...state.segmentMessages],
          sessionId,
          signal,
        }),
      })
    : undefined;
  const progressState = () => ({
    steps: state.iterations,
    interimText: !state.answering && state.lastAssistantHadToolCalls ? state.lastAssistantText : undefined,
    activityText: turnReplyMessages(input.turnContext.input?.locale, state.activeTools > 0 ? 'waiting' : 'working'),
  });
  stopProgressFn = input.interactiveRun && !state.answering ? reporter?.watch(progressState) : undefined;
  const restartProgress = () => {
    stopProgressFn?.();
    stopProgressFn = input.interactiveRun && !state.answering ? reporter?.watch(progressState) : undefined;
  };

  const { settlePhase, queuedMessages } = createTurnReplyPhaseController({
    input,
    replyPhases,
    hasTools,
    toolCalls,
    conversationBatches,
    conversationProjectionCopies,
    conversationPhaseFacts,
    transport: completionUsage.transport,
    llmModel,
    chatFailure,
    state,
    rebuildLlmTools: () => { rebuildLlmTools(); },
    restartProgress,
    flushToolResults,
  });

  const toolHandlers = createTurnToolLoopHandlers({
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
  });

  const loopConfig = {
    model: llmModel,
    transport: completionPort,
    maxIterations,
    sessionId,
    ...createTurnContextCallbacks({
      input,
      persistentConversation,
      providerAlias,
      modelId,
      hasTools,
      llmModel,
      outputSchema,
      historyTracker,
      historyWindow,
      compactionRuntime,
      completionPort,
      summaryExecution,
      contextWindow,
      fixedPromptTokens,
      state,
    }),
    getSteeringMessages: promptHooks?.getSteeringMessages
      ? () => queuedMessages(() => promptHooks.getSteeringMessages!()) : undefined,
    getFollowUpMessages: promptHooks?.getFollowUpMessages
      ? () => queuedMessages(() => promptHooks.getFollowUpMessages!()) : undefined,
    ...toolHandlers,
    maxRecompletePerIteration: 1,
    toolExecution: host.config.toolExecution ?? 'tiered',
    nextIterationLimit,
  };

  const mapperState = createTurnEventMapperState(maxIterations);
  if (input.interactiveRun) mapperState.maxIterations = undefined;

  const emitTurnEvent = (event: TurnEvent) => {
    input.onTurnEvent?.(event);
  };

  const autoContinue = hasTools
    && !input.interactiveRun
    && input.autoContinuation !== false
    && autoContinueAllowed(toolBudget.autoContinue, input.turnContext);
  let segmentPrompt = resumedCheckpoint
    ? [...resumedCheckpoint.messages]
    : promptMessages;
  let segmentContext = loopContext;

  const saveCompletedCheckpointIfAny = async () => {
    if (!persistentConversation || !host.turnCheckpoints) return;
    if (state.replyRun?.offered || state.settledPhaseCount > 0) {
      await host.turnCheckpoints.clear(sessionId);
      return;
    }
    const checkpointMessages = extractCompletedToolRoundMessages([
      ...state.turnTranscript,
      ...state.segmentMessages,
    ]);
    if (checkpointMessages.length > 0) {
      await host.turnCheckpoints.save({
        sessionId,
        promptText: checkpointPromptText,
        messages: checkpointMessages,
        iterations: state.iterations,
        updatedAt: Date.now(),
        ...(effectiveUserMessageExtra !== undefined
          ? { userMessageExtra: effectiveUserMessageExtra }
          : {}),
      });
    }
  };

  function* drainCompletionUsage(): Generator<TurnEvent> {
    for (const event of completionUsage.drainEvents()) {
      emitTurnEvent(event);
      yield event;
    }
  }

  // Each segment is one agentLoop run; continuations add segments to the same
  // Turn, so policy, approval ports and persisted history stay those of the Turn.
  try {
    while (true) {
      state.segmentStartIteration = state.iterations;
      progress.startSegment();
      state.lastAssistantHadToolCalls = false;
      state.segmentMessages = [...segmentPrompt];
      try {
        for await (const event of agentLoop(segmentPrompt, segmentContext, loopConfig, signal)) {
          if (event.type === 'agent_start') loopDepth += 1;
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
            if (!input.interactiveRun && !state.answering && reporter && progress.progressedSince(lastReportIteration + 1)) {
              const sent = await reporter.report(extensionPending ? 'extension' : 'progress', {
                steps: state.iterations,
                interimText: !imReply && state.lastAssistantHadToolCalls ? state.lastAssistantText : undefined,
              });
              if (sent) lastReportIteration = state.iterations;
            }
            extensionPending = false;
            state.iterations += 1;
          }
          if (event.type === 'tool_execution_end' && event.result.role === 'toolResult' && typeof event.result.toolCallId === 'string') {
            pendingToolResults.set(event.result.toolCallId, event.result);
          }
          if (event.type === 'turn_end') {
            flushToolResults();
            if (event.toolResults.length > 0) {
              await saveCompletedCheckpointIfAny();
            }
          }
          if (event.type === 'message_end') {
            flushToolResults();
            state.segmentMessages.push(event.message as AgentMessage);
          }
          if (!imReply && event.type === 'message_update' && event.delta?.type === 'text_delta') {
            onChunk?.(event.delta.text, state.lastAssistantText + event.delta.text);
          }
          if (event.type === 'message_end' && event.message.role === 'assistant') {
            const assistant = event.message as AssistantMessage;
            state.phaseLastAssistant = assistant;
            state.lastAssistantHadToolCalls = assistant.content.some((block) => block.type === 'toolCall');
            if (!state.lastAssistantHadToolCalls) state.phaseAssistant = assistant;
            const answerText = assistant.content
              .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
              .map(block => block.text).join('');
            state.lastAssistantNeedsHostReply = Boolean(assistant.errorMessage)
              || (!state.lastAssistantHadToolCalls && !answerText.trim());
            state.lastAssistantText = imReply && !state.lastAssistantNeedsHostReply ? answerText
              : resolveAssistantReplyText(imReply ? { ...assistant, content: [] } : assistant, chatFailure);
            logAssistantIterationFailure(assistant, modelId, sessionId);
            const toolNames = assistant.content
              .filter((b): b is Extract<typeof b, { type: 'toolCall' }> => b.type === 'toolCall')
              .map((b) => b.name)
              .join(',');
            logAgentLoopIterationEnd(host.phaseConfig, sessionId, {
              iteration: state.iterations,
              model: modelId,
              label: hasTools ? 'orchestrator' : 'chat',
              usage: assistant.usage,
              stopReason: assistant.stopReason,
              toolNames: toolNames || undefined,
            });
            if (!imReply) onChunk?.(state.lastAssistantText, state.lastAssistantText);
          }
          if (event.type === 'agent_end') {
            loopDepth -= 1;
            if (loopDepth > 0) continue;
            if (signal?.aborted && !state.replyRun?.offered && !state.settledPhaseCount) continue;
            flushToolResults();
            const batch = state.segmentMessages;
            state.turnTranscript = [...state.turnTranscript, ...batch];
            const messageExtras = batch.map((msg, i) => (
              msg.role === 'user' && i === 0 && state.continuations === 0 ? effectiveUserMessageExtra : undefined
            ));
            if (persistentConversation) {
              const messages = input.turnContext.origin.kind === 'im' ? stampAssistantHeaders(batch, input.turnContext.input?.contextState?.bot) : batch;
              for (const [index, source] of batch.entries()) {
                if (messages[index] === source) continue;
                const copies = conversationProjectionCopies.get(source) ?? [];
                copies.push(messages[index]!);
                conversationProjectionCopies.set(source, copies);
                const facts = conversationPhaseFacts.get(source);
                if (facts) conversationPhaseFacts.set(messages[index]!, facts);
              }
              conversationBatches.push({ messages, messageExtras });
            }
          }
        }
      } catch (loopErr) {
        if (signal?.aborted) {
          flushToolResults();
          await saveCompletedCheckpointIfAny();
        }
        throw loopErr;
      }
      // Auto-continue only a Turn that stopped mid-task (model still calling tools)
      // after real progress, within the continuation and hard caps.
      if (!autoContinue
        || state.phaseStopped
        || signal?.aborted
        || !state.lastAssistantHadToolCalls
        || !progress.segmentProgressed
        || state.continuations >= toolBudget.maxContinuations
        || hardLimitReached()) break;
      const checkpoint = await summarizeExhaustedTurn({
        locale: input.turnContext.input?.locale,
        transport: completionUsage.transport,
        model: llmModel,
        systemPrompt: proseSystemPrompt,
        messages: [...loaded.messages, ...state.turnTranscript],
        maxIterations: state.iterations - state.segmentStartIteration,
        sessionId,
        signal,
      });
      if (!checkpoint.assistant || signal?.aborted) break;
      conversationBatches.at(-1)?.messages.push(checkpoint.assistant);
      conversationBatches.at(-1)?.messageExtras.push(undefined);
      state.turnTranscript = [...state.turnTranscript, checkpoint.assistant];
      state.continuations += 1;
      await reporter?.report('continuation', { steps: state.iterations, interimText: checkpoint.reply });
      lastReportIteration = state.iterations;
      noteTurnTrace(traceTurnId(input.turnContext), { kind: 'continuation', index: state.continuations });
      logPhase(host.phaseConfig, 'agent_loop.budget.continue', sessionId, { continuation: state.continuations });
      segmentPrompt = [createUserMessage(buildContinuationInstruction(state.continuations, toolBudget.maxContinuations, reporter?.reported))];
      segmentContext = agentContextFrom({
        systemPrompt,
        systemPromptCacheBreakpoint,
        messages: [...loaded.messages, ...state.turnTranscript],
        tools: llmTools,
      });
    }
  } finally {
    stopProgressFn?.();
  }

  // Progress updates already reached the user, finished or not (#730 ledger).
  if (persistentConversation && reporter) {
    for (const text of reporter.reported) {
      host.toldLedger?.record(sessionId, text, 'progress', traceTurnId(input.turnContext));
    }
  }

  yield* drainCompletionUsage();
  if (signal?.aborted) {
    flushToolResults();
    await saveCompletedCheckpointIfAny();
    await state.replyRun?.stop();
    if (replyPhases) await settlePhase([], '', true);
    const usage = tokenUsageToLegacy(completionUsage.usage);
    const endEvent = turnEndFromLegacyUsage('', usage);
    emitTurnEvent(endEvent);
    yield endEvent;
    const thinking = mapperState.accumulatedThinking.trim() || undefined;
    return {
      reply: '',
      ...(!replyPhases && state.replyRun?.offered ? { progressive: { run: state.replyRun } } : {}),
      replyPhaseId: state.replyPhaseId,
      ...(state.phaseStopped ? { replyPhaseStopped: true as const } : {}),
      usage,
      path: hasTools ? 'agent' : 'chat',
      iterations: state.iterations,
      model: modelId,
      toolCalls,
      thinking,
      projectConversation: (delivered) => appendConversationBatches(repo, sessionId, conversationBatches, replyPhases ? undefined : delivered, conversationPhaseFacts),
    };
  }
  if (persistentConversation && host.turnCheckpoints) {
    await host.turnCheckpoints.clear(sessionId);
  }

  const {
    output,
    finalReply,
    needsReplyRecovery,
    hostReply,
    stopped,
    progressive,
    unexecutedNotice,
  } = await finalizeTurnReplyAndOutput({
    input,
    state,
    progressStalled: progress.stalled,
    hasTools,
    imReply,
    maxIterations,
    systemPrompt,
    outputSchema,
    chatFailure,
    loadedMessages: loaded.messages,
    toolCalls,
    conversationBatches,
    transport: completionUsage.transport,
    llmModel,
    replyPhases,
    settlePhase,
  });

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
    iterations: state.iterations,
    ...tokenUsageLogFields(completionUsage.usage),
  });

  const usage = tokenUsageToLegacy(completionUsage.usage);
  const endEvent: TurnEvent = {
    type: 'turn_end',
    output,
    usage: { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens },
  };
  emitTurnEvent(endEvent);
  yield endEvent;
  const thinking = mapperState.accumulatedThinking.trim() || undefined;
  return {
    reply: finalReply,
    output,
    progressive,
    ...(unexecutedNotice ? { unexecutedNotice } : {}),
    replyPhaseId: state.replyPhaseId,
    ...(state.phaseStopped ? { replyPhaseStopped: true as const } : {}),
    usage,
    path: hasTools ? 'agent' : 'chat',
    iterations: state.iterations,
    model: modelId,
    toolCalls,
    thinking,
    stoppedReason: stopped ?? (input.interactiveRun && state.lastAssistantNeedsHostReply ? state.lastAssistantText : undefined),
    // A host fallback is absent from the model transcript, so it cannot cover its canonical event.
    projectConversation: (delivered) => appendConversationBatches(
      repo,
      sessionId,
      conversationBatches,
      replyPhases ? undefined : hostReply && delivered ? { ...delivered, contextRefs: undefined } : delivered,
      conversationPhaseFacts,
    ),
  };
}
