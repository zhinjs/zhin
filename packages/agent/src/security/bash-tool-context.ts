/**
 * 在 @zhin.js/ai Agent 执行工具期间挂载当前 {@link ToolContext}，
 * 供 {@link checkExecPolicy} 等无法从 `tool.execute(args)` 拿到上下文的模块读取（如 icqq bash 放行规则）。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ToolContext } from '@zhin.js/core';

export interface BashToolExecutionScope {
  toolContext?: ToolContext;
  /**
   * Worker / 异步子 Agent：跳过 execAsk 的 Owner 审批门（仍拒绝危险命令与 deny）。
   * 与 {@link createOwnerOrchestratedToolResultTransform} 的 `disableHardOrchestration` 配合使用。
   */
  directExecution?: boolean;
}

const als = new AsyncLocalStorage<BashToolExecutionScope | undefined>();

export function getCurrentBashToolContext(): ToolContext | undefined {
  return als.getStore()?.toolContext;
}

export function isDirectAgentExecution(): boolean {
  return als.getStore()?.directExecution === true;
}

export interface RunWithBashToolContextOptions {
  directExecution?: boolean;
}

export function runWithBashToolContext<T>(
  ctx: ToolContext | undefined,
  fn: () => T,
  options?: RunWithBashToolContextOptions,
): T;
export function runWithBashToolContext<T>(
  ctx: ToolContext | undefined,
  fn: () => Promise<T>,
  options?: RunWithBashToolContextOptions,
): Promise<T>;
export function runWithBashToolContext<T>(
  ctx: ToolContext | undefined,
  fn: () => T | Promise<T>,
  options?: RunWithBashToolContextOptions,
): T | Promise<T> {
  return als.run({ toolContext: ctx, directExecution: options?.directExecution }, fn);
}

/** 子 Agent / Deferred Worker：免 Owner 在线审批，在策略允许范围内直接执行 bash */
export function runWithDirectAgentExecution<T>(ctx: ToolContext | undefined, fn: () => T): T;
export function runWithDirectAgentExecution<T>(ctx: ToolContext | undefined, fn: () => Promise<T>): Promise<T>;
export function runWithDirectAgentExecution<T>(
  ctx: ToolContext | undefined,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return runWithBashToolContext(ctx, fn, { directExecution: true });
}
