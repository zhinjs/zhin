import type { AgentOutputElement } from '../outbound/agent-output.js';
import { bindActivityFeedbackTurnSource, inheritActivityFeedbackSource } from '../activity-feedback/operation-source.js';
import { resolveIngressUserMessage } from '../session/turn-ingress-session.js';
import { MessageAliasTable, type Usage } from '@zhin.js/ai';
import { renderAgentCatalog, renderSkillCatalog } from '../skill/capability-catalog.js';
import { SKILL_DISCLOSURE_PROMPT_HINT } from '../skill/progressive-disclosure.js';
import type { AgentDescriptor } from '@zhin.js/agent-feature';
import type { SkillDescriptor } from '@zhin.js/skill';
import { resolveSkillTools, type SkillToolCandidate } from './skill-tool-resolution.js';
import type { AIEventPayload } from '../ai-event-subscriber.js';
import { isTurnTerminalEvent, type TurnEndEvent, type TurnEvent, type TurnTerminalEvent } from '../event/turn-event.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import type { PluginAILoopHookRegistry } from '../plugin-loop-hooks.js';
import type { AgentLoopTurnResult } from '../core/agent-core-run.js';
import type { ReplyPhaseFacts } from '../core/reply-phase.js';
import type { DeliveryOutcome, TurnIngress } from '../turn/turn-ingress.js';
import type { AgentCore } from '../core/agent-core.js';
import { TurnToolExecutionAuthority, TurnToolRuntime, type TurnToolRuntimeOptions } from '../tool/turn-tool-runtime.js';
import type { DecisionAuditSink } from '../security/tool-hard-gate.js';
import type { ContextSystem } from '../context/context-system.js';
import type { SessionSystem } from '../session/session-system.js';
import type { AgentTurnExecutionContext } from './agent-runtime.js';
import type { TurnTerminalProjection } from '../turn/execute-agent-turn.js';
import { createScheduleCapabilityPlan } from './schedule-capability-plan.js';
import { segmentKindForLayer } from '../prompt/prompt-assembly-registry.js';
import type { PromptSegment } from '../prompt/segments/types.js';
import { labelThirdPartyGuidance } from '../prompt/third-party-guidance.js';
import { fillPromptSlots } from '../prompt/system-prompt.js';
import { hasNicknameSlot } from '../context/self-profile.js';
import type { TurnContextView } from '../context/turn-envelope.js';
import type { PromptSectionDescriptor } from '@zhin.js/prompt-section';
import { progressUpdatesAllowed, resolveToolBudget } from '../core/turn-progress.js';
import { OutboundLeakInspector, guardReplyPort, type LeakFinding } from '../security/outbound-leak-guard.js';
import { getLogger } from '@zhin.js/logger';
import { isLocale } from '@zhin.js/plugin-runtime';
import { hostControlPlaneSource } from '../security/host-control-plane.js';
import type { ContextFile } from '../bootstrap.js';

export interface FullAgentTurnEngineOptions {
  readonly host: ZhinAgentPrivate;
  readonly core: AgentCore;
  readonly sessionSystem: SessionSystem;
  readonly contextSystem: ContextSystem;
  readonly loopHooks?: PluginAILoopHookRegistry;
  readonly bootstrapContext?: string;
  readonly contextFiles?: readonly ContextFile[];
}

const logger = getLogger('FullAgentTurnEngine');

export async function* runScheduleTurn(
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
    contextFiles: options.contextFiles,
  });
  const messageAliases = new MessageAliasTable();
  const toolRuntime = new TurnToolRuntime(context.turn, plan.capabilities, {
    messageAliases,
    injectionGuard: host.config.injectionGuard,
    ...hardGateOptions(host),
  });
  const turnSegments = createTurnPromptSegments(context.capabilities.promptSections, context.capabilities.owner, context.turn, host.activeBinding?.nickname);
  const promptRuntime = Object.freeze({
    bootstrapContext: options.bootstrapContext,
    contextFiles: options.contextFiles,
    activeSkillsContext,
    agentNickname: host.activeBinding?.nickname,
    modelId: prompt.modelId,
    providerAlias: prompt.providerAlias,
    modelSdk: prompt.modelSdk,
    segments: Object.freeze([...turnSegments, ...(context.capabilities.promptSegments ?? [])]),
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
export function createTurnPromptSegments(
  sections: readonly PromptSectionDescriptor[],
  agentOwner: PromptSectionDescriptor['owner'],
  turn: TurnContextView,
  nickname?: string,
): PromptSegment[] {
  const seen = new Set<string>();
  const segments: PromptSegment[] = [];
  for (const section of sections) {
    if (seen.has(section.qualifiedName)) throw new Error(`Duplicate Prompt Section: ${section.qualifiedName}`);
    seen.add(section.qualifiedName);
    const thirdParty = section.owner !== agentOwner;
    const content = fillPromptSlots(
      thirdParty ? labelThirdPartyGuidance(`plugin:${String(section.owner)}`, section.content) : section.content,
      nickname,
    );
    const tail = Boolean(section.platforms?.length);
    const kind = turn.origin.kind === 'im' && hasNicknameSlot(section.content)
      ? 'scene'
      : (tail ? 'platform' : segmentKindForLayer(section.layer));
    const weight = tail ? section.order - 1_000_000 : section.order;
    segments.push({
      id: section.qualifiedName,
      kind,
      weight,
      budgetOrder: section.order,
      retention: section.retention,
      maxChars: section.maxChars,
      inject: () => content,
    });
  }
  return segments;
}

export interface BufferedExecution {
  terminal: TurnTerminalEvent;
  result: AgentLoopTurnResult;
  projected?: true;
}

/** Each Core execute retains its single terminal contract; PromptController may execute follow-ups. */
export async function* collectPromptExecutions(
  stream: AsyncGenerator<TurnEvent, AgentLoopTurnResult>,
  executions: BufferedExecution[],
  onEvent?: (event: TurnEvent) => void,
): AsyncGenerator<TurnEvent, BufferedExecution> {
  let control: TurnTerminalEvent | undefined;
  try {
    while (true) {
      const step = await stream.next();
      if (step.done) {
        if (!executions.length) {
          if (!control) throw new Error('Full AgentCore completed without a terminal TurnEvent');
          return { terminal: control, result: step.value };
        }
        const last = executions.at(-1)!;
        const usage = executions.reduce((sum, execution) => ({
          prompt_tokens: sum.prompt_tokens + execution.result.usage.prompt_tokens,
          completion_tokens: sum.completion_tokens + execution.result.usage.completion_tokens,
          total_tokens: sum.total_tokens + execution.result.usage.total_tokens,
        }), zeroUsage());
        const result: AgentLoopTurnResult = {
          ...last.result,
          usage,
          iterations: executions.reduce((sum, execution) => sum + execution.result.iterations, 0),
          toolCalls: executions.flatMap(execution => execution.result.toolCalls),
          projectConversation: async delivered => {
            for (const execution of executions) {
              if (execution.projected) continue;
              execution.projected = true;
              await execution.result.projectConversation?.(execution.result.replyPhaseId ? undefined
                : execution === last ? delivered : { confirmedOutput: [] });
            }
          },
        };
        const terminal = last.terminal.type === 'turn_end'
          ? { ...last.terminal, usage: sumTerminalUsage(executions) } : last.terminal;
        return { terminal, result };
      }
      if (isTurnTerminalEvent(step.value)) {
        if (control || executions.length) throw new Error('PromptController emitted an unexpected terminal');
        control = step.value;
      } else { onEvent?.(step.value); yield step.value; }
    }
  } finally { await stream.return(undefined as never); }
}

export function sumTerminalUsage(executions: readonly BufferedExecution[]): TurnEndEvent['usage'] {
  if (executions.length === 1 && executions[0]!.terminal.type === 'turn_end') return executions[0]!.terminal.usage;
  const usage: TurnEndEvent['usage'] = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  for (const { terminal } of executions) {
    if (terminal.type !== 'turn_end') continue;
    usage.promptTokens += terminal.usage.promptTokens;
    usage.completionTokens += terminal.usage.completionTokens;
    usage.totalTokens += terminal.usage.totalTokens;
    for (const key of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const) {
      if (terminal.usage[key] !== undefined) usage[key] = (usage[key] ?? 0) + terminal.usage[key]!;
    }
  }
  const reported = executions.flatMap(execution => execution.terminal.type === 'turn_end' ? [execution.terminal.usage.reported] : []);
  if (reported.some(value => value !== undefined)) {
    usage.reported = Object.fromEntries((['input', 'output', 'totalTokens', 'cacheRead', 'cacheWrite', 'reasoning'] as const)
      .flatMap(key => reported.some(value => value?.[key] !== undefined)
        ? [[key, reported.every(value => value?.[key] === true)]] : []));
  }
  return usage;
}

export function aggregateReplyPhases(phases: readonly ReplyPhaseFacts[]): { delivery: DeliveryOutcome; confirmedOutput: AgentOutputElement[] } {
  const confirmedOutput = phases.flatMap(phase => phase.confirmedOutput);
  const messages = phases.flatMap(phase => 'messages' in phase.delivery ? phase.delivery.messages ?? [] : []);
  const last = (phases.find(phase => phase.stopped) ?? phases.at(-1)!).delivery;
  if (last.status === 'sent' || last.status === 'suppressed' && confirmedOutput.length) {
    return {
      confirmedOutput,
      delivery: {
        status: 'sent',
        messages,
        ...(messages.find(message => message !== null) ? { messageId: messages.find(message => message !== null)!.id } : {}),
        messageContexts: phases.flatMap(phase => phase.delivery.status === 'sent' ? phase.delivery.messageContexts ?? [] : []),
      },
    };
  }
  return {
    confirmedOutput,
    delivery: last.status === 'suppressed' ? last : {
      ...last,
      messages,
      ...(last.status === 'failed' && confirmedOutput.length ? { deliveryPartial: true as const, retryable: false } : {}),
    },
  };
}

export async function* bufferTerminal(
  stream: AsyncGenerator<TurnEvent, AgentLoopTurnResult>,
  onEvent?: (event: TurnEvent) => void,
): AsyncGenerator<TurnEvent, { terminal: TurnTerminalEvent; result: AgentLoopTurnResult }> {
  let buffered: TurnTerminalEvent | undefined;
  try {
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
  } finally { await stream.return(undefined as never); }
}

export function activityPayloadFromImTurn(
  turn: TurnIngress,
  sessionId: string,
  extra: Partial<AIEventPayload> = {},
): AIEventPayload | undefined {
  const origin = turn.origin;
  if (origin.kind !== 'im') return undefined;
  const { hookContext: extraHook, ...rest } = extra;
  return bindActivityFeedbackTurnSource<AIEventPayload>({
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
  }, turn);
}

export function emitActivityEvent(
  host: ZhinAgentPrivate,
  event: string,
  payload: AIEventPayload,
): void {
  host.emitter.emit(event, payload);
}

export function emitActivityStop(
  host: ZhinAgentPrivate,
  payload: AIEventPayload | undefined,
  options: {
    event: 'ai.processing.finish' | 'ai.processing.error';
    extra?: Partial<AIEventPayload>;
    reason?: string;
  },
): void {
  if (!payload) return;
  emitActivityEvent(host, options.event, inheritActivityFeedbackSource({ ...payload, ...options.extra }, payload));
  emitActivityEvent(host, 'ai.typing.stop', inheritActivityFeedbackSource({
    ...payload,
    reason: options.reason ?? 'processing_complete',
  }, payload));
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
    // The whole Agent catalog disappears when a specialist is selected. Keep that
    // selection-dependent section in the tail without exposing it to specialists.
    const catalog = renderAgentCatalog(sorted.map(entry));
    if (catalog) tail.push(catalog);
  }
  // Progressive disclosure (#729): names and one-line triggers only; the full
  // instructions arrive through load_skill or intent priming.
  const neutralSkills = renderSkillCatalog(skills.filter(skill => isSenderNeutralSkill(skill, tools)).map(entry));
  if (neutralSkills) stable.push(SKILL_DISCLOSURE_PROMPT_HINT, neutralSkills);
  const gatedSkills = renderSkillCatalog(skills.filter(skill => !isSenderNeutralSkill(skill, tools)).map(entry));
  if (gatedSkills) {
    if (!neutralSkills) tail.push(SKILL_DISCLOSURE_PROMPT_HINT);
    tail.push(gatedSkills);
  }
  return {
    stable: stable.join('\n\n'),
    tail: tail.length ? ['Also available to you this turn (depends on the sender, your account role or selected specialist):', ...tail].join('\n\n') : '',
  };
}

export function terminal(text: string, usage: Usage): TurnEndEvent {
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

export function zeroUsage(): Usage {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

/**
 * Progress updates go out as normal (not auto-recalled) replies next to the
 * activity indicator. Outbound messages are recorded without an actor, so the
 * conversation event feed already keeps them out of later background context.
 */
export function createProgressSink(
  host: ZhinAgentPrivate,
  turn: TurnIngress,
  reply: TurnIngress['ports']['reply'],
): ((text: string) => Promise<void>) | undefined {
  if (!reply || turn.policy.unattended) return undefined;
  const mode = resolveToolBudget(host.config.toolBudget).progressUpdates;
  if (turn.execution.kind === 'interactive' ? mode === 'off' : !progressUpdatesAllowed(mode, turn)) return undefined;
  return async (text) => {
    turn.signal.throwIfAborted();
    const delivery = await reply.send([{ type: 'text', content: text }]);
    if (delivery.status !== 'sent') throw new Error(`progress update not sent: ${delivery.status}`);
  };
}

/**
 * #727 M3.4: the turn's ReplyPort with the outbound leak check in front of
 * it. Findings are masked, logged without their content, and the message
 * continues down the normal send chain.
 */
export function guardedReply(
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
/** #726: loaded skill instructions are labelled per skill as third-party guidance. */
export function labelSkillInstructions(instructions: readonly string[]): string {
  return instructions.map(text => labelThirdPartyGuidance('skill', text)).join('\n\n');
}

/**
 * BM25 recall for this turn (#734). Recall is advisory: a failure is logged
 * and the turn continues without it.
 */
export async function recallTurnMemory(
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
export function hardGateOptions(
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
