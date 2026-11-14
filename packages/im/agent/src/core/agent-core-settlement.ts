import type { ReplyStreamSnapshot } from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  EMPTY_TOKEN_USAGE,
  createLlmMessageProjection,
  parseOutput,
  assistantText,
  type AgentMessage,
  type AssistantMessage,
  type LlmCompletionPort,
} from '@zhin.js/ai';
import { ReplyStreamRun } from './reply-stream-run.js';
import type { ReplyPhaseLifecycle, ReplyPhaseFacts } from './reply-phase.js';
import { decodeStructuredReply } from '../outbound/structured-reply.js';
import { renderAgentOutput, type AgentOutputElement } from '../outbound/agent-output.js';
import { mergeToolOutboundElements } from '../media/media-tool-bridge.js';
import { sanitizeAssistantReply } from './text-sanitize.js';
import { formatToolCallsForUser, type ToolCallRecord } from './tool-calls-user-format.js';
import { acknowledgesUnexecuted, unresolvedSideEffectFailures } from './unexecuted-tool-notice.js';
import { summarizeExhaustedTurn } from './exhausted-turn-reply.js';
import { decodeLenientStructuredReply, recoverStructuredReply } from './structured-reply-recovery.js';
import { chatFailureLine, type ChatFailureOptions } from '../outbound/chat-failure.js';
import { turnReplyMessages } from './turn-reply-messages.js';
import { stampAssistantHeaders, stampDeliveredMessageId } from '../session/participant-header-stamp.js';
import { buildAgentPromptCacheStreamOptions } from '../config/index.js';
import type { AgentCompactionRuntime } from '../memory/compaction-runtime.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import type { AgentLoopTurnInput, AgentLoopTurnResult } from './agent-core-ports.js';

type TurnLlmModel = ReturnType<ZhinAgentPrivate['getTurnExecution']>['model'];

export function createTurnContextCallbacks(params: {
  input: AgentLoopTurnInput;
  persistentConversation: boolean;
  providerAlias: string;
  modelId: string;
  hasTools: boolean;
  llmModel: TurnLlmModel;
  outputSchema: Parameters<typeof summarizeExhaustedTurn>[0]['outputSchema'];
  historyTracker: { select: (sessionId: string, messages: AgentMessage[], window: { budget: number; maxMessages: number }) => { messages: AgentMessage[] } };
  historyWindow: { budget: number; maxMessages: number };
  compactionRuntime: AgentCompactionRuntime;
  completionPort: LlmCompletionPort;
  summaryExecution: () => Promise<{ transport: LlmCompletionPort; model: TurnLlmModel }>;
  contextWindow: number;
  fixedPromptTokens: () => Promise<number>;
  state: TurnReplyPhaseState;
}) {
  const {
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
  } = params;
  const { host, sessionId, loopHooks } = input;
  return {
    streamOptions: {
      ...buildAgentPromptCacheStreamOptions(host.config, {
        modelSdk: llmModel.promptFamily,
        promptCacheRouting: llmModel.promptCacheRouting,
        provider: providerAlias,
        modelId,
        label: hasTools ? 'orchestrator' : 'chat',
      }),
      ...(outputSchema ? { outputSchema } : {}),
      ...(state.replyRun ? { retryAllowed: () => !state.replyRun?.offered } : {}),
    },
    convertToLlm: persistentConversation
      ? ((base) => (messages: AgentMessage[]) => base(historyTracker.select(sessionId, messages, historyWindow).messages))(createLlmMessageProjection(llmModel, input.messageAliases))
      : createLlmMessageProjection(llmModel, input.messageAliases),
    transformContext: async (messages: AgentMessage[], ctxSignal?: AbortSignal) =>
      persistentConversation || input.interactiveRun ? compactionRuntime.transformContext(messages, ctxSignal, {
        host,
        sessionId,
        transport: completionPort,
        model: llmModel,
        resolveExecution: summaryExecution,
        compactionConfig: host.config.compaction,
        contextWindow,
        reservedTokens: await fixedPromptTokens(),
        toldLedger: host.toldLedger?.render(sessionId),
        mode: 'text',
        persistSummary: persistentConversation,
        loopHooks,
      }) : messages,
    onContextOverflow: async (messages: AgentMessage[], ctxSignal?: AbortSignal) =>
      state.replyRun?.offered ? undefined : persistentConversation || input.interactiveRun ? compactionRuntime.transformContext(messages, ctxSignal, {
        host,
        sessionId,
        transport: completionPort,
        model: llmModel,
        resolveExecution: summaryExecution,
        compactionConfig: host.config.compaction,
        contextWindow,
        reservedTokens: await fixedPromptTokens(),
        toldLedger: host.toldLedger?.render(sessionId),
        mode: 'text',
        force: true,
        persistSummary: persistentConversation,
        loopHooks,
      }) : messages,
  };
}

const logger = getLogger('ZhinAgent:AgentLoopTurn');

export interface ConversationBatch {
  messages: AgentMessage[];
  messageExtras: Array<import('@zhin.js/ai').AgentMessageExtra | undefined>;
}

export interface TurnReplyPhaseState {
  replyPhaseId: string | undefined;
  replyRun: ReplyStreamRun | undefined;
  phaseSettled: boolean;
  phaseStopped: boolean;
  phaseAssistant: AssistantMessage | undefined;
  phaseLastAssistant: AssistantMessage | undefined;
  phaseToolStart: number;
  settledPhaseOutput: AgentOutputElement[];
  settledPhaseCount: number;
  answering: boolean;
  preparedCallId: string | undefined;
  lastAssistantText: string;
  lastAssistantHadToolCalls: boolean;
  lastAssistantNeedsHostReply: boolean;
  segmentMessages: AgentMessage[];
  turnTranscript: AgentMessage[];
  iterations: number;
  continuations: number;
}

export function createTurnReplyPhaseController(params: {
  input: AgentLoopTurnInput;
  replyPhases: ReplyPhaseLifecycle | undefined;
  hasTools: boolean;
  toolCalls: ToolCallRecord[];
  conversationBatches: ConversationBatch[];
  conversationProjectionCopies: Map<AgentMessage, AgentMessage[]>;
  conversationPhaseFacts: Map<AgentMessage, ReplyPhaseFacts>;
  transport: LlmCompletionPort;
  llmModel: TurnLlmModel;
  chatFailure: ChatFailureOptions | undefined;
  state: TurnReplyPhaseState;
  rebuildLlmTools: () => void;
  restartProgress: () => void;
  flushToolResults: () => void;
}) {
  const {
    input,
    replyPhases,
    hasTools,
    toolCalls,
    conversationBatches,
    conversationProjectionCopies,
    conversationPhaseFacts,
    transport,
    llmModel,
    chatFailure,
    state,
    rebuildLlmTools,
    restartProgress,
    flushToolResults,
  } = params;
  const { sessionId, signal } = input;

  const settlePhase = async (output: AgentOutputElement[], raw: string, hostReply: boolean) => {
    if (!replyPhases || !state.replyPhaseId || state.phaseSettled) return;
    let snapshot: ReplyStreamSnapshot | undefined;
    if (state.replyRun) {
      await state.replyRun.stop();
      if (state.answering && !hostReply && !state.replyRun.error) {
        try { snapshot = await state.replyRun.complete(raw); } catch { /* Preserve the confirmed prefix. */ }
      }
    }
    const facts = await replyPhases.settle({
      id: state.replyPhaseId,
      output,
      reply: renderAgentOutput(output),
      ...(state.replyRun && (snapshot || state.replyRun.offered) ? { run: state.replyRun, ...(snapshot ? { snapshot } : {}) } : {}),
    });
    state.phaseSettled = true;
    state.settledPhaseOutput = output;
    state.settledPhaseCount += 1;
    state.phaseStopped ||= facts.stopped === true;
    if (!state.phaseAssistant && facts.confirmedOutput.length && state.phaseLastAssistant) {
      // agentLoop can retain only prepare_reply + toolResult after a failed re-completion.
      state.phaseAssistant = {
        ...state.phaseLastAssistant,
        stopReason: 'stop',
        errorMessage: undefined,
        usage: { ...EMPTY_TOKEN_USAGE, cost: { ...EMPTY_TOKEN_USAGE.cost } },
        content: [],
      };
      state.segmentMessages.push(state.phaseAssistant);
      const batch = conversationBatches.at(-1);
      if (batch) {
        if (batch.messages !== state.segmentMessages) batch.messages.push(state.phaseAssistant);
        batch.messageExtras.push(undefined);
      }
    }
    if (state.phaseAssistant) {
      state.phaseAssistant.content = [{ type: 'text', text: encodeConfirmedOutput(facts.confirmedOutput) }];
      delete state.phaseAssistant.messageId;
      delete state.phaseAssistant.conversationEventId;
      delete state.phaseAssistant.conversationEventIds;
      delete state.phaseAssistant.conversationKey;
      const headed = stampAssistantHeaders([state.phaseAssistant], input.turnContext.input?.contextState?.bot);
      const deliveryConv = facts.delivery.status !== 'suppressed' ? facts.delivery : undefined;
      const stamped = stampDeliveredMessageId(headed, facts.messageId, facts.contextRefs, facts.messageIds, {
        conversationSequence: facts.conversationSequence ?? deliveryConv?.conversationSequence,
        conversationSequences: facts.conversationSequences ?? deliveryConv?.conversationSequences,
        conversationKey: facts.conversationKey ?? deliveryConv?.conversationKey,
      })[0];
      if (stamped) Object.assign(state.phaseAssistant, stamped);
      conversationPhaseFacts.set(state.phaseAssistant, facts);
      for (const copy of conversationProjectionCopies.get(state.phaseAssistant) ?? []) {
        if (copy.role === 'assistant') {
          delete (copy as AssistantMessage).messageId;
          delete (copy as AssistantMessage).conversationEventId;
          delete (copy as AssistantMessage).conversationEventIds;
          delete (copy as AssistantMessage).conversationKey;
        }
        Object.assign(copy, state.phaseAssistant);
        conversationPhaseFacts.set(copy, facts);
      }
    }
  };

  const settleQueuedAnswer = async () => {
    if (!state.phaseAssistant || state.phaseSettled) return;
    const calls = toolCalls.slice(state.phaseToolStart);
    let output: AgentOutputElement[] = [];
    let raw = state.lastAssistantText;
    let hostReply = state.lastAssistantNeedsHostReply;
    if (!hostReply) {
      try { output = decodeStructuredReply(raw, input.replySegments); } catch (error) {
        if (!state.replyRun?.offered) {
          const lenient = decodeLenientStructuredReply(raw, input.replySegments);
          if (lenient) { output = lenient.output; raw = lenient.text; }
          else {
            const recovery = await recoverStructuredReply({
              transport,
              model: llmModel,
              raw,
              error: error instanceof Error ? error : new Error('Invalid structured reply'),
              signal,
              segments: input.replySegments,
              failureText: chatFailureLine('format', { ...chatFailure, random: 0 }),
            });
            output = recovery.output;
            raw = recovery.assistant ? assistantText(recovery.assistant) : raw;
            hostReply = !recovery.assistant;
          }
        }
      }
    } else output = parseOutput(sanitizeAssistantReply(raw));
    output = mergeToolOutboundElements(output, calls);
    if (input.messageAliases) output = resolveReplyAliases(output, input.messageAliases);
    await settlePhase(output, raw, hostReply);
  };

  const queuedMessages = async (read: () => Promise<AgentMessage[]>) => {
    if (state.phaseStopped) return [];
    const batch = await read();
    if (!batch.length) return batch;
    if (replyPhases && state.phaseAssistant) {
      await settleQueuedAnswer();
      if (!state.phaseStopped) {
        const next = replyPhases.open();
        state.replyPhaseId = next.id;
        state.replyRun = next.stream ? new ReplyStreamRun(next.stream, input.replySegments, input.messageAliases) : undefined;
        state.phaseSettled = false;
        state.phaseAssistant = undefined;
        state.phaseLastAssistant = undefined;
        state.phaseToolStart = toolCalls.length;
        state.answering = !!state.replyRun && !hasTools;
        state.preparedCallId = undefined;
        rebuildLlmTools();
        restartProgress();
      }
    }
    // These are admitted inputs, including any whose phase stopped before execution.
    flushToolResults();
    state.segmentMessages.push(...batch);
    if (state.phaseStopped) logger.warn(formatCompact({
      op: 'reply_phase_input_not_executed',
      session: sessionId,
      phase: state.replyPhaseId,
      messages: batch.length,
    }));
    return state.phaseStopped ? [] : batch;
  };

  return { settlePhase, settleQueuedAnswer, queuedMessages };
}

export async function finalizeTurnReplyAndOutput(params: {
  input: AgentLoopTurnInput;
  state: TurnReplyPhaseState;
  progressStalled: boolean;
  hasTools: boolean;
  imReply: boolean;
  maxIterations: number;
  systemPrompt: string;
  outputSchema: Parameters<typeof summarizeExhaustedTurn>[0]['outputSchema'];
  chatFailure: ChatFailureOptions | undefined;
  loadedMessages: AgentMessage[];
  toolCalls: ToolCallRecord[];
  conversationBatches: ConversationBatch[];
  transport: LlmCompletionPort;
  llmModel: TurnLlmModel;
  replyPhases: ReplyPhaseLifecycle | undefined;
  settlePhase: (output: AgentOutputElement[], raw: string, hostReply: boolean) => Promise<void>;
}) {
  const {
    input,
    state,
    progressStalled,
    hasTools,
    imReply,
    maxIterations,
    systemPrompt,
    outputSchema,
    chatFailure,
    loadedMessages,
    toolCalls,
    conversationBatches,
    transport,
    llmModel,
    replyPhases,
    settlePhase,
  } = params;
  const { sessionId, signal } = input;

  const finalPhaseToolCalls = toolCalls.slice(state.phaseToolStart);

  // The loop ran tools but never produced visible text (usually maxIterations
  // was hit mid-exploration). Ask the model for a tools-off summary instead of
  // showing raw tool output.
  const stopped = input.interactiveRun && (state.lastAssistantHadToolCalls || state.lastAssistantNeedsHostReply || state.iterations === 0)
    ? input.interactiveRun.check() ?? (progressStalled ? turnReplyMessages(input.turnContext.input?.locale, 'stalled') : undefined)
    : undefined;
  if (replyPhases && stopped) state.phaseStopped = true;
  const needsReplyRecovery = !state.phaseSettled && !state.phaseStopped && !state.replyRun?.offered && !stopped && !(input.interactiveRun && state.lastAssistantNeedsHostReply)
    && hasTools
    && (toolCalls.length > 0 || state.iterations >= maxIterations)
    && (!state.lastAssistantText.trim() || (imReply && state.lastAssistantHadToolCalls));

  let rawReply = stopped ?? state.lastAssistantText;
  let hostReply = !!stopped || state.lastAssistantNeedsHostReply;
  if (needsReplyRecovery) {
    const summary = await summarizeExhaustedTurn({
      locale: input.turnContext.input?.locale,
      transport,
      model: llmModel,
      systemPrompt,
      messages: [...loadedMessages, ...state.turnTranscript],
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
  const continuationPrefix = state.continuations > 0 && input.turnContext.origin.kind !== 'im'
    ? `（任务步骤较多，已自动续跑 ${state.continuations} 次）\n\n` : '';
  const proseReply = structuredReply ? ''
    : sanitizeAssistantReply(rawReply, {
        toolSummary: formatToolCallsForUser(finalPhaseToolCalls),
        ...(chatFailure ? { emptyMessage: chatFailureLine('malformed_tool_call', chatFailure) } : {}),
      });
  const textReply = proseReply.trim() ? continuationPrefix + proseReply : proseReply;
  let output: AgentOutputElement[] = state.phaseSettled ? [...state.settledPhaseOutput] : structuredReply ? [] : parseOutput(textReply);
  if (!state.phaseSettled && structuredReply) {
    try {
      output = decodeStructuredReply(rawReply, input.replySegments);
    } catch (error) {
      const messages = conversationBatches.at(-1)?.messages;
      const rejected = messages?.at(-1);
      const lenient = state.replyRun?.offered ? undefined : decodeLenientStructuredReply(rawReply, input.replySegments);
      if (lenient) {
        output = lenient.output;
        if (messages && rejected?.role === 'assistant') {
          messages[messages.length - 1] = { ...rejected, content: [{ type: 'text', text: lenient.text }] };
        }
      } else if (!state.replyRun?.offered) {
        const recovery = await recoverStructuredReply({
          transport,
          model: llmModel,
          raw: rawReply,
          error: error instanceof Error ? error : new Error('Invalid structured reply'),
          signal,
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
  if (!state.phaseSettled) {
    output = mergeToolOutboundElements(output, toolCalls.slice(state.phaseToolStart));
  }
  // #1250: a side-effect tool that was denied or failed must not be reported as done. Nothing has
  // been published yet on this path (no settled phase, no streamed prefix), so one honest line can
  // still be added when the reply itself says nothing about it.
  let honestTextReply = textReply;
  if (!state.phaseSettled && !state.replyRun?.offered && !stopped) {
    const unexecuted = unresolvedSideEffectFailures(finalPhaseToolCalls);
    const rendered = imReply ? renderAgentOutput(output) : textReply;
    if (unexecuted.length > 0 && rendered.trim() && !acknowledgesUnexecuted(rendered)) {
      const notice = turnReplyMessages(input.turnContext.input?.locale, 'unexecuted',
        { tools: unexecuted.map(call => `「${call.tool}」`).join('、') });
      output = [...output, { type: 'text', content: notice }];
      honestTextReply = `${textReply}\n\n${notice}`;
      logger.info(formatCompact({ op: 'unexecuted_tool_notice', session: sessionId, tools: unexecuted.map(call => call.tool).join(',') }));
    }
  }
  // ADR 0043 §5: a `reply` segment may name its target by alias (`m12`); delivery needs the platform id.
  if (input.messageAliases) output = resolveReplyAliases(output, input.messageAliases);
  let progressive: AgentLoopTurnResult['progressive'];
  if (replyPhases) {
    await settlePhase(output, rawReply, hostReply);
  } else if (state.replyRun && (state.answering || state.replyRun.offered)) {
    await state.replyRun.stop();
    if (!hostReply && structuredReply && !state.replyRun.error) {
      try {
        const snapshot = await state.replyRun.complete(rawReply);
        if (snapshot) progressive = { run: state.replyRun, snapshot };
      } catch {
        // Published prefixes are final facts; a format correction must never rewrite them.
      }
    }
    if (!progressive && state.replyRun.offered) progressive = { run: state.replyRun };
  }
  const finalReply = imReply ? renderAgentOutput(output) : honestTextReply;

  return {
    output,
    finalReply,
    needsReplyRecovery,
    hostReply,
    stopped,
    progressive,
  };
}

export function encodeConfirmedOutput(output: readonly AgentOutputElement[]): string {
  let reaction: string | undefined;
  const messages = output.flatMap(element => {
    if (element.type !== 'message') return [{ segments: [{ type: 'text', data: { text: renderAgentOutput([element]) } }] }];
    const segments = element.segments.filter(segment => {
      if (segment.type !== 'reaction') return true;
      const emoji = (segment.data as Readonly<Record<string, unknown>>).emoji;
      if (typeof emoji === 'string') reaction = emoji;
      return false;
    });
    return segments.length ? [{ segments }] : [];
  });
  return JSON.stringify({ messages, ...(reaction ? { reaction } : {}) });
}

export function resolveReplyAliases(output: AgentOutputElement[], aliases: import('@zhin.js/ai').MessageAliasTable): AgentOutputElement[] {
  return output.map((element) => {
    if (element.type !== 'message') return element;
    return {
      ...element,
      segments: element.segments.map((segment) => {
        const id = (segment.data as { message_id?: unknown } | undefined)?.message_id;
        return segment.type === 'reply' && typeof id === 'string'
          ? { ...segment, data: { ...segment.data, message_id: aliases.resolve(id) } }
          : segment;
      }),
    };
  });
}

export async function appendConversationBatches(
  repo: import('@zhin.js/ai').ContextRepository,
  sessionId: string,
  batches: readonly ConversationBatch[],
  delivered?: {
    readonly messageId?: string;
    readonly messageIds?: readonly (string | null)[];
    readonly contextRefs?: readonly string[];
    readonly confirmedOutput?: AgentOutputElement[];
    readonly conversationSequence?: number;
    readonly conversationSequences?: readonly (number | null)[];
    readonly conversationKey?: string;
  },
  phaseFacts?: ReadonlyMap<AgentMessage, ReplyPhaseFacts>,
): Promise<void> {
  // Delivery is authoritative after publication, including an empty confirmed prefix.
  const projected = batches.map(batch => ({ ...batch, messages: [...batch.messages], messageExtras: [...batch.messageExtras] }));
  if (delivered?.confirmedOutput !== undefined) {
    const content = encodeConfirmedOutput(delivered.confirmedOutput);
    outer: for (let bi = projected.length - 1; bi >= 0; bi -= 1) {
      const messages = projected[bi]!.messages;
      for (let mi = messages.length - 1; mi >= 0; mi -= 1) {
        const message = messages[mi]!;
        if (message.role !== 'assistant') continue;
        const assistant = message as AssistantMessage;
        const confirmed: AssistantMessage = { ...assistant, content: [{ type: 'text', text: content }] };
        if (assistant.content.some(block => block.type === 'toolCall')) {
          // A failed tools-off re-completion can leave only prepare_reply + toolResult.
          // Keep that protocol pair and append the actual visible answer separately.
          projected.at(-1)!.messages.push({
            ...confirmed,
            stopReason: 'stop',
            errorMessage: undefined,
            usage: { ...EMPTY_TOKEN_USAGE, cost: { ...EMPTY_TOKEN_USAGE.cost } },
          });
          projected.at(-1)!.messageExtras.push(undefined);
        } else messages[mi] = confirmed;
        break outer;
      }
    }
  }
  const lastIndex = projected.length - 1;
  for (const [index, batch] of projected.entries()) {
    const clean = stampDeliveredMessageId(
      batch.messages,
      index === lastIndex ? delivered?.messageId : undefined,
      index === lastIndex ? delivered?.contextRefs : undefined,
      index === lastIndex ? delivered?.messageIds : undefined,
      index === lastIndex ? {
        conversationSequence: delivered?.conversationSequence,
        conversationSequences: delivered?.conversationSequences,
        conversationKey: delivered?.conversationKey,
      } : undefined,
    );
    const messages = clean.map((message, messageIndex) => {
      const facts = phaseFacts?.get(batch.messages[messageIndex]!);
      // Provider-authored provenance stays stripped; only the delivery owner's exact phase facts return.
      if (!facts) return message;
      const {
        messageId: _providerId,
        conversationEventId: _providerConvEventId,
        conversationEventIds: _providerConvEventIds,
        conversationKey: _providerConvKey,
        ...authoritative
      } = message as AssistantMessage;
      const deliveryConv = facts.delivery.status !== 'suppressed' ? facts.delivery : undefined;
      return stampDeliveredMessageId([authoritative], facts.messageId, facts.contextRefs, facts.messageIds, {
        conversationSequence: facts.conversationSequence ?? deliveryConv?.conversationSequence,
        conversationSequences: facts.conversationSequences ?? deliveryConv?.conversationSequences,
        conversationKey: facts.conversationKey ?? deliveryConv?.conversationKey,
      })[0]!;
    });
    await repo.appendMessages(sessionId, messages, { messageExtras: batch.messageExtras });
  }
}
