import type { ConsoleRpcExtendedCtx, ExtendedRpcResult } from './contracts.js';
import { strField } from './rpc-values.js';

export function listLoginPending(ctx: ConsoleRpcExtendedCtx): ExtendedRpcResult {
  const assist = ctx.loginAssist;
  if (!assist) return { error: '登录辅助未接线（LoginAssist 未挂载）' };
  const tasks = assist.listPending().map((task) => ({
    id: task.id,
    adapter: task.adapter,
    endpointKey: task.endpointKey,
    ...(task.endpointIdentity ? { endpointIdentity: task.endpointIdentity } : {}),
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
  const identity = readEndpointIdentity(d.endpointIdentity);
  if (identity === false) return { error: 'Invalid login Endpoint identity' };
  const ok = identity ? assist.submit(id, value, identity) : assist.submit(id, value);
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
  const identity = readEndpointIdentity(d.endpointIdentity);
  if (identity === false) return { error: 'Invalid login Endpoint identity' };
  const ok = identity ? assist.cancel(id, reason, identity) : assist.cancel(id, reason);
  if (!ok) return { error: `login task not found: ${id}` };
  return { data: { success: true } };
}

// ---------------------------------------------------------------- 社交读取

function readEndpointIdentity(value: unknown): { readonly canonicalId: string; readonly instanceId: string; readonly epoch: number; readonly incarnationId: string } | false | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const identity = value as Record<string, unknown>;
  if (Object.keys(identity).length !== 4 || typeof identity.canonicalId !== 'string' || !identity.canonicalId
    || typeof identity.instanceId !== 'string' || !identity.instanceId || typeof identity.incarnationId !== 'string' || !identity.incarnationId || !Number.isSafeInteger(identity.epoch) || Number(identity.epoch) < 1) return false;
  return { canonicalId: identity.canonicalId, instanceId: identity.instanceId, epoch: Number(identity.epoch), incarnationId: identity.incarnationId };
}
