/**
 * 组合层 — 对齐理想蓝图模块装配（单包 import，阶段 3）。
 */
import { AgentCore } from '../core/agent-core.js';
import { DEFAULT_AGENT_CORE_CONFIG, createAgentCoreDepsForCompose } from '../core/compose-deps.js';
import { createToolSystem, type ToolSystem } from '../tool/tool-system.js';
import { createSessionSystem, type SessionSystem } from '../session/session-system.js';
import { createEventSystem, type EventSystem } from '../event/event-system.js';
import { defaultSkillSystem } from '../skill/skill-system.js';
import { createMemorySystemForHost, type MemorySystem } from '../memory/memory-system.js';
import { createContextSystemForHost, type ContextSystem } from '../context/context-system.js';
import type { ZhinAgent } from '../zhin-agent/index.js';
import { asPrivate } from '../internal/as-private.js';

export interface ComposedZhinAgentRuntime {
  agent: ZhinAgent;
  /** Internal Host contract consumed by the composition root. */
  host: import('../internal/agent-host.js').ZhinAgentPrivate;
  agentCore: AgentCore;
  toolSystem: ToolSystem;
  sessionSystem: SessionSystem;
  eventSystem: EventSystem;
  skillSystem: typeof defaultSkillSystem;
  memorySystem: MemorySystem;
  contextSystem: ContextSystem;
}

export function composeZhinAgentRuntime(input: Readonly<{ agent: ZhinAgent }>): ComposedZhinAgentRuntime {
  const { agent } = input;
  const priv = asPrivate(agent);
  const eventSystem = createEventSystem();
  const toolSystem = createToolSystem();
  const sessionSystem = createSessionSystem();
  const skillSystem = defaultSkillSystem;
  const memorySystem = createMemorySystemForHost(priv);
  const contextSystem = createContextSystemForHost(priv);

  const agentCore = new AgentCore(
    DEFAULT_AGENT_CORE_CONFIG,
    createAgentCoreDepsForCompose(eventSystem),
  );

  return {
    agent,
    host: priv,
    agentCore,
    toolSystem,
    sessionSystem,
    eventSystem,
    skillSystem,
    memorySystem,
    contextSystem,
  };
}
