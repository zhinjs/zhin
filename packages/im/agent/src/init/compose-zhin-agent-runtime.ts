/**
 * 组合层 — 对齐理想蓝图模块装配（单包 import，阶段 3）。
 */
import type { AIProvider } from '@zhin.js/ai';
import { AgentCore } from '../core/agent-core.js';
import { DEFAULT_AGENT_CORE_CONFIG, createAgentCoreDepsForCompose } from '../core/compose-deps.js';
import { createToolSystem } from '../tool/tool-system.js';
import { createSessionSystem } from '../session/session-system.js';
import { createEventSystem } from '../event/event-system.js';
import { defaultSkillSystem } from '../skill/skill-system.js';
import { createMemorySystemForHost } from '../memory/memory-system.js';
import { SubagentSystem } from '../subagent/subagent-system.js';
import { ImResultSink } from '../subagent/im-result-sink.js';
import { createContextSystemForHost } from '../context/context-system.js';
import type { ProactiveOutboundService } from '../outbound/send-proactive.js';
import type { SubagentResultSender } from '../subagent/index.js';
import type { ZhinAgent } from '../zhin-agent/index.js';
import { asPrivate } from '../internal/as-private.js';
import type { ToolSystem } from '../tool/tool-system.js';
import type { MemorySystem } from '../memory/memory-system.js';
import type { ContextSystem } from '../context/context-system.js';
import type { SessionSystem } from '../session/session-system.js';
import type { EventSystem } from '../event/event-system.js';

export interface ComposedZhinAgentRuntime {
  agent: ZhinAgent;
  agentCore: AgentCore;
  toolSystem: ToolSystem;
  sessionSystem: SessionSystem;
  eventSystem: EventSystem;
  skillSystem: typeof defaultSkillSystem;
  memorySystem: MemorySystem;
  subagentSystem: SubagentSystem;
  contextSystem: ContextSystem;
  deliverOutbound: SubagentResultSender;
}

export function composeZhinAgentRuntime(
  agent: ZhinAgent,
  provider: AIProvider,
  proactiveOutbound: ProactiveOutboundService,
): ComposedZhinAgentRuntime {
  const priv = asPrivate(agent);
  const eventSystem = createEventSystem();
  const toolSystem = createToolSystem();
  const sessionSystem = createSessionSystem();
  const skillSystem = defaultSkillSystem;
  const memorySystem = createMemorySystemForHost(priv);
  const contextSystem = createContextSystemForHost(priv);
  const subagentSystem = new SubagentSystem({});
  subagentSystem.addResultSink(new ImResultSink({ proactiveOutbound }));
  const deliverOutbound = subagentSystem.composeSender();
  if (!deliverOutbound) {
    throw new Error('SubagentSystem: ImResultSink failed to compose sender');
  }

  const agentCore = new AgentCore(
    DEFAULT_AGENT_CORE_CONFIG,
    createAgentCoreDepsForCompose(provider, eventSystem),
  );

  return {
    agent,
    agentCore,
    toolSystem,
    sessionSystem,
    eventSystem,
    skillSystem,
    memorySystem,
    subagentSystem,
    contextSystem,
    deliverOutbound,
  };
}
