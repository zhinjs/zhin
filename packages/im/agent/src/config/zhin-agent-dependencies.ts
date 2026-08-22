import type {
  AIProvider,
  AgentSessionStore,
  ContextRepository,
  IMSessionStore,
  MemoryAgentSessionStore,
  MemoryIMSessionStore,
  ModelRegistry,
} from '@zhin.js/ai';
import type { Plugin } from '@zhin.js/core';
import type { AgentCore } from '../core/agent-core.js';
import type { ToolSystem } from '../tool/tool-system.js';
import type { ContextSystem } from '../context/context-system.js';
import type { MemorySystem } from '../memory/memory-system.js';
import type { SessionSystem } from '../session/session-system.js';
import type { EventSystem } from '../event/event-system.js';
import type { AgentResourceHub } from '../resource-hub/index.js';
import type { SkillRegistry } from '../resource-hub/skill-registry.js';
import type { SubagentResultSender } from '../subagent/index.js';
import type { ResolvedAgentBinding } from './types.js';

/** ZhinAgent 运行依赖（通过 configure() 注入） */
export interface ZhinAgentDependencies {
  skillRegistry: SkillRegistry;
  resourceHub: AgentResourceHub;
  agentCore?: AgentCore;
  toolSystem?: ToolSystem;
  contextSystem?: ContextSystem;
  memorySystem?: MemorySystem;
  sessionSystem?: SessionSystem;
  eventSystem?: EventSystem;
  imSessionStore: IMSessionStore | MemoryIMSessionStore;
  agentSessionStore: AgentSessionStore | MemoryAgentSessionStore;
  contextRepository: ContextRepository;
  modelRegistry: ModelRegistry;
  hostPlugin: Plugin;
  providerResolver: (alias: string) => AIProvider;
  activeBinding: ResolvedAgentBinding;
  subagentSender: SubagentResultSender;
  deferredResultSender: SubagentResultSender;
  bootstrapContext: string;
  globalContext: string;
  activeSkillsContext: string;
  skillsSummaryXML: string;
}
