/**
 * 在 @zhin.js/ai Agent 执行工具期间挂载当前 {@link ToolContext}，
 * 供 {@link checkExecPolicy} 等无法从 `tool.execute(args)` 拿到上下文的模块读取（如 icqq bash 放行规则）。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ToolContext } from '@zhin.js/core';

const als = new AsyncLocalStorage<ToolContext | undefined>();

export function getCurrentBashToolContext(): ToolContext | undefined {
  return als.getStore();
}

export function runWithBashToolContext<T>(ctx: ToolContext | undefined, fn: () => T): T;
export function runWithBashToolContext<T>(ctx: ToolContext | undefined, fn: () => Promise<T>): Promise<T>;
export function runWithBashToolContext<T>(ctx: ToolContext | undefined, fn: () => T | Promise<T>): T | Promise<T> {
  return als.run(ctx, fn);
}
