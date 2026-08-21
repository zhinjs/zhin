import { createUserMessage, renderContextMessage, type AgentMessage, type ContextMessage, type Usage } from '@zhin.js/ai';
import type { AgentDescriptor } from '@zhin.js/agent-feature';
import type { SkillDescriptor } from '@zhin.js/skill';
import { activityFeedbackAiBus } from '../activity-feedback/ai-bus.js';
import type { AIEventPayload } from '../ai-event-subscriber.js';
import { applyInboundMediaInjection, resolveTurnMediaInjection } from '../turn/inbound-media.js';
import { isTurnTerminalEvent, type TurnEndEvent, type TurnEvent, type TurnTerminalEvent } from '../event/turn-event.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import type { PluginAILoopHookRegistry } from '../plugin-loop-hooks.js';
import type { AgentLoopTurnResult } from '../core/agent-core-run.js';
import type { AgentCore } from '../core/agent-core.js';
import { turnToolExecutionAuthority, TurnToolRuntime } from '../tool/turn-tool-runtime.js';
import type { ContextSystem } from '../context/context-system.js';
import type { SessionSystem } from '../session/session-system.js';
import { createDeferredCapabilityPlan } from './deferred-capability-plan.js';
import type {
  AgentTurnEngine,
  AgentTurnExecutionContext,
} from './agent-runtime.js';
import type { TurnTerminalProjection } from '../turn/execute-agent-turn.js';
import { createScheduleCapabilityPlan } from './schedule-capability-plan.js';
import type { TurnIngress } from '../turn/turn-ingress.js';
import { buildTextTurnOutbound } from '../turn/turn-complete.js';

export interface FullAgentTurnEngineOptions {
  readonly host: ZhinAgentPrivate;
  readonly core: AgentCore;
  readonly sessionSystem: SessionSystem;
  readonly contextSystem: ContextSystem;
  readonly loopHooks?: PluginAILoopHookRegistry;
  readonly bootstrapContext?: string;
}

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

  const snapshot = await host.contextRepository.getDeferredToolSnapshot(prep.sessionId);
  const projected = {
    ...context.capabilities,
    tools: context.toolCapabilities,
  };
  const plan = createDeferredCapabilityPlan({
    capabilities: projected,
    sessionSnapshot: snapshot,
    config: host.config,
    platform: context.turn.origin.kind === 'im' ? context.turn.origin.platform : undefined,
    persistSnapshot: (next) => host.contextRepository.setDeferredToolSnapshot(prep.sessionId, next),
  });
  const activeSkillsContext = plan.controller.loadedSkillInstructions().join('\n\n');
  const pendingContext = context.turn.ports.conversationContext
    ? await context.turn.ports.conversationContext.readPending(context.turn.signal)
    : undefined;
  const prompt = await contextSystem.buildTextTurnContext({
    host,
    turn: context.turn,
    content: prep.turnUser.rawContent,
    turnUser: prep.turnUser,
    deferredStats: plan.deferredStats,
    mode: context.turn.input.media?.some((item) => item.kind === 'image') ? 'vision' : undefined,
    activeSkillsContext,
  });
  const providerInput = context.turn.input.media?.length
    ? prompt.modelInput
    : undefined;
  const media = await resolveTurnMediaInjection(
    context.turn.input.media,
    context.turn.ports.references,
    context.turn.signal,
    providerInput,
  );
  for (const [index, outcome] of media.outcomes.entries()) {
    yield Object.freeze({
      type: 'media_resolution' as const,
      index,
      mediaKind: outcome.kind,
      status: outcome.status,
      code: outcome.code,
    });
  }
  const contextText = pendingContext?.blocks.length
    ? renderContextMessage({
        role: 'user-context',
        blocks: pendingContext.blocks.map((block) => ({
          type: 'untrusted_conversation_event',
          eventType: block.eventType,
          text: block.text,
        })),
      } satisfies ContextMessage)
    : '';
  const userMessages = applyInboundMediaInjection(
    contextText ? [createUserMessage(contextText), ...prompt.userMessages] : prompt.userMessages,
    media,
  );
  const toolRuntime = new TurnToolRuntime(context.turn, plan.capabilities);
  const promptRuntime = Object.freeze({
    bootstrapContext: buildCapabilityBootstrap(
      options.bootstrapContext,
      context.capabilities.agents,
      context.capabilities.skills,
      context.selection.agent,
    ),
    activeSkillsContext,
    agentNickname: host.activeBinding?.nickname,
    modelId: host.activeBinding?.model,
    providerAlias: host.activeBinding?.providerAlias,
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
      allTools: [...plan.allTools],
      resolvedTools: [...plan.resolvedTools],
      toolExecution: turnToolExecutionAuthority(toolRuntime),
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
      generation: context.turn.identity.generation,
    }),
  });

  let thinkingSent = false;
  let accumulatedThinking = '';
  const thinkingPreview = host.config.thinkingPreview === true;
  const thinkingMaxLen = host.config.thinkingPreviewMaxLength ?? 200;
  const completion = yield* bufferTerminal(stream, (event) => {
    if (!payload) return;
    if (event.type === 'iteration_start' && event.iteration > 1) {
      emitActivityEvent(host, 'ai.processing.start', {
        ...payload,
        iterations: event.iteration,
        content: `处理中 [${event.iteration}/${event.maxIterations}]...`,
      });
      return;
    }
    if (event.type !== 'thinking' || !event.text) return;
    accumulatedThinking += event.text;
    if (thinkingPreview) {
      const preview = accumulatedThinking.length > thinkingMaxLen
        ? accumulatedThinking.slice(0, thinkingMaxLen) + '...'
        : accumulatedThinking;
      emitActivityEvent(host, 'ai.thinking', { ...payload, thinking: preview });
    } else if (!thinkingSent) {
      thinkingSent = true;
      emitActivityEvent(host, 'ai.thinking', { ...payload, thinking: event.text });
    }
  });
  yield completion.terminal;
  return {
    project: async () => {
      try {
        if (completion.terminal.type === 'turn_end' && context.turn.ports.reply) {
          const outbound = completion.terminal.output.length > 0
            ? completion.terminal.output
            : buildTextTurnOutbound(completion.result.reply, completion.result);
          const delivery = await context.turn.ports.reply.send(outbound);
          if (
            delivery.status === 'failed'
            || delivery.status === 'rejected'
            || (delivery.status === 'suppressed' && outbound.length > 0)
          ) {
            const code = 'code' in delivery ? delivery.code : delivery.status;
            throw new Error(`Synchronous reply projection failed: ${code}`);
          }
        }
        if (context.turn.intent.kind === 'observe') {
          await host.contextRepository.appendMessages(
            prep.sessionId,
            prep.turnUser.promptMessages,
            { messageExtras: [prep.turnUser.userMessageExtra] },
          );
        } else {
          await completion.result.projectConversation?.();
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
          usage: completion.result.usage,
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
      promptMessages: [createUserMessage(rawContent)],
    },
    activeSkillsContext,
  });
  const toolRuntime = new TurnToolRuntime(context.turn, plan.capabilities);
  const promptRuntime = Object.freeze({
    bootstrapContext: options.bootstrapContext,
    activeSkillsContext,
    agentNickname: host.activeBinding?.nickname,
    modelId: host.activeBinding?.model,
    providerAlias: host.activeBinding?.providerAlias,
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
      allTools: [...plan.allTools],
      resolvedTools: [...plan.resolvedTools],
      toolExecution: turnToolExecutionAuthority(toolRuntime),
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
  };
}

function emitActivityEvent(
  host: ZhinAgentPrivate,
  event: string,
  payload: AIEventPayload,
): void {
  if (host.emitter) {
    host.emitter.emit(event, payload);
    return;
  }
  activityFeedbackAiBus.emit(event, payload);
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

function buildCapabilityBootstrap(
  base: string | undefined,
  agents: readonly AgentDescriptor[],
  skills: readonly SkillDescriptor[],
  selectedName?: string,
): string {
  const parts = base?.trim() ? [base.trim()] : [];
  const selected = selectedName
    ? agents.find((agent) => agent.qualifiedName === selectedName || agent.name === selectedName)
    : undefined;
  if (selectedName && !selected) {
    throw new Error(`Selected Agent capability is not visible: ${selectedName}`);
  }
  if (selected) {
    parts.push(`## Active specialist: ${selected.qualifiedName}\n${selected.description}\n${selected.instructions}`);
  } else if (agents.length > 0) {
    parts.push([
      '## Available specialist agents',
      ...agents.map((agent) => `- ${agent.qualifiedName}: ${agent.description}`),
    ].join('\n'));
  }
  if (skills.length > 0) {
    parts.push([
      '## Available skills',
      ...skills.map((skill) => `- ${skill.qualifiedName}: ${skill.description}`),
    ].join('\n'));
  }
  return parts.join('\n\n');
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
