import type { ConsoleRpcExtendedCtx, ExtendedRpcResult } from './contracts.js';
import { strField } from './rpc-values.js';

export function listLoginPending(ctx: ConsoleRpcExtendedCtx): ExtendedRpcResult {
  const assist = ctx.loginAssist;
  if (!assist) return { error: '登录辅助未接线（LoginAssist 未挂载）' };
  const tasks = assist.listPending().map((task) => ({
    id: task.id,
    adapter: task.adapter,
    endpointKey: task.endpointKey,
    type: task.type,
    payload: task.payload,
    createdAt: task.createdAt,
    expiresAt: task.expiresAt,
  }));
  return { data: { tasks, count: tasks.length } };
}

export function submitLogin(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): ExtendedRpcResult {
  const assist = ctx.loginAssist;
  if (!assist) return { error: '登录辅助未接线（LoginAssist 未挂载）' };
  const id = strField(d, 'taskId');
  if (!id) return { error: 'taskId is required' };
  const raw = d.value ?? '';
  const value = typeof raw === 'string' || (raw && typeof raw === 'object')
    ? raw as string | Record<string, unknown>
    : String(raw ?? '');
  const ok = assist.submit(id, value);
  if (!ok) return { error: `login task not found: ${id}` };
  return { data: { success: true } };
}

export function cancelLogin(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): ExtendedRpcResult {
  const assist = ctx.loginAssist;
  if (!assist) return { error: '登录辅助未接线（LoginAssist 未挂载）' };
  const id = strField(d, 'taskId');
  if (!id) return { error: 'taskId is required' };
  const reason = strField(d, 'reason') || 'cancelled';
  const ok = assist.cancel(id, reason);
  if (!ok) return { error: `login task not found: ${id}` };
  return { data: { success: true } };
}

// ---------------------------------------------------------------- 社交读取
