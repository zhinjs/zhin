import { getLogger } from '@zhin.js/logger';
import { createLlmApiRuntime, sdkEntryFromProvider, AIProvider, ModelRegistry, type LlmApiRuntime } from '@zhin.js/ai';
import { createSkillSystem, SkillSystem } from '../skill/skill-system.js';
import type { AgentCore } from '../core/agent-core.js';
import type { ToolSystem } from '../tool/tool-system.js';
import type { ContextSystem } from '../context/context-system.js';
import type { MemorySystem } from '../memory/memory-system.js';
import type { SessionSystem } from '../session/session-system.js';
import type { EventSystem } from '../event/event-system.js';
import type { SkillRegistry } from '../resource-hub/skill-registry.js';
import { bindingToModelConfig } from '../routing/runtime-binding.js';
import type { ZhinAgentDependencies } from '../config/index.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import type { TurnContextBridgeState } from '../turn/turn-context-bridge.js';
const logger = getLogger('ZhinAgent');

/** configure 的写入目标：权威接口（ZhinAgentPrivate）Pick + 门面内部装配字段。 */
export type ConfigureZhinAgentTarget = Pick<
  ZhinAgentPrivate,
  | 'config' | 'skillRegistry' | 'skillSystem' | 'resourceHub' | 'agentCore' | 'toolSystem'
  | 'contextSystem' | 'sessionSystem'
  | 'agentSessionStore' | 'contextRepository'
  | 'modelRegistry' | 'subagentSystem' | 'activeBinding'
  | 'llmRuntime'
  | 'bootstrapContext' | 'globalContext' | 'skillsSummaryXML' | 'deferred'
> & {
  /** 接口外的运行时模块（declare 在类上，不经 ZhinAgentPrivate 暴露） */
  memorySystem: MemorySystem | null;
  eventSystem: EventSystem | null;
  providerResolver: ((alias: string) => AIProvider) | null;
  alwaysSkillsBaseline: string;
  turnContextState: TurnContextBridgeState;
};

export function applyZhinAgentConfigure(
  target: ConfigureZhinAgentTarget,
  deps: Partial<ZhinAgentDependencies>,
): void {
  if (deps.providerResolver !== undefined && deps.llmRuntime === undefined) {
    throw new Error('providerResolver requires an owner-scoped llmRuntime');
  }
  if (deps.skillRegistry !== undefined) {
    target.skillRegistry = deps.skillRegistry;
    target.skillSystem = deps.skillRegistry ? createSkillSystem(deps.skillRegistry) : null;
    logger.debug(`SkillRegistry connected (${deps.skillRegistry.size} skills)`);
  }
  if (deps.resourceHub !== undefined) {
    target.resourceHub = deps.resourceHub;
    logger.debug('AgentResourceHub connected for MCP and resources');
  }
  if (deps.agentCore !== undefined) target.agentCore = deps.agentCore;
  if (deps.toolSystem !== undefined) target.toolSystem = deps.toolSystem;
  if (deps.contextSystem !== undefined) target.contextSystem = deps.contextSystem;
  if (deps.memorySystem !== undefined) target.memorySystem = deps.memorySystem;
  if (deps.sessionSystem !== undefined) target.sessionSystem = deps.sessionSystem;
  if (deps.eventSystem !== undefined) target.eventSystem = deps.eventSystem;
  if (deps.agentSessionStore !== undefined) target.agentSessionStore = deps.agentSessionStore;
  if (deps.contextRepository !== undefined) target.contextRepository = deps.contextRepository;
  if (deps.modelRegistry !== undefined) {
    target.modelRegistry = deps.modelRegistry;
    target.subagentSystem?.setModelRegistry(deps.modelRegistry);
  }
  if (deps.providerResolver !== undefined) {
    target.providerResolver = deps.providerResolver;
  }
  if (deps.llmRuntime !== undefined) target.llmRuntime = deps.llmRuntime;
  if (deps.activeBinding !== undefined) {
    target.activeBinding = deps.activeBinding;
    if (deps.activeBinding) {
      const patch = bindingToModelConfig(deps.activeBinding);
      target.config = { ...target.config, ...patch };
    }
  }
  if (deps.subagentSender !== undefined) {
    target.subagentSystem?.setSender(deps.subagentSender);
  }
  if (deps.deferredResultSender !== undefined) target.deferred.resultSender = deps.deferredResultSender;
  if (deps.bootstrapContext !== undefined) {
    target.bootstrapContext = deps.bootstrapContext;
    logger.debug(`Bootstrap context set (${deps.bootstrapContext.length} chars)`);
  }
  if (deps.globalContext !== undefined) {
    target.globalContext = deps.globalContext;
    logger.debug(`Global context set (${deps.globalContext.length} chars)`);
  }
  if (deps.activeSkillsContext !== undefined) {
    target.alwaysSkillsBaseline = deps.activeSkillsContext || '';
    target.turnContextState.alwaysSkillsBaseline = target.alwaysSkillsBaseline;
  }
  if (deps.skillsSummaryXML !== undefined) target.skillsSummaryXML = deps.skillsSummaryXML || '';
}

export function wireZhinAgentLlmApiLayer(
  provider: AIProvider,
  providerResolver: ((alias: string) => AIProvider) | null,
): LlmApiRuntime {
  return createLlmApiRuntime(
    [sdkEntryFromProvider(provider)],
    (alias) => {
      const p = alias === provider.name ? provider : providerResolver?.(alias);
      return p?.models ?? [];
    },
  );
}
