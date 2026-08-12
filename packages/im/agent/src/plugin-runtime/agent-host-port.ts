import { createToken } from '@zhin.js/plugin-runtime';
import type { AssistantRuntimeHandle } from '../assistant/runtime-registry.js';
import type { OrchestrationRuntimeHandle } from '../orchestration-runtime-registry.js';
import type { SessionTreeRuntimeHandle } from '../session-tree-runtime-registry.js';

/**
 * Stable Host boundary for protocols that expose Agent capabilities externally.
 * Consumers must not reach into CLI installer state or the legacy Plugin graph.
 */
export interface AgentHostPort {
  /** Concrete Agent classes stay private to the composing package. */
  readonly service: unknown;
  readonly agent: unknown;
  readonly introspection: AgentHostIntrospectionPort;
  readonly console: AgentHostConsolePort;
}

export interface AgentHostToolSummary {
  readonly name: string;
  readonly description?: string;
  readonly hidden?: boolean;
}

export interface AgentHostMcpSummary {
  readonly name: string;
  readonly connected: boolean;
  readonly toolCount: number;
}

/** Read-only projection for Console; no concrete ZhinAgent may escape through it. */
export interface AgentHostIntrospectionPort {
  listTools(): readonly AgentHostToolSummary[];
  listMcpServers(): readonly AgentHostMcpSummary[];
}

export interface AgentHostConsolePort {
  readonly sessionTree: SessionTreeRuntimeHandle;
  readonly orchestration: OrchestrationRuntimeHandle;
  readonly assistant: AssistantRuntimeHandle | null;
}

export const agentHostToken = createToken<AgentHostPort>(
  'zhin.host.agent',
  'Active AIService and ZhinAgent owned by the Root generation',
);
