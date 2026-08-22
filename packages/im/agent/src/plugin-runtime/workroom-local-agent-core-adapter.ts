import { createUserMessage } from '@zhin.js/ai';
import type { ResolvedAgentBinding } from '../config/types.js';
import type { AgentCore } from '../core/agent-core.js';
import { collectAgentLoopTurnRun } from '../core/agent-core-run.js';
import type { TurnEvent } from '../event/turn-event.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import type { PluginAILoopHookRegistry } from '../plugin-loop-hooks.js';
import { TurnToolRuntime, turnToolExecutionAuthority } from '../tool/turn-tool-runtime.js';
import { runWithAgentTurnConfiguration } from '../turn/agent-turn-context.js';
import { createTurnIngress } from '../turn/turn-ingress.js';
import type {
  WorkroomLocalAgentTurnInput,
  WorkroomLocalAgentTurnPort,
  WorkroomLocalTurnJournalAttribution,
} from './workroom-local-agent-loop.js';

export interface AgentCoreWorkroomLocalTurnPortOptions {
  readonly host: ZhinAgentPrivate;
  readonly core: AgentCore;
  readonly resolveBinding: (agentDefinitionId: string | undefined) => ResolvedAgentBinding | undefined;
  readonly generation: number;
  readonly loopHooks?: PluginAILoopHookRegistry;
  readonly onTurnEvent?: (
    attribution: WorkroomLocalTurnJournalAttribution,
    event: TurnEvent,
  ) => void | Promise<void>;
}

/** Exact Deferred Capability Plan adapter over the production AgentCore/agentLoop. */
export function createAgentCoreWorkroomLocalTurnPort(
  options: AgentCoreWorkroomLocalTurnPortOptions,
): WorkroomLocalAgentTurnPort {
  return Object.freeze({
    run: async (input: WorkroomLocalAgentTurnInput, signal: AbortSignal) =>
      await runAgentCoreLocalTurn(options, input, signal),
  });
}

async function runAgentCoreLocalTurn(
  options: AgentCoreWorkroomLocalTurnPortOptions,
  input: WorkroomLocalAgentTurnInput,
  signal: AbortSignal,
) {
  const binding = options.resolveBinding(input.agentDefinitionId);
  if (!binding) {
    throw new Error(`Local Assignment Agent binding is unavailable: ${input.agentDefinitionId ?? 'unbound'}`);
  }
  const publish = async (event: TurnEvent): Promise<void> => {
    await options.onTurnEvent?.(input.journalAttribution, event);
  };
  const plan = input.capabilityPlan;
  const turn = createTurnIngress({
    identity: Object.freeze({
      rootId: 'workroom-local-assignment',
      generation: options.generation,
      traceId: input.turnId,
      turnId: input.turnId,
    }),
    origin: Object.freeze({ kind: 'http' as const, sessionId: input.sessionId }),
    principal: Object.freeze({
      subjectId: input.principalId,
      roles: Object.freeze(['workroom_assignment']),
    }),
    intent: Object.freeze({ kind: 'new' as const }),
    input: Object.freeze({
      text: input.prompt,
      metadata: Object.freeze({ ...input.journalAttribution }),
    }),
    session: Object.freeze({ key: input.sessionId }),
    policy: Object.freeze({
      permissions: Object.freeze([]),
      unattended: true,
      shell: Object.freeze({
        security: 'allowlist' as const,
        execPreset: 'development' as const,
        approvalMode: 'deny' as const,
        isolation: 'required' as const,
      }),
      filesystem: Object.freeze({
        workspaceRoot: input.workspaceRoot,
        workingDirectory: input.workspaceRoot,
        access: 'workspace-write' as const,
      }),
    }),
    capabilities: Object.freeze({
      tools: Object.freeze(plan.capabilities.map(capability => capability.name)),
      skills: Object.freeze([]),
    }),
    signal,
    ports: Object.freeze({ journal: Object.freeze({ append: publish }) }),
  });
  const runtime = new TurnToolRuntime(turn, plan.capabilities);
  const activeSkillsContext = plan.controller.loadedSkillInstructions().join('\n\n');
  const run = () => collectAgentLoopTurnRun(options.core.runText({
    host: options.host,
    sessionId: input.sessionId,
    rawContent: input.prompt,
    promptProfile: { kind: 'interactive' },
    turnContext: turn,
    allTools: [...plan.allTools],
    resolvedTools: [...plan.resolvedTools],
    toolExecution: turnToolExecutionAuthority(runtime),
    toolEventSource: 'authority',
    loopHooks: options.loopHooks,
    promptRuntime: {
      activeSkillsContext,
      agentNickname: binding.nickname,
      modelId: binding.model,
      providerAlias: binding.providerAlias,
    },
    personaEnhanced: [
      'You are executing one exact Workroom Assignment.',
      'Use only the supplied Deferred Capability Plan and workspace authority.',
      'Return the requested structured Task Report JSON; never mutate Workroom Task status.',
      activeSkillsContext,
    ].filter(Boolean).join('\n\n'),
    modelId: binding.model,
    modelCandidates: [binding.model],
    initialMessages: [createUserMessage(input.prompt)],
    signal,
    deferredStats: plan.deferredStats,
    deferredController: plan.controller,
    toolCatalog: plan.catalog,
    toolLoading: 'deferred',
    conversationPersistence: 'none',
    generation: options.generation,
    onTurnEvent: event => { void publish(event); },
  }));
  const result = await runWithAgentTurnConfiguration(
    { activeBinding: binding },
    run,
  );
  return Object.freeze({ output: result.reply });
}
