import { Logger } from '@zhin.js/logger';
import { registerLlmApiFromProviders, sdkEntryFromProvider } from '@zhin.js/ai';
import type { AIProvider } from '@zhin.js/ai';
import type { ModelRegistry } from '@zhin.js/ai';
import { createSkillSystem, type SkillSystem } from '../skill/skill-system.js';
import type { AgentCore } from '../core/agent-core.js';
import type { ToolSystem } from '../tool/tool-system.js';
import type { ContextSystem } from '../context/context-system.js';
import type { MemorySystem } from '../memory/memory-system.js';
import type { SessionSystem } from '../session/session-system.js';
import type { EventSystem } from '../event/event-system.js';
import type { SkillRegistry } from '../orchestrator/skill-registry.js';
import type { AgentOrchestrator } from '../orchestrator/index.js';
import type { SubagentSystem } from '../subagent/index.js';
import type { SubagentResultSender } from '../subagent/index.js';
import type { ResolvedAgentBinding } from '../config/types.js';
import { bindingToModelConfig } from '../routing/runtime-binding.js';
import type { ZhinAgentConfig, ZhinAgentDependencies } from '../config/index.js';
import type { ZhinAgentEventEmitter } from '../event/event-emitter.js';
import type { TurnContextBridgeState } from '../turn/turn-context-bridge.js';

const logger = new Logger(null, 'ZhinAgent');

export interface ConfigureZhinAgentTarget {
  config: Required<ZhinAgentConfig>;
  skillRegistry: SkillRegistry | null;
  skillSystem: SkillSystem | null;
  orchestrator: AgentOrchestrator | null;
  agentCore: AgentCore | null;
  toolSystem: ToolSystem | null;
  contextSystem: ContextSystem | null;
  memorySystem: MemorySystem | null;
  sessionSystem: SessionSystem | null;
  eventSystem: EventSystem | null;
  imSessionStore: ZhinAgentDependencies['imSessionStore'];
  agentSessionStore: ZhinAgentDependencies['agentSessionStore'];
  contextRepository: ZhinAgentDependencies['contextRepository'];
  imTranscriptStore: ZhinAgentDependencies['imTranscriptStore'];
  modelRegistry: ModelRegistry | null;
  subagentSystem: SubagentSystem | null;
  emitter: ZhinAgentEventEmitter;
  provider: AIProvider;
  providerResolver: ((alias: string) => AIProvider) | null;
  activeBinding: ResolvedAgentBinding | null;
  deferredResultSender: SubagentResultSender | null;
  bootstrapContext: string;
  alwaysSkillsBaseline: string;
  skillsSummaryXML: string;
  turnContextState: TurnContextBridgeState;
  wireLlmApiLayer(): void;
}

export function applyZhinAgentConfigure(
  target: ConfigureZhinAgentTarget,
  deps: Partial<ZhinAgentDependencies>,
): void {
  if (deps.skillRegistry !== undefined) {
    target.skillRegistry = deps.skillRegistry;
    target.skillSystem = deps.skillRegistry ? createSkillSystem(deps.skillRegistry) : null;
    logger.debug(`SkillRegistry connected (${deps.skillRegistry.size} skills)`);
  }
  if (deps.orchestrator !== undefined) {
    target.orchestrator = deps.orchestrator;
    logger.debug('AgentOrchestrator connected for MCP and resources');
  }
  if (deps.agentCore !== undefined) target.agentCore = deps.agentCore;
  if (deps.toolSystem !== undefined) target.toolSystem = deps.toolSystem;
  if (deps.contextSystem !== undefined) target.contextSystem = deps.contextSystem;
  if (deps.memorySystem !== undefined) target.memorySystem = deps.memorySystem;
  if (deps.sessionSystem !== undefined) target.sessionSystem = deps.sessionSystem;
  if (deps.eventSystem !== undefined) target.eventSystem = deps.eventSystem;
  if (deps.imSessionStore !== undefined) target.imSessionStore = deps.imSessionStore;
  if (deps.agentSessionStore !== undefined) target.agentSessionStore = deps.agentSessionStore;
  if (deps.contextRepository !== undefined) target.contextRepository = deps.contextRepository;
  if (deps.imTranscriptStore !== undefined) target.imTranscriptStore = deps.imTranscriptStore;
  if (deps.modelRegistry !== undefined) {
    target.modelRegistry = deps.modelRegistry;
    target.subagentSystem?.setModelRegistry(deps.modelRegistry);
  }
  if (deps.hostPlugin !== undefined) target.emitter.setHostPlugin(deps.hostPlugin);
  if (deps.providerResolver !== undefined) {
    target.providerResolver = deps.providerResolver;
    target.wireLlmApiLayer();
  }
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
  if (deps.deferredResultSender !== undefined) target.deferredResultSender = deps.deferredResultSender;
  if (deps.bootstrapContext !== undefined) {
    target.bootstrapContext = deps.bootstrapContext;
    logger.debug(`Bootstrap context set (${deps.bootstrapContext.length} chars)`);
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
): void {
  registerLlmApiFromProviders(
    [sdkEntryFromProvider(provider)],
    (alias) => {
      const p = alias === provider.name ? provider : providerResolver?.(alias);
      return p?.models ?? [];
    },
  );
}
