/**
 * Tool System — 模块契约（与实现同步）。
 *
 * 实现：`ToolSystem.collectForTurn` 同步收集 `AgentTool[]`（`ToolSource.collectTools` 亦为同步）；
 * 每 turn 通过 `createDefaultToolSources` 独立 Source 列表，避免并发 mutate。
 */

import type { AgentTool } from '@zhin.js/ai';
import type { Message } from '@zhin.js/core';

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
