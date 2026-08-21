import { createToken } from '@zhin.js/plugin-runtime';
import type { AssistantRuntimeHandle } from '../assistant/runtime-contract.js';
import type { OrchestrationRuntimeHandle } from '../orchestration-runtime.js';
import type { SessionTreeRuntimeHandle } from '../session-tree-runtime.js';
import type { ResolvedAgentBinding } from '../config/types.js';
import type { TurnOutcome, TurnRequest } from '../turn/turn-ingress.js';

/**
 * Stable Host boundary for protocols that expose Agent capabilities externally.
 * Consumers must not reach into CLI installer state or the legacy Plugin graph.
 */
export interface AgentHostPort {
  readonly protocol: AgentHostProtocolPort;
  readonly introspection: AgentHostIntrospectionPort;
  readonly console: AgentHostConsolePort;
}

/**
 * Canonical protocol seam. A2A/HTTP adapters may enumerate configured
 * bindings and submit a TurnRequest, but concrete AIService/ZhinAgent objects
 * never escape the Agent Host.
 */
export interface AgentHostProtocolPort {
  listBindings(): readonly ResolvedAgentBinding[];
  execute(bindingName: string, request: TurnRequest): Promise<TurnOutcome>;
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
  'Canonical Agent protocol and operational projections owned by the Root generation',
);
