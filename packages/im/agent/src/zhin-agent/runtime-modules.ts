/**
 * ZhinAgent 理想模块运行时状态 — configure / asPrivate(host) 共用存储。
 */
import type { SkillRegistry } from '../orchestrator/skill-registry.js';
import type { SkillSystem } from '../skill/skill-system.js';
import type { AgentOrchestrator } from '../orchestrator/index.js';
import type { AgentCore } from '../core/agent-core.js';
import type { ToolSystem } from '../tool/tool-system.js';
import { type ContextSystem, createContextSystemForHost } from '../context/context-system.js';
import type { MemorySystem } from '../memory/memory-system.js';
import { type SessionSystem, createSessionSystem } from '../session/session-system.js';
import { type EventSystem, createEventSystem } from '../event/event-system.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
export interface ZhinAgentRuntimeModules {
  skillRegistry: SkillRegistry | null;
  skillSystem: SkillSystem | null;
  orchestrator: AgentOrchestrator | null;
  agentCore: AgentCore | null;
  toolSystem: ToolSystem | null;
  contextSystem: ContextSystem | null;
  memorySystem: MemorySystem | null;
  sessionSystem: SessionSystem | null;
  eventSystem: EventSystem | null;
}

export function createZhinAgentRuntimeModules(host: ZhinAgentPrivate): ZhinAgentRuntimeModules {
  return {
    skillRegistry: null,
    skillSystem: null,
    orchestrator: null,
    agentCore: null,
    toolSystem: null,
    memorySystem: null,
    contextSystem: createContextSystemForHost(host),
    sessionSystem: createSessionSystem(),
    eventSystem: createEventSystem(),
  };
}

export function clearZhinAgentRuntimeModules(modules: ZhinAgentRuntimeModules): void {
  modules.skillRegistry = null;
  modules.skillSystem = null;
  modules.orchestrator = null;
  modules.agentCore = null;
  modules.toolSystem = null;
  modules.contextSystem = null;
  modules.memorySystem = null;
  modules.sessionSystem = null;
  modules.eventSystem = null;
}
