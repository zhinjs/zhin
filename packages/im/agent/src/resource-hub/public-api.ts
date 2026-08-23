/**
 * Plugin-facing Agent capability registry exposed from `zhin.js/agent`.
 * @module zhin.js/agent
 */
export { AgentResourceHub } from './index.js';
export type {
  AgentTool,
  AgentToolExecutionContext,
  JsonSchema,
  ToolApprovalMode,
  ToolApprovalPolicy,
  ToolToModelOutputFn,
  ToolToModelOutputInput,
} from '@zhin.js/ai';
export type { McpConnection } from './mcp-registry.js';
export type { ToolLike } from './tool-registry.js';
export type {
  AgentPreset,
  AIHook,
  AIHookEvent,
  AIHookEventType,
  AIHookHandler,
  Message,
  McpServerEntry,
  McpPrompt,
  McpResource,
  ResourceScope,
  Skill,
  SubAgentDef,
  Tool,
  ToolParametersSchema,
  ToolScope,
  PropertySchema,
} from './types.js';
