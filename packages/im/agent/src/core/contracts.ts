/**
 * Agent Core — 模块契约（与实现同步，ADR 0009）。
 *
 * 实现：`AgentCore.runText()` / `runVision()` 为 `AsyncGenerator<TurnEvent>` SSOT；
 * `runTextTurn` / `runVisionTurn` 为 collector 薄包装。
 * 委托 `agent-core-run` → `@zhin.js/ai` `agentLoop`。
 * `ToolExecutor` / `ContextManager` 供 `composeZhinAgentRuntime` 占位注入；
 * 生产 IM turn 经 `ZhinAgentPrivate` host 走完整工具与会话链。
 */

import type { AgentEvent } from '@zhin.js/ai';

export interface AgentCoreConfig {
  maxIterations: number;
  timeout: number;
  toolExecution: 'parallel' | 'sequential' | 'tiered';
}

export interface ToolExecutor {
  executeAll(toolCalls: ToolCall[]): Promise<ToolResult[]>;
}

export interface ContextManager {
  prepare(input: AgentLoopInput): Promise<AgentContext>;
  append(results: ToolResult[]): Promise<void>;
}

/** EventSystem 或 no-op；`AgentCore` 在 turn 起止发出 `agent.turn.*` */
export interface AgentEventBus {
  emit(eventType: string, payload: unknown): Promise<void>;
}

export interface AgentCoreDependencies {
  provider: import('@zhin.js/ai').AIProvider;
  toolExecutor: ToolExecutor;
  contextManager: ContextManager;
  eventBus: AgentEventBus;
}

export interface AgentLoopInput {
  messages: import('@zhin.js/ai').AgentMessage[];
  sessionKey?: string;
}

export interface AgentContext {
  messages: import('@zhin.js/ai').AgentMessage[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ToolResult {
  toolCallId: string;
  result: unknown;
}

export type AgentCoreEvent = AgentEvent;
