import { createToken } from '@zhin.js/plugin-runtime';
import type { AssistantRuntimeHandle } from '../assistant/runtime-contract.js';
import type { SessionTreeRuntimeHandle } from '../session-tree-runtime.js';
import type { AgentTraceRuntimeHandle } from './agent-trace-runtime.js';
import type { ResolvedAgentBinding } from '../config/types.js';
import type { TurnOutcome, TurnRequest } from '../turn/turn-ingress.js';
import type { ScheduleExecutionHistoryPort } from '../schedule-domain/execution-history-store.js';
import type { McpConnectionFailure } from '../mcp-client/failure.js';
import type { HostMcpProbeResult } from './host-mcp-status.js';

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
  /**
   * Names configured under `ai.agents` (`zhin` included), without names only discovered from
   * `agents/<name>/` files: the binding names the model runtime keeps sub-agents' purpose keys
   * apart from (#1250 batch 21). Management views use it to report what the runtime does.
   */
  listConfiguredBindingNames?(): readonly string[];
  execute(bindingName: string, request: TurnRequest): Promise<TurnOutcome>;
}

export interface AgentHostMcpSummary {
  readonly name: string;
  readonly connected: boolean;
  readonly toolCount: number;
  /** Classified, redacted reason of the last failed connect while not connected (#1250). */
  readonly lastError?: McpConnectionFailure;
}

/** Read-only projection for Console; no concrete ZhinAgent may escape through it. */
export interface AgentHostIntrospectionPort {
  /**
   * Configured servers (`ai.mcpServers`) with the outcome of their generation clients' connect,
   * plus servers in the Agent's own registry. Not connected without `lastError`: not connected yet.
   */
  listMcpServers(): readonly AgentHostMcpSummary[];
  /**
   * Connects once to a configured server with a throw-away client and reports the outcome
   * (#1250 Console "test connection"); `undefined` for a name not in `ai.mcpServers`.
   */
  testMcpServer?(name: string): Promise<HostMcpProbeResult | undefined>;
}

export interface AgentHostConsolePort {
  readonly sessionTree: SessionTreeRuntimeHandle;
  /** Bindings from this exact generation, used for Catalog display and validation. */
  listBindings(): readonly ResolvedAgentBinding[];
  readonly assistant: AssistantRuntimeHandle | null;
  /** Exact generation's durable execution history; independent of the optional assistant feature. */
  readonly scheduleExecutions?: ScheduleExecutionHistoryPort;
  readonly trace: AgentTraceRuntimeHandle;
}

export const agentHostToken = createToken<AgentHostPort>(
  'zhin.host.agent',
  'Canonical Agent protocol and operational projections owned by the Root generation',
);
