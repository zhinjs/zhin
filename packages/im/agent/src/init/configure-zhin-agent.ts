import { getLogger } from '@zhin.js/logger';
import { createSkillSystem, SkillSystem } from '../skill/skill-system.js';
import type { AgentCore } from '../core/agent-core.js';
import type { ToolSystem } from '../tool/tool-system.js';
import type { ContextSystem } from '../context/context-system.js';
import type { MemorySystem } from '../memory/memory-system.js';
import type { SessionSystem } from '../session/session-system.js';
import type { EventSystem } from '../event/event-system.js';
import type { SkillRegistry } from '../resource-hub/skill-registry.js';
import type { ZhinAgentDependencies } from '../config/index.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import type { TurnContextBridgeState } from '../turn/turn-context-bridge.js';
const logger = getLogger('ZhinAgent');

/** configure 的写入目标：权威接口（ZhinAgentPrivate）Pick + 门面内部装配字段。 */
export type ConfigureZhinAgentTarget = Pick<
  ZhinAgentPrivate,
  | 'config' | 'skillRegistry' | 'skillSystem' | 'resourceHub' | 'agentCore' | 'toolSystem'
  | 'contextSystem' | 'sessionSystem'
  | 'agentSessionStore' | 'contextRepository' | 'semanticMemory'
  | 'activeBinding'
  | 'audioTranscriber'
  | 'mediaPerception'
  | 'imageAssets'
  | 'localAssets'
  | 'bootstrapContext' | 'globalContext' | 'skillsSummaryXML' | 'deferred'
> & {
  /** 接口外的运行时模块（declare 在类上，不经 ZhinAgentPrivate 暴露） */
  memorySystem: MemorySystem | null;
  eventSystem: EventSystem | null;
  alwaysSkillsBaseline: string;
  turnContextState: TurnContextBridgeState;
};

export function applyZhinAgentConfigure(
  target: ConfigureZhinAgentTarget,
  deps: Partial<ZhinAgentDependencies>,
): void {
  if ('providerResolver' in deps || 'llmRuntime' in deps) {
    throw new Error('Provider injection was replaced by operation-bound inference');
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
  if (deps.semanticMemory !== undefined) target.semanticMemory = deps.semanticMemory;
  if (deps.audioTranscriber !== undefined) target.audioTranscriber = deps.audioTranscriber;
  if (deps.mediaPerception !== undefined) target.mediaPerception = deps.mediaPerception;
  if (deps.imageAssets !== undefined) target.imageAssets = deps.imageAssets;
  if (deps.localAssets !== undefined) target.localAssets = deps.localAssets;
  if (deps.activeBinding !== undefined) {
    target.activeBinding = deps.activeBinding;
  }
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
