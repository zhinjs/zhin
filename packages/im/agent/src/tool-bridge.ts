/**
 * Tool schema bridge — canonical conversion paths (ADR 0009 / 0019).
 *
 * Authoring SSOT: `@zhin.js/core` Tool (+ Zod/JSON schema)
 *   → pluginToolToAgentTool (agent runtime)
 *   → agentToolToLlmTool (@zhin.js/ai transport)
 */
export {
  agentToolToLlmTool,
  agentToolsToLlmTools,
} from '@zhin.js/ai';

export {
  normalizeTool as pluginToolToAgentTool,
} from './orchestrator/tool-selection.js';

export type { NormalizableTool } from './orchestrator/tool-selection.js';
