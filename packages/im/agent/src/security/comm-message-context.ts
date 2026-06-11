/**
 * 在 @zhin.js/ai Agent 执行工具期间挂载当前 Message 通讯上下文，
 * 供 {@link checkExecPolicy} 等无法从 `tool.execute(args)` 拿到上下文的模块读取（如 icqq bash 放行规则）。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Message } from '@zhin.js/core';

export interface CommMessageExecutionScope {
  commMessage?: Message;
  /**
   * Worker / 异步子 Agent 的执行上下文标记。
   * 该标记本身不再决定审批行为；审批由各路径的 execApprovalMode 控制。
   */
  directExecution?: boolean;
}

const als = new AsyncLocalStorage<CommMessageExecutionScope | undefined>();

export function getCurrentCommMessage(): Message | undefined {
  return als.getStore()?.commMessage;
}

export function isDirectAgentExecution(): boolean {
  return als.getStore()?.directExecution === true;
}

export interface RunWithCommMessageOptions {
  directExecution?: boolean;
}

export function runWithCommMessage<T>(
  commMessage: Message | undefined,
  fn: () => T,
  options?: RunWithCommMessageOptions,
): T;
export function runWithCommMessage<T>(
  commMessage: Message | undefined,
  fn: () => Promise<T>,
  options?: RunWithCommMessageOptions,
): Promise<T>;
export function runWithCommMessage<T>(
  commMessage: Message | undefined,
  fn: () => T | Promise<T>,
  options?: RunWithCommMessageOptions,
): T | Promise<T> {
  return als.run({ commMessage, directExecution: options?.directExecution }, fn);
}

/** 子 Agent / Deferred Worker：在独立执行上下文中运行 bash（审批策略由 execApprovalMode 决定） */
export function runWithDirectAgentExecution<T>(commMessage: Message | undefined, fn: () => T): T;
export function runWithDirectAgentExecution<T>(commMessage: Message | undefined, fn: () => Promise<T>): Promise<T>;
export function runWithDirectAgentExecution<T>(
  commMessage: Message | undefined,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return runWithCommMessage(commMessage, fn, { directExecution: true });
}
