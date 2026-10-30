import { resolveIngressUserMessage } from '../session/turn-ingress-session.js';
import { MessageAliasTable, type AgentMessage, type Usage } from '@zhin.js/ai';
import { conversationContextMessage, deliveredReplyContextRefs, plannedReplyTexts } from '../session/context-provenance.js';
import { renderAgentCatalog, renderSkillCatalog } from '../skill/capability-catalog.js';
import type { AgentDescriptor } from '@zhin.js/agent-feature';
import type { SkillDescriptor } from '@zhin.js/skill';
import { resolveSkillTools, type SkillToolCandidate } from './skill-tool-resolution.js';
import type { AIEventPayload } from '../ai-event-subscriber.js';
import { applyInboundMediaInjection, resolveTurnMediaInjection } from '../turn/inbound-media.js';
import { isTurnTerminalEvent, type TurnEndEvent, type TurnEvent, type TurnTerminalEvent } from '../event/turn-event.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import type { PluginAILoopHookRegistry } from '../plugin-loop-hooks.js';
import type { AgentLoopTurnResult } from '../core/agent-core-run.js';
import type { AgentCore } from '../core/agent-core.js';
import { TurnToolExecutionAuthority, TurnToolRuntime, type TurnToolRuntimeOptions } from '../tool/turn-tool-runtime.js';
import type { DecisionAuditSink } from '../security/tool-hard-gate.js';
import type { ContextSystem } from '../context/context-system.js';
import type { SessionSystem } from '../session/session-system.js';
import {
  createDeferredCapabilityPlan,
  primeSkillsForIntent,
} from './deferred-capability-plan.js';
import type {
  AgentTurnEngine,
  AgentTurnExecutionContext,
} from './agent-runtime.js';
import type { TurnTerminalProjection } from '../turn/execute-agent-turn.js';
import { createScheduleCapabilityPlan } from './schedule-capability-plan.js';
import type { TurnIngress } from '../turn/turn-ingress.js';
import { buildTextTurnOutbound } from '../turn/turn-complete.js';
import { createTurnActivityProjector } from '../activity-feedback/turn-event-projector.js';
import { resolveToolTier } from './tool-tier.js';
import { PromptAssemblyRegistry } from '../prompt/prompt-assembly-registry.js';
import { labelThirdPartyGuidance } from '../prompt/third-party-guidance.js';
import { BOOTSTRAP_PROMPT_ORDER, fillPromptSlots } from '../prompt/system-prompt.js';
import type { PromptSectionDescriptor } from '@zhin.js/prompt-section';
import { progressUpdatesAllowed, resolveToolBudget } from '../core/turn-progress.js';
import { TurnProvenance } from '../security/provenance.js';
import { OutboundLeakInspector, guardReplyPort, type LeakFinding } from '../security/outbound-leak-guard.js';
import { resolveTurnTrustLevel } from '../security/trust-level.js';
import type { UsageSubject } from '../security/usage-quota.js';
import { usageGroupId } from '@zhin.js/core';
import { getLogger } from '@zhin.js/logger';
import { isLocale } from '@zhin.js/plugin-runtime';
import {
  createSubagentTurnCapability,
  type SubagentModelSelection,
} from './subagent-turn-capability.js';
import { recordRelationTurn } from '../user-relation-turn.js';
import { hostControlPlaneSource } from '../security/host-control-plane.js';
import { DEFAULT_PERCEPTION_SETTINGS } from '../config/perception-config.js';

export interface FullAgentTurnEngineOptions {
  readonly host: ZhinAgentPrivate;
  readonly core: AgentCore;
  readonly sessionSystem: SessionSystem;
  readonly contextSystem: ContextSystem;
  readonly loopHooks?: PluginAILoopHookRegistry;
  readonly bootstrapContext?: string;
}

const logger = getLogger('FullAgentTurnEngine');

/** Generation-owned adapter from canonical TurnIngress to the one full AgentCore. */
export function createFullAgentTurnEngine(options: FullAgentTurnEngineOptions): AgentTurnEngine {
  return Object.freeze({
    run: (context: AgentTurnExecutionContext) => runFullAgentTurn(options, context),
  });
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

  const quotaSubject = usageSubjectOf(context.turn, prep.userId);
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

  const snapshot = await host.contextRepository.getDeferredToolSnapshot(prep.sessionId);
  const subagentModel: { current?: SubagentModelSelection } = {};
  const subagentCapability = subagentsEnabled(host, context.turn)
    ? createSubagentTurnCapability({
      host,
      core: options.core,
      parentTurn: context.turn,
      capabilities: { ...context.capabilities, tools: context.toolCapabilities },
      loopHooks: options.loopHooks,
      resolveModel: () => subagentModel.current,
      imageInspectionBudget,
    })
    : undefined;
  const projected = {
    ...context.capabilities,
    tools: subagentCapability
      ? Object.freeze([...context.toolCapabilities, subagentCapability])
      : context.toolCapabilities,
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
  const background = pendingContext ? conversationContextMessage(pendingContext.blocks) : undefined;
  const userMessages = applyInboundMediaInjection(
    background ? [background, ...prompt.userMessages] : prompt.userMessages,
    media,
  );
  subagentModel.current = { modelId: prompt.modelId, modelCandidates: prompt.modelCandidates };
  const provenance = new TurnProvenance();
  if (background) provenance.record({ kind: 'conversation_context' });
  // Perception descriptions are generated from user media (text in an image is an injection path).
  if (media.outcomes.some((outcome) => outcome.provenance?.source === 'media_perception')) {
    provenance.record({ kind: 'media_perception' });
  }
  const leakInspector = new OutboundLeakInspector({
    promptTexts: [prompt.personaEnhanced, options.bootstrapContext ?? ''],
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
  const promptRegistry = createTurnPromptRegistry(context.capabilities.promptSections, context.capabilities.owner);
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
    promptRegistry.register('§11_capabilities', {
      layer: 'system',
      kind: 'platform',
      title: 'Turn capabilities',
      content: fillPromptSlots(capabilityContext.stable, host.activeBinding?.nickname),
      order: BOOTSTRAP_PROMPT_ORDER.task - 1,
      budgetOrder: context.turn.origin.kind === 'im' ? BOOTSTRAP_PROMPT_ORDER.chat : BOOTSTRAP_PROMPT_ORDER.task,
      retention: 'preferred',
    });
  }
  const promptRuntime = Object.freeze({
    bootstrapContext: options.bootstrapContext?.trim() ?? '',
    activeSkillsContext,
    capabilityTail: capabilityContext.tail
      ? fillPromptSlots(capabilityContext.tail, host.activeBinding?.nickname) : undefined,
    agentNickname: host.activeBinding?.nickname,
    modelId: prompt.modelId,
    providerAlias: prompt.providerAlias,
    modelSdk: prompt.modelSdk,
    registry: promptRegistry,
    segments: context.capabilities.promptSegments,
  });

  const stream = host.promptController.scheduleStream({
    turnId: context.turn.identity.turnId,
    intent: context.turn.intent,
    principal: context.turn.principal,
    onAdmitted: context.admit,
    sessionKey: prep.sessionKey,
    sessionId: prep.sessionId,
    userMessages,
    signal: context.turn.signal,
    execute: (initialMessages, hooks, signal) => options.core.runText({
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
      personaEnhanced: prompt.personaEnhanced,
      modelId: prompt.modelId,
      modelCandidates: prompt.modelCandidates,
      initialMessages,
      promptHooks: hooks,
      signal,
      deferredStats: plan.deferredStats,
      deferredController: plan.controller,
      toolCatalog: plan.catalog,
      toolLoading: 'deferred',
      conversationPersistence: 'session',
      progressSink: createProgressSink(host, context.turn, reply),
      generation: context.turn.identity.generation,
    }),
  });

  const projectActivity = payload ? createTurnActivityProjector({
    payload,
    publish: (event, next) => emitActivityEvent(host, event, next),
    thinkingPreview: host.config.thinkingPreview === true,
    thinkingMaxLength: host.config.thinkingPreviewMaxLength ?? 200,
  }) : undefined;
  const completion = yield* bufferTerminal(stream, projectActivity);
  yield completion.terminal;
  return {
    project: async () => {
      try {
        // The perception pre-pass is billed to the same subject as the turn itself.
        host.usageQuota.record(quotaSubject, completion.result.usage.total_tokens + (media.perceptionUsage?.total_tokens ?? 0));
        let deliveredMessageId: string | undefined;
        let deliveredMessageIds: readonly (string | null)[] | undefined;
        let deliveredContextRefs: readonly string[] | undefined;
        if (completion.terminal.type === 'turn_end' && reply) {
          const outbound = completion.terminal.output.length > 0
            ? completion.terminal.output
            : buildTextTurnOutbound(completion.result.reply, completion.result);
          const plannedTexts = plannedReplyTexts(outbound);
          const delivery = await reply.send(outbound);
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
            throw new Error(`Synchronous reply projection failed: ${code}`);
          }
          if (delivery.status === 'sent' && completion.result.reply.trim()) {
            host.toldLedger?.record(prep.sessionId, completion.result.reply, 'reply', context.turn.identity.turnId);
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
            ? { messageId: deliveredMessageId, messageIds: deliveredMessageIds, contextRefs: deliveredContextRefs } : undefined);
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
          output: completion.result.reply,
          thinking: completion.result.thinking,
        });
      } finally {
        // Stop activity-feedback AFTER the reply is sent. Awaiting icqq
        // delReaction (packet timeout) before send would block the AI reply.
        if (completion.terminal.type === 'error') {
          emitActivityStop(host, payload, {
            event: 'ai.processing.error',
            extra: { error: completion.terminal.error.message },
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
}

async function* runScheduleTurn(
  options: FullAgentTurnEngineOptions,
  context: AgentTurnExecutionContext,
): AsyncGenerator<TurnEvent, TurnTerminalProjection> {
  const { host, contextSystem } = options;
  const origin = context.turn.origin;
  const profile = context.turn.execution;
  if (origin.kind !== 'schedule' || profile.kind !== 'schedule') {
    throw new TypeError('Schedule execution profile requires a schedule origin');
  }
  const rawContent = context.turn.input.text.trim();
  const plan = createScheduleCapabilityPlan({
    prompt: rawContent,
    executionPlan: profile.executionPlan,
    tools: context.toolCapabilities,
    skills: context.capabilities.skills,
  });
  yield {
    type: 'capability_resolution',
    mode: 'direct',
    resolvedBy: plan.resolvedBy,
    tools: plan.resolvedTools.map((tool) => tool.name),
    skills: plan.skills.map((skill) => skill.qualifiedName),
    missingTools: [...plan.missingTools],
    missingSkills: [...plan.missingSkills],
  };

  const activeSkillsContext = plan.skills.map((skill) => skill.instructions).join('\n\n');
  const prompt = await contextSystem.buildTextTurnContext({
    host,
    turn: context.turn,
    content: rawContent,
    turnUser: {
      rawContent,
      promptMessages: [resolveIngressUserMessage({ ...context.turn, input: { ...context.turn.input, text: rawContent } }).llmMessage],
    },
    activeSkillsContext,
    systemBootstrap: options.bootstrapContext,
  });
  const messageAliases = new MessageAliasTable();
  const toolRuntime = new TurnToolRuntime(context.turn, plan.capabilities, {
    messageAliases,
    injectionGuard: host.config.injectionGuard,
    ...hardGateOptions(host),
  });
  const promptRuntime = Object.freeze({
    bootstrapContext: options.bootstrapContext,
    activeSkillsContext,
    agentNickname: host.activeBinding?.nickname,
    modelId: prompt.modelId,
    providerAlias: prompt.providerAlias,
    modelSdk: prompt.modelSdk,
    registry: createTurnPromptRegistry(context.capabilities.promptSections, context.capabilities.owner),
    segments: context.capabilities.promptSegments,
  });
  const stream = host.promptController.scheduleStream({
    turnId: context.turn.identity.turnId,
    intent: context.turn.intent,
    principal: context.turn.principal,
    onAdmitted: context.admit,
    sessionKey: context.turn.session.key,
    sessionId: context.turn.session.key,
    userMessages: prompt.userMessages,
    signal: context.turn.signal,
    execute: (initialMessages, hooks, signal) => options.core.runText({
      host,
      sessionId: context.turn.session.key,
      rawContent,
      promptProfile: {
        kind: 'schedule',
        jobId: origin.jobId,
        prompt: rawContent,
        createdBy: profile.createdBy,
        security: {
          execPreset: profile.security.execPreset,
          rejectOwnerApproval: true,
          allowedDomains: profile.security.allowedDomains,
        },
      },
      turnContext: context.turn,
      replySegments: context.turn.ports.reply?.segments,
      allTools: [...plan.allTools],
      resolvedTools: [...plan.resolvedTools],
      toolExecution: new TurnToolExecutionAuthority(toolRuntime),
      messageAliases,
      toolEventSource: 'authority',
      loopHooks: options.loopHooks,
      promptRuntime,
      personaEnhanced: prompt.personaEnhanced,
      modelId: prompt.modelId,
      modelCandidates: prompt.modelCandidates,
      initialMessages,
      promptHooks: hooks,
      signal,
      toolCatalog: [],
      toolLoading: 'direct',
      conversationPersistence: 'none',
      generation: context.turn.identity.generation,
    }),
  });
  const completion = yield* bufferTerminal(stream);
  yield completion.terminal;
  return {
    project: async () => {
      await host.finalizeActiveTurn({
        usage: completion.result.usage,
        path: completion.result.path,
        iterations: completion.result.iterations,
        model: completion.result.model,
        userInput: rawContent,
        output: completion.result.reply,
        thinking: completion.result.thinking,
      });
    },
  };
}

/**
 * #726: prompt sections from plugins other than the agent's owner are
 * external_content. They still guide the model, but are labelled so their
 * text cannot claim owner authority or grant permissions.
 */
function createTurnPromptRegistry(
  sections: readonly PromptSectionDescriptor[],
  agentOwner: PromptSectionDescriptor['owner'],
): PromptAssemblyRegistry {
  const registry = new PromptAssemblyRegistry();
  for (const section of sections) {
    const thirdParty = section.owner !== agentOwner;
    registry.register(section.qualifiedName, {
      layer: section.layer,
      title: section.title,
      content: thirdParty ? labelThirdPartyGuidance(`plugin:${String(section.owner)}`, section.content) : section.content,
      order: section.order,
      placement: section.platforms?.length ? 'tail' : undefined,
      retention: section.retention,
      maxChars: section.maxChars,
      metadata: {
        ...section.metadata,
        owner: section.owner,
        source: section.source,
        generation: section.generation,
      },
    });
  }
  return registry;
}

async function* bufferTerminal(
  stream: AsyncGenerator<TurnEvent, AgentLoopTurnResult>,
  onEvent?: (event: TurnEvent) => void,
): AsyncGenerator<TurnEvent, { terminal: TurnTerminalEvent; result: AgentLoopTurnResult }> {
  let buffered: TurnTerminalEvent | undefined;
  while (true) {
    const step = await stream.next();
    if (step.done) {
      if (!buffered) throw new Error('Full AgentCore completed without a terminal TurnEvent');
      return { terminal: buffered, result: step.value };
    }
    if (isTurnTerminalEvent(step.value)) {
      if (buffered) throw new Error('Full AgentCore emitted more than one terminal TurnEvent');
      buffered = step.value;
      continue;
    }
    if (buffered) throw new Error('Full AgentCore emitted an event after its terminal');
    onEvent?.(step.value);
    yield step.value;
  }
}

function activityPayloadFromImTurn(
  turn: TurnIngress,
  sessionId: string,
  extra: Partial<AIEventPayload> = {},
): AIEventPayload | undefined {
  const origin = turn.origin;
  if (origin.kind !== 'im') return undefined;
  const { hookContext: extraHook, ...rest } = extra;
  return {
    sessionId,
    source: 'zhin-agent',
    mode: 'text',
    userId: turn.principal.subjectId,
    platform: origin.platform,
    endpointKey: origin.endpoint,
    sceneId: origin.sceneId,
    messageId: origin.messageId,
    scope: origin.scope,
    content: turn.input.text,
    hookContext: {
      activityFeedbackEligible: true,
      ...(extraHook && typeof extraHook === 'object' ? extraHook : {}),
    },
    ...rest,
    locale: isLocale(turn.input.locale) ? turn.input.locale : undefined,
  };
}

function emitActivityEvent(
  host: ZhinAgentPrivate,
  event: string,
  payload: AIEventPayload,
): void {
  host.emitter.emit(event, payload);
}

function emitActivityStop(
  host: ZhinAgentPrivate,
  payload: AIEventPayload | undefined,
  options: {
    event: 'ai.processing.finish' | 'ai.processing.error';
    extra?: Partial<AIEventPayload>;
    reason?: string;
  },
): void {
  if (!payload) return;
  emitActivityEvent(host, options.event, { ...payload, ...options.extra });
  emitActivityEvent(host, 'ai.typing.stop', {
    ...payload,
    reason: options.reason ?? 'processing_complete',
  });
}

type AccessGated = {
  readonly permissions?: readonly string[];
  readonly currentConversationBotRoles?: readonly string[];
};

/** Visible to every sender of this scene: no permission or bot-role gate (platform/scope only). */
function isSenderNeutral(descriptor: AccessGated): boolean {
  return !descriptor.permissions?.length && !descriptor.currentConversationBotRoles?.length;
}

type CatalogTool = SkillToolCandidate & AccessGated;

function isSenderNeutralSkill(skill: SkillDescriptor, tools: readonly CatalogTool[]): boolean {
  if (!isSenderNeutral(skill as AccessGated) || skill.agentName) return false;
  // A skill is only listed while one of its tools is available; that tool must be ungated as well.
  return !skill.toolNames?.length || resolveSkillTools(skill, tools.filter(isSenderNeutral)).length > 0;
}

const byQualifiedName = <T extends { qualifiedName: string }>(a: T, b: T): number =>
  (a.qualifiedName < b.qualifiedName ? -1 : a.qualifiedName > b.qualifiedName ? 1 : 0);

/**
 * `stable`: sender-neutral catalog (system prefix, cached). `tail`: entries that depend on the
 * sender's permissions, the bot's role or the selected specialist (current message runtime tail).
 */
export function buildCapabilityContext(
  agents: readonly AgentDescriptor[],
  skills: readonly SkillDescriptor[],
  selectedName?: string,
  tools: readonly CatalogTool[] = [],
): { stable: string; tail: string } {
  const stable: string[] = [];
  const tail: string[] = [];
  const selected = selectedName
    ? agents.find((agent) => agent.qualifiedName === selectedName || agent.name === selectedName)
    : undefined;
  if (selectedName && !selected) {
    throw new Error(`Selected Agent capability is not visible: ${selectedName}`);
  }
  const entry = (item: { qualifiedName: string; description: string }) => ({ name: item.qualifiedName, description: item.description });
  if (selected) {
    tail.push(`## Active specialist: ${selected.qualifiedName}\n${selected.description}\n${selected.instructions}`);
  } else {
    const sorted = [...agents].sort(byQualifiedName);
    const neutral = renderAgentCatalog(sorted.filter(agent => isSenderNeutral(agent as AccessGated)).map(entry));
    if (neutral) stable.push(neutral);
    const gated = renderAgentCatalog(sorted.filter(agent => !isSenderNeutral(agent as AccessGated)).map(entry));
    if (gated) tail.push(gated);
  }
  // Progressive disclosure (#729): names and one-line triggers only; the full
  // instructions arrive through load_skill or intent priming.
  const neutralSkills = renderSkillCatalog(skills.filter(skill => isSenderNeutralSkill(skill, tools)).map(entry));
  if (neutralSkills) stable.push(neutralSkills);
  const gatedSkills = renderSkillCatalog(skills.filter(skill => !isSenderNeutralSkill(skill, tools)).map(entry));
  if (gatedSkills) tail.push(gatedSkills);
  return {
    stable: stable.join('\n\n'),
    tail: tail.length ? ['Also available in this turn (depends on the sender, bot role or selected specialist):', ...tail].join('\n\n') : '',
  };
}

function terminal(text: string, usage: Usage): TurnEndEvent {
  return {
    type: 'turn_end',
    output: [{ type: 'text', content: text }],
    usage: {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    },
  };
}

function zeroUsage(): Usage {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

/**
 * Sub-agents run inside the parent turn, so they need a live interactive turn:
 * opt-in via `ai.agent.subagentTurnMode`, never for Workroom assignments.
 */
function subagentsEnabled(host: ZhinAgentPrivate, turn: TurnIngress): boolean {
  if (host.config.subagentTurnMode !== 'sync') return false;
  return !turn.session.key.startsWith('workroom:')
    && !turn.principal.roles.includes('workroom_assignment');
}

/**
 * Progress updates go out as normal (not auto-recalled) replies next to the
 * activity indicator. Outbound messages are recorded without an actor, so the
 * conversation event feed already keeps them out of later background context.
 */
function createProgressSink(
  host: ZhinAgentPrivate,
  turn: TurnIngress,
  reply: TurnIngress['ports']['reply'],
): ((text: string) => Promise<void>) | undefined {
  if (!reply || turn.policy.unattended) return undefined;
  if (!progressUpdatesAllowed(resolveToolBudget(host.config.toolBudget).progressUpdates, turn)) return undefined;
  return async (text) => {
    const delivery = await reply.send([{ type: 'text', content: text }]);
    if (delivery.status !== 'sent') throw new Error(`progress update not sent: ${delivery.status}`);
  };
}

/**
 * #727 M3.4: the turn's ReplyPort with the outbound leak check in front of
 * it. Findings are masked, logged without their content, and the message
 * continues down the normal send chain.
 */
function guardedReply(
  host: ZhinAgentPrivate,
  turn: TurnIngress,
  inspector: OutboundLeakInspector,
): TurnIngress['ports']['reply'] {
  const reply = turn.ports.reply;
  if (!reply || host.config.injectionGuard?.outboundCheck === 'off') return reply;
  return guardReplyPort(reply, inspector, (findings: readonly LeakFinding[]) => {
    logger.warn(`outbound leak masked in turn ${turn.identity.turnId}: ${findings.map((f) => `${f.kind}×${f.count}`).join(', ')}`);
  });
}

/** Quota key for a turn: the sender, plus the group when the turn comes from a group or channel. */
function usageSubjectOf(turn: TurnIngress, userId: string): UsageSubject {
  const origin = turn.origin;
  const shared = origin.kind === 'im' && (origin.scope === 'group' || origin.scope === 'channel');
  return Object.freeze({
    userId,
    ...(shared ? { groupId: usageGroupId(origin.platform, origin.endpoint, origin.sceneId) } : {}),
    owner: resolveTurnTrustLevel(turn) === 'owner',
  });
}

/** #726: loaded skill instructions are labelled per skill as third-party guidance. */
function labelSkillInstructions(instructions: readonly string[]): string {
  return instructions.map(text => labelThirdPartyGuidance('skill', text)).join('\n\n');
}

/**
 * BM25 recall for this turn (#734). Recall is advisory: a failure is logged
 * and the turn continues without it.
 */
async function recallTurnMemory(
  host: ZhinAgentPrivate,
  turn: TurnIngress,
  query: string,
): Promise<string | undefined> {
  const runtime = host.semanticMemory;
  if (!runtime?.active) return undefined;
  try {
    const result = await runtime.recall({
      sessionKey: turn.session.key,
      subjectId: turn.principal.subjectId,
      ...(turn.origin.kind === 'im' ? { platform: turn.origin.platform } : {}),
    }, query, turn.signal);
    return result?.text;
  } catch (error) {
    if (turn.signal.aborted) throw error;
    logger.warn(`semantic memory recall failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/**
 * Hard-gate wiring (ADR 0036): settings, the Host's approval cards, and the decision audit when the
 * Host exposes one (`decisionEvents.record`, slice B). The gate runs even when none are present.
 */
function hardGateOptions(
  host: ZhinAgentPrivate,
): Pick<TurnToolRuntimeOptions, 'hardGate' | 'decisionAudit' | 'approvalQueue' | 'controlPlane' | 'opsCooldown'> {
  const audit = (host as { readonly decisionEvents?: Partial<DecisionAuditSink> }).decisionEvents;
  const controlPlane = hostControlPlaneSource(host);
  return {
    ...(host.config.toolHardGate ? { hardGate: host.config.toolHardGate } : {}),
    ...(controlPlane ? { controlPlane } : {}),
    ...(host.toolApprovals ? { approvalQueue: host.toolApprovals } : {}),
    ...(host.opsCooldown ? { opsCooldown: host.opsCooldown } : {}),
    ...(audit && typeof audit.record === 'function' ? { decisionAudit: audit as DecisionAuditSink } : {}),
  };
}
