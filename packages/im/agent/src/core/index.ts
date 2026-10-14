/**
 * Agent Core — agentLoop 薄适配器（ADR 0009）；契约见 contracts.ts。
 */

export type {
  AgentCoreConfig,
  AgentCoreDependencies,
  AgentLoopInput,
  AgentContext,
  ToolCall,
  ToolResult,
  ToolExecutor,
  ContextManager,
  AgentEventBus,
  AgentCoreEvent,
} from './contracts.js';

export { AgentCore, defaultAgentCore } from './agent-core.js';

export type {
  AgentLoopTurnInput,
  AgentLoopTurnResult,
  AgentLoopVisionTurnInput,
  AgentLoopVisionTurnResult,
} from './agent-loop-turn.js';

export {
  runAgentLoopTextTurn,
  runAgentLoopVisionTurn,
} from './agent-loop-turn.js';

export type { ToolCallRecord } from './tool-calls-user-format.js';
export { formatToolCallsForUser, looksLikeInternalToolDump } from './tool-calls-user-format.js';
export {
  sanitizeAssistantReply,
  stripThinkBlocks,
  stripHallucinatedToolCalls,
  looksLikeRawToolMarkup,
  unwrapJsonStringLayers,
} from './text-sanitize.js';

export {
  runAgentLoopStandaloneTurn,
} from './agent-loop-standalone.js';
export type {
  AgentLoopStandaloneCallbacks,
  AgentLoopStandaloneInput,
  AgentLoopStandaloneResult,
} from './agent-loop-standalone.js';

// Host-integration seam for external host packages.
export { collectAgentLoopTurnRun } from './agent-core-run.js';
/** @internal Host-integration only (used by @zhin.js/workroom); not a stable API. */
export type { ZhinAgentPrivate } from '../internal/agent-host.js';
