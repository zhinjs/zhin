import type { AgentMessage, Usage } from '@zhin.js/ai';
import type { AgentDescriptor } from '@zhin.js/agent-feature';
import type { SkillDescriptor } from '@zhin.js/skill';
import { applyInboundMediaInjection, resolveTurnMediaInjection } from '../turn/inbound-media.js';
import { isTurnTerminalEvent, type TurnEvent, type TurnTerminalEvent } from '../event/turn-event.js';
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
): AsyncGenerator<TurnEvent, void> {
  const { host, sessionSystem, contextSystem } = options;
  const prep = await sessionSystem.prepareIngressTurn(host, context.turn);
  const rate = host.rateLimiter.check(prep.userId);
  if (!rate.allowed) {
    const text = rate.message || '请稍后再试';
    await sessionSystem.touchAfterTurn(host, prep.sessionId);
    yield terminal(text, zeroUsage());
    return;
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
  const media = await resolveTurnMediaInjection(context.turn.input.media);
  const prompt = await contextSystem.buildTextTurnContext({
    host,
    turn: context.turn,
    content: prep.turnUser.rawContent,
    turnUser: prep.turnUser,
    deferredStats: plan.deferredStats,
    mode: media.blocks.length > 0 ? 'vision' : undefined,
    activeSkillsContext,
  });
  const userMessages = applyInboundMediaInjection(prompt.userMessages, media);
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

  const completion = yield* bufferTerminal(stream);
  await sessionSystem.touchAfterTurn(host, prep.sessionId);
  await host.finalizeActiveTurn({
    usage: completion.result.usage,
    path: completion.result.path,
    iterations: completion.result.iterations,
    model: completion.result.model,
    userInput: prep.turnUser.rawContent,
    output: completion.result.reply,
    thinking: completion.result.thinking,
  });
  yield completion.terminal;
}

async function* bufferTerminal(
  stream: AsyncGenerator<TurnEvent, AgentLoopTurnResult>,
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
    yield step.value;
  }
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

function terminal(text: string, usage: Usage): TurnTerminalEvent {
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
