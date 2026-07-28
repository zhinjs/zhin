/**
 * Tool System — 模块契约（与实现同步）。
 *
 * 实现：`ToolSystem.collectForTurn` 同步收集 `AgentTool[]`（`ToolSource.collectTools` 亦为同步）；
 * 每 turn 通过 `createDefaultToolSources` 独立 Source 列表，避免并发 mutate。
 */

import type { AgentTool } from '@zhin.js/ai';
import type { Message } from '@zhin.js/core';
import type { ToolScope } from '../orchestrator/types.js';

/**
 * Tool registered on `ZhinAgent.registerTool` (runtime agent tool directory).
 * Extends the IM-agnostic {@link AgentTool} with the same per-message access
 * vocabulary as `@zhin.js/tool` ToolIndex descriptors
 * (platforms / scopes / permissions / hidden). `RegisteredToolSource`
 * enforces it via Core `canAccessTool`, so both registration paths share
 * one access predicate (see docs/advanced/agent-authoring.md).
 */
export interface RegisteredAgentTool extends AgentTool {
  platforms?: string[];
  scopes?: ToolScope[];
  hidden?: boolean;
}

export interface TurnContext {
  message: Message;
}

export interface FilterContext {
  message: Message;
}

export interface ToolSource {
  name: string;
  priority: number;
  collectTools(context: TurnContext): AgentTool[];
}

export interface ToolFilter {
  name: string;
  filter(tools: AgentTool[], context: FilterContext): AgentTool[];
}

export interface ToolSystemConfig {
  /** 预留扩展面 */
}
