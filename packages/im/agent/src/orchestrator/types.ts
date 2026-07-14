/**
 * Orchestrator Types — 五类资源的类型定义
 */

import type { AgentTool, JsonSchema } from '@zhin.js/ai';
import type { ToolApprovalPolicy, ToolToModelOutputFn } from '@zhin.js/ai/tool-policy';

// ============================================================================
// Common
// ============================================================================

export interface ResourceScope {
  agentId?: string;
}

export interface ResourceEntry<T> {
  resource: T;
  scope: ResourceScope;
  source: string;
}

// ============================================================================
// Skill
// ============================================================================

import type { SenderRole, Message } from '@zhin.js/core';
export type { SenderRole, Message };

/**
 * 文件操作角色 — 在 IM 场景中对文件操作的权限分级
 * @see {@link FileRole} in @zhin.js/core for full documentation
 */
export type FileRole = 'owner' | 'admin' | 'user';
export type ToolScope = 'private' | 'group' | 'channel';

export interface ToolParametersSchema extends JsonSchema {
  type: 'object';
  properties?: Record<string, PropertySchema>;
  required?: string[];
}

export interface PropertySchema {
  type: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  items?: PropertySchema;
  contextKey?: string;
  [key: string]: unknown;
}

/**
 * IM-facing tool definition.
 * Mirrors @zhin.js/core Tool but with orchestrator-specific ToolParametersSchema.
 * @see {@link import('@zhin.js/core').Tool} for the canonical definition
 */
export interface Tool<TArgs extends Record<string, any> = Record<string, any>> {
  name: string;
  description: string;
  parameters: ToolParametersSchema;
  execute: (args: TArgs, message?: Message) => unknown | Promise<unknown>;
  platforms?: string[];
  scopes?: ToolScope[];
  permissions?: string[];
  tags?: string[];
  keywords?: string[];
  hidden?: boolean;
  source?: string;
  preExecutable?: boolean;
  kind?: string;
  /** Per-tool approval (ADR 0039 P1); stacks with ExecPolicy. */
  approval?: ToolApprovalPolicy;
  /** Model-facing output shaping (ADR 0039 P1). */
  toModelOutput?: ToolToModelOutputFn<TArgs>;
}

export namespace Tool {
  export interface ParamInfo {
    name: string;
    type: string;
    required: boolean;
    description?: string;
    default?: unknown;
    enum?: unknown[];
  }
}

export interface ToolJsonSchema extends JsonSchema {
  type: 'object';
  properties?: Record<string, PropertySchema>;
  required?: string[];
}

export interface Skill {
  name: string;
  description: string;
  tools: Tool[];
  platforms?: string[];
  keywords?: string[];
  tags?: string[];
  pluginName: string;
  filePath?: string;
  always?: boolean;
}

export interface SkillMetadata {
  description: string;
  keywords?: string[];
  tags?: string[];
}

// ============================================================================
// SubAgent
// ============================================================================

export interface SubAgentDef {
  name: string;
  description: string;
  systemPrompt?: string;
  allowedTools?: string[];
  model?: string;
  maxIterations?: number;
}

export interface AgentPreset {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: string[];
  model?: string;
  filePath?: string;
  pluginName?: string;
}

// ============================================================================
// MCP
// ============================================================================

export interface McpServerEntry {
  name: string;
  transport: 'stdio' | 'streamable-http' | 'sse';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

// ============================================================================
// Hook
// ============================================================================

export type AIHookEventType =
  | 'message'
  | 'session'
  | 'agent'
  | 'tool'
  | 'turn'
  | 'actions'
  | 'action'
  | 'reasoning'
  | 'subagent';

export interface AIHookEvent {
  type: AIHookEventType;
  action: string;
  sessionId?: string;
  context: Record<string, unknown>;
  timestamp: Date;
  messages: string[];
}

export type AIHookHandler = (event: AIHookEvent) => Promise<void> | void;

export interface AIHook {
  name: string;
  event: string;
  handler: AIHookHandler;
}

// ============================================================================
// Tool Hook (PreToolUse / PostToolUse interception)
// ============================================================================

export type ToolHookDecision =
  | { decision: 'allow' }
  | { decision: 'deny'; reason: string }
  | { decision: 'modify'; modifiedInput: Record<string, unknown> }
  | { decision: 'skip' };

export type PostToolHookDecision =
  | { decision: 'accept' }
  | { decision: 'reject'; reason: string }
  | { decision: 'modify'; modifiedOutput: unknown };

export interface PreToolUseEvent {
  type: 'preToolUse';
  toolName: string;
  toolInput: Record<string, unknown>;
  toolSource?: string;
  sessionId: string;
  commMessage?: Message;
}

export interface PostToolUseEvent {
  type: 'postToolUse';
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput: unknown;
  durationMs: number;
  sessionId: string;
  commMessage?: Message;
}

export type PreToolUseHandler = (event: PreToolUseEvent) => Promise<ToolHookDecision> | ToolHookDecision;
export type PostToolUseHandler = (event: PostToolUseEvent) => Promise<PostToolHookDecision> | PostToolHookDecision;

export interface ToolHook {
  name: string;
  /** Higher priority hooks run first. Default: 0. Security hooks use 1000+. */
  priority: number;
}

export interface PreToolUseHook extends ToolHook {
  type: 'preToolUse';
  handler: PreToolUseHandler;
}

export interface PostToolUseHook extends ToolHook {
  type: 'postToolUse';
  handler: PostToolUseHandler;
}
