/**
 * Orchestrator Types — 五类资源的类型定义
 */

import type { AgentTool, JsonSchema } from '@zhin.js/ai';

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

import type { SenderRole, ToolContext } from '@zhin.js/core';
export type { SenderRole, ToolContext };

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
 * Richer than AgentTool — includes platform/scope/permission constraints.
 */
export interface Tool<TArgs extends Record<string, any> = Record<string, any>> {
  name: string;
  description: string;
  parameters: ToolParametersSchema;
  execute: (args: TArgs, context?: ToolContext) => unknown | Promise<unknown>;
  platforms?: string[];
  scopes?: ToolScope[];
  requiredAnyRole?: readonly import('@zhin.js/core').SenderRole[];
  permissions?: string[];
  tags?: string[];
  keywords?: string[];
  hidden?: boolean;
  source?: string;
  preExecutable?: boolean;
  kind?: string;
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

/** IM-aware tool execution context（与 @zhin.js/core ToolContext 一致） */
export type IMToolContext = ToolContext;

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

export type AIHookEventType = 'message' | 'session' | 'agent' | 'tool';

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
