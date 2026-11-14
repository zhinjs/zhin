import type { CoreReplyStream } from '@zhin.js/core/runtime';
import { renderAgentOutput, type AgentOutputElement } from '../outbound/agent-output.js';
import { deliverProgressiveReply } from '../outbound/progressive-reply-delivery.js';
import { MessageAliasTable } from '@zhin.js/ai';
import { conversationContextMessage, deliveredReplyContextRef, deliveredReplyContextRefs, plannedReplyTexts } from '../session/context-provenance.js';
import type { AIEventPayload } from '../ai-event-subscriber.js';
import { applyInboundMediaInjection, resolveTurnMediaInjection } from '../turn/inbound-media.js';
import type { TurnEvent } from '../event/turn-event.js';
import type { ReplyPhaseFacts, ReplyPhaseLifecycle } from '../core/reply-phase.js';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import type { DeliveryOutcome } from '../turn/turn-ingress.js';
import { createInteractiveRun } from '../core/interactive-run.js';
import { TurnToolExecutionAuthority, TurnToolRuntime } from '../tool/turn-tool-runtime.js';
import type { SessionSystem } from '../session/session-system.js';
import {
  createDeferredCapabilityPlan,
  primeSkillsForIntent,
} from './deferred-capability-plan.js';
import type {
  AgentTurnEngine,
  AgentTurnExecutionContext,
} from './agent-runtime.js';
import { publishProjectionFailure, type TurnTerminalProjection } from '../turn/execute-agent-turn.js';
import { buildTextTurnOutbound } from '../turn/turn-complete.js';
import { createTurnActivityProjector } from '../activity-feedback/turn-event-projector.js';
import { resolveToolTier } from './tool-tier.js';
import { BOOTSTRAP_PROMPT_ORDER, fillPromptSlots } from '../prompt/system-prompt.js';
import { hasNicknameSlot, turnAgentNickname } from '../context/self-profile.js';
import { resolveToolBudget } from '../core/turn-progress.js';
import { TurnProvenance } from '../security/provenance.js';
import { OutboundLeakInspector } from '../security/outbound-leak-guard.js';
import { usageSubjectFromTurn } from '../security/usage-subject.js';
import { currentMailTurn } from '../collaboration/mail-turn-context.js';
import { startTurnCollaboration } from '../collaboration/turn-collaboration.js';
import type { ActorModelSelection } from '../collaboration/contracts.js';
import { recordRelationTurn } from '../user-relation-turn.js';
import { DEFAULT_PERCEPTION_SETTINGS } from '../config/perception-config.js';
import {
  runScheduleTurn,
  createTurnPromptSegments,
  collectPromptExecutions,
  aggregateReplyPhases,
  bufferTerminal,
  activityPayloadFromImTurn,
  emitActivityEvent,
  emitActivityStop,
  buildCapabilityContext,
  terminal,
  zeroUsage,
  createProgressSink,
  guardedReply,
  labelSkillInstructions,
  recallTurnMemory,
  hardGateOptions,
  type BufferedExecution,
  type FullAgentTurnEngineOptions,
} from './turn-engine-helpers.js';

export { buildCapabilityContext, type FullAgentTurnEngineOptions };

/** Generation-owned adapter from canonical TurnIngress to the one full AgentCore. */
export function createFullAgentTurnEngine(options: FullAgentTurnEngineOptions): AgentTurnEngine {
  const captured = { ...options, ...(options.contextFiles !== undefined ? {
    contextFiles: Object.freeze(options.contextFiles.map(file => Object.freeze({ ...file }))),
  } : {}) };
  return Object.freeze({
    run: (context: AgentTurnExecutionContext) => runFullAgentTurn(withCurrentBootstrap(captured), context),
  });
}

function withCurrentBootstrap(options: FullAgentTurnEngineOptions): FullAgentTurnEngineOptions {
  if (!options.bootstrap) return options;
  const current = options.bootstrap();
  return {
    ...options,
    bootstrapContext: current.bootstrapContext,
    contextFiles: current.contextFiles === undefined
      ? undefined
      : Object.freeze(current.contextFiles.map(file => Object.freeze({ ...file }))),
  };
}

async function* runFullAgentTurn(
  options: FullAgentTurnEngineOptions,
  context: AgentTurnExecutionContext,
): AsyncGenerator<TurnEvent, TurnTerminalProjection> {
  const { host, sessionSystem } = options;
  if (context.turn.execution.kind === 'schedule') {
    return yield* runScheduleTurn(options, context);
  }
  const prep = await sessionSystem.prepareIngressTurn(host, context.turn);
  const payload = activityPayloadFromImTurn(context.turn, prep.sessionId);
  if (payload) emitActivityEvent(host, 'ai.processing.start', payload);
  try {
    return yield* runInteractiveTurn(options, context, prep, payload);
  } catch (error) {
    emitActivityStop(host, payload, {
      event: 'ai.processing.error',
      extra: { error: error instanceof Error ? error.message : String(error) },
      reason: 'processing_error',
    });
    throw error;
  }
}

async function* runInteractiveTurn(
  options: FullAgentTurnEngineOptions,
  context: AgentTurnExecutionContext,
  prep: Awaited<ReturnType<SessionSystem['prepareIngressTurn']>>,
  payload: AIEventPayload | undefined,
): AsyncGenerator<TurnEvent, TurnTerminalProjection> {
  const { host, sessionSystem, contextSystem } = options;
  const imageInspectionBudget = { remaining: host.mediaPerception?.maxItemsPerTurn ?? DEFAULT_PERCEPTION_SETTINGS.maxItemsPerTurn };
  const rate = host.rateLimiter.check(prep.userId);
  if (!rate.allowed) {
    const text = rate.message || '请稍后再试';
    const end = terminal(text, zeroUsage());
    yield end;
    return {
      project: async () => {
        try {
          await sessionSystem.touchAfterTurn(host, prep.sessionId);
          if (context.turn.ports.reply) await context.turn.ports.reply.send(end.output);
        } finally {
          emitActivityStop(host, payload, {
            event: 'ai.processing.finish',
            extra: { path: 'rate_limited', reply: text, reason: 'rate_limited' },
          });
        }
      },
    };
  }

  const quotaSubject = usageSubjectFromTurn(context.turn);
  const quota = host.usageQuota.check(quotaSubject);
  if (!quota.allowed) {
    // #727: only this user (or this group) is stopped; everyone else carries on.
    const end = terminal(quota.message, zeroUsage());
    yield end;
    return {
      project: async () => {
        try {
          await sessionSystem.touchAfterTurn(host, prep.sessionId);
          if (context.turn.ports.reply) await context.turn.ports.reply.send(end.output);
        } finally {
          emitActivityStop(host, payload, {
            event: 'ai.processing.finish',
            extra: { path: 'rate_limited', reply: quota.message, reason: 'quota_exceeded' },
          });
        }
      },
    };
  }

  const interactiveRun = context.turn.execution.kind === 'interactive' && !context.turn.policy.unattended
    ? createInteractiveRun(host.usageQuota, quotaSubject, resolveToolBudget(host.config.toolBudget).maxTotalTokens)
    : undefined;
  const snapshot = await host.contextRepository.getDeferredToolSnapshot(prep.sessionId);
  const actorModel: { current?: ActorModelSelection } = {};
  // ADR 0048: the live turn is the root actor of an engagement whenever other agents exist.
  const provenance = new TurnProvenance();
  const rawEntryAgentName = context.selection.agent ?? context.selection.binding.name;
  const entryDescriptor = context.capabilities.agents.find(
    (agent) => agent.name === rawEntryAgentName || agent.qualifiedName === rawEntryAgentName,
  );
  const entryAgentName = entryDescriptor?.name ?? rawEntryAgentName;
  const entryDisallowed = new Set(entryDescriptor?.disallowedTools ?? []);
  const entryDeclared = entryDescriptor?.toolNames ? new Set(entryDescriptor.toolNames) : undefined;
  const entryToolCapabilities = entryDescriptor
    ? Object.freeze(
        context.toolCapabilities.filter(
          (tool) =>
            (!entryDeclared || entryDeclared.has(tool.name) || entryDeclared.has(tool.qualifiedName))
            && !entryDisallowed.has(tool.name)
            && !entryDisallowed.has(tool.qualifiedName),
        ),
      )
    : context.toolCapabilities;
  const collaboration = await startTurnCollaboration({
    host,
    core: options.core,
    turn: context.turn,
    capabilities: { ...context.capabilities, tools: context.toolCapabilities },
    entry: entryAgentName,
    resolveModel: () => actorModel.current,
    loopHooks: options.loopHooks,
    bootstrapContext: options.bootstrapContext,
    contextFiles: options.contextFiles,
    imageInspectionBudget,
    interactiveRun,
    provenance,
  });
  const projected = {
    ...context.capabilities,
    tools: collaboration
      ? Object.freeze([...entryToolCapabilities, ...collaboration.tools])
      : entryToolCapabilities,
  };
  const primed = await primeSkillsForIntent({
    capabilities: projected,
    sessionSnapshot: snapshot,
    intent: prep.turnUser.rawContent,
    config: host.config,
    decision: context.decision,
    signal: context.turn.signal,
  });
  if (primed.skill) {
    await host.contextRepository.setDeferredToolSnapshot(prep.sessionId, primed.snapshot);
  }
  const plan = createDeferredCapabilityPlan({
    capabilities: projected,
    sessionSnapshot: primed.snapshot,
    config: host.config,
    platform: context.turn.origin.kind === 'im' ? context.turn.origin.platform : undefined,
    toolTier: resolveToolTier(context.turn),
    persistSnapshot: (next) => host.contextRepository.setDeferredToolSnapshot(prep.sessionId, next),
    decision: context.decision,
  });
  const activeSkillsContext = labelSkillInstructions(plan.controller.loadedSkillInstructions());
  const pendingContext = context.turn.ports.conversationContext
    ? await context.turn.ports.conversationContext.readPending(context.turn.signal)
    : undefined;
  const relevantMemory = await recallTurnMemory(host, context.turn, prep.turnUser.rawContent);
  const prompt = await contextSystem.buildTextTurnContext({
    host,
    turn: context.turn,
    content: prep.turnUser.rawContent,
    turnUser: prep.turnUser,
    deferredStats: plan.deferredStats,
    mode: context.turn.input.media?.some((item) => item.kind === 'image') ? 'vision' : undefined,
    activeSkillsContext,
    activeSkillBlocks: plan.controller.loadedSkillBlocks(),
    toldLedgerBlocks: host.toldLedger?.renderBlocks(prep.sessionId),
    relevantMemory,
    systemBootstrap: options.bootstrapContext,
    contextFiles: options.contextFiles,
  });
  const providerInput = context.turn.input.media?.length
    ? prompt.modelInput
    : undefined;
  const media = await resolveTurnMediaInjection(
    context.turn.input.media,
    {
      references: context.turn.ports.references,
      signal: context.turn.signal,
      providerInput,
      transcriber: host.audioTranscriber,
      perception: host.mediaPerception,
    },
  );
  for (const [index, outcome] of media.outcomes.entries()) {
    yield Object.freeze({
      type: 'media_resolution' as const,
      index,
      mediaKind: outcome.kind,
      status: outcome.status,
      code: outcome.code,
      ...(outcome.provenance ? { provenance: { ...outcome.provenance } } : {}),
    });
  }
  imageInspectionBudget.remaining = Math.max(0, imageInspectionBudget.remaining
    - (media.perceptionItems ?? 0) - media.blocks.filter(block => block.type === 'image').length);
  if (media.perceptionUsage) interactiveRun?.recordUsage(media.perceptionUsage.total_tokens);
  const background = pendingContext ? conversationContextMessage(pendingContext.blocks) : undefined;
  const userMessages = applyInboundMediaInjection(
    background ? [background, ...prompt.userMessages] : prompt.userMessages,
    media,
  );
  actorModel.current = { modelId: prompt.modelId, modelCandidates: prompt.modelCandidates };
  if (background) provenance.record({ kind: 'conversation_context' });
  // Perception descriptions are generated from user media (text in an image is an injection path).
  if (media.outcomes.some((outcome) => outcome.provenance?.source === 'media_perception')) {
    provenance.record({ kind: 'media_perception' });
  }
  const effectivePersona = entryDescriptor?.instructions?.trim()
    ? `${prompt.personaEnhanced}\n\n${entryDescriptor.instructions.trim()}`
    : prompt.personaEnhanced;
  const leakInspector = new OutboundLeakInspector({
    promptTexts: [effectivePersona, options.bootstrapContext ?? ''],
  });
  const reply = guardedReply(host, context.turn, leakInspector);
  const messageAliases = new MessageAliasTable();
  const toolRuntime = new TurnToolRuntime(context.turn, plan.capabilities, {
    messageAliases,
    injectionGuard: host.config.injectionGuard,
    ...hardGateOptions(host),
    provenance,
    leakInspector,
  });
  const agentNickname = turnAgentNickname(context.turn, host.activeBinding?.nickname);
  const turnSegments = createTurnPromptSegments(context.capabilities.promptSections, context.capabilities.owner, context.turn, agentNickname);
  const capabilityContext = buildCapabilityContext(
    context.capabilities.agents,
    context.capabilities.skills,
    context.selection.agent,
    context.capabilities.tools,
  );
  if (capabilityContext.stable) {
    // Only sender-neutral (scene-tier) capabilities stay in the cached system prefix, so master and
    // members speaking in the same group get identical system bytes. Sender-/selection-dependent
    // entries go to the current message's runtime-context tail; load/execute still enforce access.
    turnSegments.push({
      id: '§11_capabilities',
      kind: context.turn.origin.kind === 'im' && hasNicknameSlot(capabilityContext.stable) ? 'scene' : 'platform',
      weight: BOOTSTRAP_PROMPT_ORDER.task - 1,
      budgetOrder: context.turn.origin.kind === 'im' ? BOOTSTRAP_PROMPT_ORDER.chat : BOOTSTRAP_PROMPT_ORDER.task,
      retention: 'preferred',
      inject: () => fillPromptSlots(capabilityContext.stable, agentNickname),
    });
  }
  const promptRuntime = Object.freeze({
    bootstrapContext: options.bootstrapContext?.trim() ?? '',
    contextFiles: options.contextFiles,
    activeSkillsContext,
    capabilityTail: capabilityContext.tail
      ? fillPromptSlots(capabilityContext.tail, agentNickname) : undefined,
    agentNickname,
    modelId: prompt.modelId,
    providerAlias: prompt.providerAlias,
    modelSdk: prompt.modelSdk,
    segments: Object.freeze([...turnSegments, ...(context.capabilities.promptSegments ?? [])]),
    platformGuidanceExternal: context.capabilities.platformGuidanceExternal,
  });

  let replyStream: CoreReplyStream | undefined;
  const replyStreams = new Map<string, CoreReplyStream>();
  const phaseFacts = new Map<string, ReplyPhaseFacts>();
  const executions: BufferedExecution[] = [];
  let phaseSequence = 0;
  const replyLifetime = new AbortController();
  const openPhase: ReplyPhaseLifecycle['open'] = () => {
    const id = `${context.turn.identity.turnId}:answer:${++phaseSequence}`;
    const stream = context.turn.intent.kind === 'observe' ? undefined : reply?.openStream?.({ phaseId: id });
    if (stream) { replyStreams.set(id, stream); replyStream = stream; }
    return { id, ...(stream ? { stream } : {}) };
  };
  const settlePhase: ReplyPhaseLifecycle['settle'] = async phase => {
    const existing = phaseFacts.get(phase.id);
    if (existing) return existing;
    if (!reply) throw new Error('Answer phase has no reply port');
    const answer = { intent: 'answer' as const, phaseId: phase.id };
    let delivery: DeliveryOutcome, confirmedOutput: AgentOutputElement[];
    if (phase.run) {
      ({ delivery, confirmedOutput } = await deliverProgressiveReply({ run: phase.run, snapshot: phase.snapshot }, phase.output, reply, context.turn.input.locale, answer));
    } else {
      await replyStreams.get(phase.id)?.cancel();
      try { delivery = await reply.send(phase.output, answer); }
      catch (error) {
        const known = error instanceof EndpointDeliveryError;
        // ReplyPort can redirect delivery; native ids alone cannot establish a target scene.
        const canonical = known ? error.receipt : undefined;
        const messages = canonical
          ? canonical.parts?.map(part => part.message ?? null) ?? (canonical.message ? [canonical.message] : [])
          : known ? error.parts?.map(() => null) ?? [] : [];
        delivery = known && error.disposition === 'rejected'
          ? { status: 'rejected', code: error.code, messages }
          : { status: 'failed', code: known ? error.code : 'reply_phase_unknown', retryable: false, messages,
              ...(!known || error.disposition === 'unknown' ? { deliveryUnknown: true as const } : {}),
              ...(messages.length ? { deliveryPartial: true as const } : {}) };
      }
      // Partial receipts prove send slots, not their bodies: sourceIndices address the rendered,
      // middleware-transformed payload, so they cannot promote phase.output into history/ledger.
      confirmedOutput = delivery.status === 'sent' ? [...phase.output] : [];
    }
    const messages = 'messages' in delivery ? delivery.messages ?? [] : [];
    const messageId = messages.find(message => message !== null)?.id ?? (delivery.status === 'sent' ? delivery.messageId : undefined);
    const stopped = delivery.status !== 'sent' && !(delivery.status === 'suppressed' && !phase.output.length);
    const facts: ReplyPhaseFacts = {
      delivery, confirmedOutput, ...(messageId ? { messageId } : {}),
      ...(messages.length ? { messageIds: messages.map(message => message?.id ?? null) } : {}),
      ...(delivery.status === 'sent' ? { contextRefs: deliveredReplyContextRefs(prep.sessionId, context.turn.identity.turnId, plannedReplyTexts(confirmedOutput), delivery, phase.id) } : {}),
      ...(stopped ? { stopped: true } : {}),
    };
    phaseFacts.set(phase.id, facts);
    const told = renderAgentOutput(confirmedOutput);
    if (told.trim()) host.toldLedger?.record(prep.sessionId, told, 'reply', context.turn.identity.turnId,
      deliveredReplyContextRef(prep.sessionId, context.turn.identity.turnId, phase.id));
    return facts;
  };
  const cancelReplyStreams = async () => { await Promise.all([...replyStreams.values()].map(stream => stream.cancel())); };
  const stream = host.promptController.scheduleStream({
    turnId: context.turn.identity.turnId,
    intent: context.turn.intent,
    principal: context.turn.principal,
    onAdmitted: context.admit,
    sessionKey: prep.sessionKey,
    sessionId: prep.sessionId,
    userMessages,
    signal: context.turn.signal,
    execute: (initialMessages, hooks, signal) => (async function* () {
      // A follow-up execute must retain accepted input/tool history. Only a settled phase
      // may contribute an answer; complete-message mode has not delivered its candidate yet.
      const previous = executions.at(-1);
      if (previous && !previous.projected) {
        previous.projected = true;
        await previous.result.projectConversation?.(previous.result.replyPhaseId ? undefined : { confirmedOutput: [] });
      }
      const firstPhase = openPhase();
      let firstAvailable = true;
      const completion = yield* bufferTerminal(options.core.runText({
        replyStream: firstPhase.stream,
        ...(firstPhase.stream ? { replyPhases: {
          open: () => { if (firstAvailable) { firstAvailable = false; return firstPhase; } return openPhase(); },
          settle: settlePhase,
        } } : {}),
        host,
        sessionId: prep.sessionId,
        userMessageExtra: prep.turnUser.userMessageExtra,
        rawContent: prep.turnUser.rawContent,
        promptProfile: { kind: 'interactive' },
        turnContext: context.turn,
        replySegments: context.turn.ports.reply?.segments,
        imageInspectionBudget,
        allTools: [...plan.allTools],
        resolvedTools: [...plan.resolvedTools],
        toolExecution: new TurnToolExecutionAuthority(toolRuntime),
        messageAliases,
        toolEventSource: 'authority',
        loopHooks: options.loopHooks,
        promptRuntime,
        personaEnhanced: effectivePersona,
        modelId: prompt.modelId,
        modelCandidates: prompt.modelCandidates,
        initialMessages,
        promptHooks: hooks,
        signal: AbortSignal.any([signal, replyLifetime.signal]),
        deferredStats: plan.deferredStats,
        deferredController: plan.controller,
        toolCatalog: plan.catalog,
        toolLoading: 'deferred',
        conversationPersistence: 'session',
        progressSink: createProgressSink(host, context.turn, reply),
        interactiveRun,
        generation: context.turn.identity.generation,
      }));
      executions.push(completion);
      return completion.result;
    })(),
  });

  const projectActivity = payload ? createTurnActivityProjector({
    payload,
    publish: (event, next) => emitActivityEvent(host, event, next),
    thinkingPreview: host.config.thinkingPreview === true,
    thinkingMaxLength: host.config.thinkingPreviewMaxLength ?? 200,
  }) : undefined;
  const activeMailTurn = currentMailTurn();
  const onTurnEvent = (event: TurnEvent): void => {
    projectActivity?.(event);
    if (activeMailTurn && (event.type === 'tool_result' || event.type === 'tool_denied' || event.type === 'tool_failed')) {
      void activeMailTurn.mailbox
        .recordToolCalled({
          engagementId: activeMailTurn.mail.engagementId,
          actor: entryAgentName,
          mailId: activeMailTurn.mail.id,
          tool: event.toolName,
          ok: event.type === 'tool_result',
        })
        .catch(() => undefined);
    }
  };
  let projectionOwnsReply = false;
  try {
    const completion = yield* collectPromptExecutions(stream, executions, onTurnEvent);
    if (phaseFacts.size && completion.terminal.type === 'turn_end') {
      const output = [...phaseFacts.values()].flatMap(facts => facts.confirmedOutput);
      completion.terminal = { ...completion.terminal, output };
      completion.result = { ...completion.result, reply: renderAgentOutput(output), output };
    }
    yield completion.terminal;
    projectionOwnsReply = true;
    return {
      project: async () => {
        let projectionError: Error | undefined;
        try {
          // The perception pre-pass is billed to the same subject as the turn itself.
          if (!interactiveRun) host.usageQuota.record(quotaSubject, completion.result.usage.total_tokens + (media.perceptionUsage?.total_tokens ?? 0));
          let deliveredMessageId: string | undefined;
          let deliveredMessageIds: readonly (string | null)[] | undefined;
          let deliveredContextRefs: readonly string[] | undefined;
          let confirmedOutput: AgentOutputElement[] | undefined = phaseFacts.size
            ? [...phaseFacts.values()].flatMap(facts => facts.confirmedOutput) : undefined;
          if (completion.terminal.type === 'turn_end' && reply) {
            const outbound = completion.terminal.output.length > 0
              ? completion.terminal.output
              : buildTextTurnOutbound(completion.result.reply, completion.result);
            const progressive = completion.result.progressive;
            if (!progressive && !phaseFacts.size) await replyStream?.cancel();
            const progressiveDelivery = phaseFacts.size ? aggregateReplyPhases([...phaseFacts.values()])
              : progressive ? await deliverProgressiveReply(progressive, outbound, reply, context.turn.input.locale) : undefined;
            confirmedOutput = progressiveDelivery?.confirmedOutput;
            const actualOutput = confirmedOutput ?? outbound;
            const plannedTexts = plannedReplyTexts(actualOutput);
            const delivery = progressiveDelivery?.delivery ?? await reply.send(outbound);
            if (delivery.status === 'sent') {
              deliveredMessageId = delivery.messageId;
              deliveredMessageIds = delivery.messages?.map(message => message?.id ?? null);
              deliveredContextRefs = deliveredReplyContextRefs(prep.sessionId, context.turn.identity.turnId, plannedTexts, delivery);
            }
            if (
              delivery.status === 'failed'
              || delivery.status === 'rejected'
              || (delivery.status === 'unsupported' && delivery.messages?.some(message => message !== null))
              || (delivery.status === 'suppressed' && outbound.length > 0)
            ) {
              const code = 'code' in delivery ? delivery.code : delivery.status;
              const error = new Error(`Synchronous reply projection failed: ${code}`);
              if (!progressive && !phaseFacts.size) throw error;
              projectionError = error;
            }
            const told = confirmedOutput ? renderAgentOutput(confirmedOutput) : delivery.status === 'sent' ? completion.result.reply : '';
            if (told.trim() && !phaseFacts.size) host.toldLedger?.record(prep.sessionId, told, 'reply', context.turn.identity.turnId);
            if (progressive || phaseFacts.size) {
              const messages = 'messages' in delivery ? delivery.messages ?? [] : [];
              deliveredMessageIds = messages.map(message => message?.id ?? null);
              deliveredMessageId = messages.find(message => message !== null)?.id;
            }
          }
          // 画像 + 好感度：回复已发出后异步写，不阻塞、不抛错。
          recordRelationTurn(host.userProfiles?.relations, context.turn, completion.result);
          if (context.turn.intent.kind === 'observe') {
            await host.contextRepository.appendMessages(
              prep.sessionId,
              prep.turnUser.promptMessages,
              { messageExtras: [prep.turnUser.userMessageExtra] },
            );
          } else {
            await completion.result.projectConversation?.(deliveredMessageId || deliveredMessageIds?.length || deliveredContextRefs?.length
              ? { messageId: deliveredMessageId, messageIds: deliveredMessageIds, contextRefs: deliveredContextRefs,
                  ...(confirmedOutput ? { confirmedOutput } : {}) } : confirmedOutput ? { confirmedOutput } : undefined);
          }
          await sessionSystem.touchAfterTurn(host, prep.sessionId);
          if (
            completion.terminal.type === 'turn_end'
            && pendingContext
            && context.turn.ports.conversationContext
          ) {
            await context.turn.ports.conversationContext.commit(pendingContext.cursor);
          }
          await host.finalizeActiveTurn({
            usage: media.perceptionUsage
              ? {
                  prompt_tokens: completion.result.usage.prompt_tokens + media.perceptionUsage.prompt_tokens,
                  completion_tokens: completion.result.usage.completion_tokens + media.perceptionUsage.completion_tokens,
                  total_tokens: completion.result.usage.total_tokens + media.perceptionUsage.total_tokens,
                }
              : completion.result.usage,
            path: completion.result.path,
            iterations: completion.result.iterations,
            model: completion.result.model,
            userInput: prep.turnUser.rawContent,
            output: confirmedOutput ? renderAgentOutput(confirmedOutput) : completion.result.reply,
            thinking: completion.result.thinking,
          });
          if (projectionError) throw projectionError;
        } finally {
          // Delegated work keeps running; its results reach the human as follow-up replies.
          await collaboration?.finish(completion.terminal.type === 'turn_end' && !projectionError ? 'completed' : 'failed');
          replyLifetime.abort();
          await cancelReplyStreams();
          // Stop activity-feedback AFTER the reply is sent. Awaiting icqq
          // delReaction (packet timeout) before send would block the AI reply.
          if (completion.terminal.type === 'error' || projectionError) {
            emitActivityStop(host, payload, {
              event: 'ai.processing.error',
              extra: { error: projectionError?.message ?? (completion.terminal.type === 'error' ? completion.terminal.error.message : 'Reply delivery failed') },
              reason: 'processing_error',
            });
          } else {
            emitActivityStop(host, payload, {
              event: 'ai.processing.finish',
              extra: {
                path: completion.result.path,
                reply: completion.result.reply,
              },
            });
          }
        }
      },
    };
  } finally {
    if (!projectionOwnsReply) {
      await collaboration?.finish(context.turn.signal.aborted ? 'cancelled' : 'failed');
      replyLifetime.abort();
      await cancelReplyStreams();
      for (const execution of executions) {
        if (execution.projected || !execution.result.replyPhaseId || !phaseFacts.has(execution.result.replyPhaseId)) continue;
        // The phase has its own delivery facts even when the enclosing Turn cannot commit a terminal.
        // Never retry a partially applied projection, and never replace the original cancellation/error.
        execution.projected = true;
        try { await execution.result.projectConversation?.(); }
        catch (error) { await publishProjectionFailure(context.turn, error); }
      }
    }
  }
}
