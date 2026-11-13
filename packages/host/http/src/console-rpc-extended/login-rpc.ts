import { CONSOLE_LOGIN_UNSUPPORTED, LOGIN_RPC } from '@zhin.js/console-protocol';
import type { ConsoleEndpointLoginAccess, ConsoleRpcExtendedCtx, ExtendedRpcResult } from './contracts.js';
import { strField } from './rpc-values.js';

const NOT_WIRED = '登录辅助未接线（LoginAssist 未挂载）';
/** `login.submit` with `wait: true` waits at most this long for the login result. */
export const LOGIN_SUBMIT_WAIT_MS = 15_000;

export function listLoginPending(ctx: ConsoleRpcExtendedCtx): ExtendedRpcResult {
  const assist = ctx.loginAssist;
  if (!assist) return { error: NOT_WIRED };
  const tasks = assist.listPending().map((task) => ({
    id: task.id,
    adapter: task.adapter,
    endpointKey: task.endpointKey,
    ...(task.endpointIdentity ? { endpointIdentity: task.endpointIdentity } : {}),
    type: task.type,
    payload: task.payload,
    createdAt: task.createdAt,
    expiresAt: task.expiresAt,
    ...(task.flowId ? { flowId: task.flowId } : {}),
    ...(task.challengeId ? { challengeId: task.challengeId } : {}),
  }));
  return { data: { tasks, count: tasks.length } };
}

/**
 * `login.submit { taskId, value, endpointIdentity?, adapter?, endpointKey?, wait? }`.
 * `value` is a string (legacy) or `{ action, values }`. With `wait: true` the reply carries the login
 * result (`{ accepted, outcome, flow }`) or `{ accepted, pending: true }` after 15 s; without it the
 * legacy `{ success: true }` reply is unchanged.
 */
export async function submitLogin(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const assist = ctx.loginAssist;
  if (!assist) return { error: NOT_WIRED };
  const id = strField(d, 'taskId');
  if (!id) return { error: 'taskId is required' };
  const value = readSubmitValue(d.value);
  if (value === false) return { error: 'value must be a string or { action, values }' };
  const identity = readEndpointIdentity(d.endpointIdentity);
  if (identity === false) return { error: 'Invalid login Endpoint identity' };
  const target = checkTaskTarget(d, ctx, id);
  if (target) return target;
  try {
    if (d.wait === true && assist.submitAndWait) {
      const result = await assist.submitAndWait(id, value, {
        ...(identity ? { endpointIdentity: identity } : {}),
        timeoutMs: LOGIN_SUBMIT_WAIT_MS,
      });
      if (!result.accepted) return { error: `login task not found: ${id}` };
      if (result.outcome) return { data: { accepted: true, outcome: result.outcome, ...(result.flow ? { flow: result.flow } : {}) } };
      return { data: { accepted: true, pending: true, ...(result.flow ? { flow: result.flow } : {}) } };
    }
    const ok = identity ? assist.submit(id, value, identity) : assist.submit(id, value);
    if (!ok) return { error: `login task not found: ${id}` };
    return { data: { success: true } };
  } catch (error) {
    // LoginSubmissionError: the challenge stays open; its message never contains the value.
    if (error instanceof Error && error.name === 'LoginSubmissionError') {
      return { error: error.message, data: { code: (error as Error & { code?: string }).code ?? 'input_invalid' } };
    }
    throw error;
  }
}

export function cancelLogin(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): ExtendedRpcResult {
  const assist = ctx.loginAssist;
  if (!assist) return { error: NOT_WIRED };
  const id = strField(d, 'taskId');
  if (!id) return { error: 'taskId is required' };
  const reason = strField(d, 'reason') || 'cancelled';
  const identity = readEndpointIdentity(d.endpointIdentity);
  if (identity === false) return { error: 'Invalid login Endpoint identity' };
  const target = checkTaskTarget(d, ctx, id);
  if (target) return target;
  const ok = identity ? assist.cancel(id, reason, identity) : assist.cancel(id, reason);
  if (!ok) return { error: `login task not found: ${id}` };
  return { data: { success: true } };
}

/** `login.flow.list { adapter?, endpointKey? }`: latest flow per Endpoint, with live challenge material. */
export function listLoginFlows(d: Record<string, unknown>, ctx: ConsoleRpcExtendedCtx): ExtendedRpcResult {
  const assist = ctx.loginAssist;
  if (!assist) return { error: NOT_WIRED };
  if (!assist.listFlows) return unsupported('login flows');
  const adapter = strField(d, 'adapter');
  const endpointKey = strField(d, 'endpointKey');
  const flows = assist.listFlows().filter((flow) => (!adapter || flow.adapter === adapter)
    && (!endpointKey || flow.endpointKey === endpointKey));
  return { data: { flows, count: flows.length } };
}

/** `login.flow.get { flowId } | { adapter, endpointKey }` → `{ flow: … | null }`. */
export function getLoginFlow(d: Record<string, unknown>, ctx: ConsoleRpcExtendedCtx): ExtendedRpcResult {
  const assist = ctx.loginAssist;
  if (!assist) return { error: NOT_WIRED };
  if (!assist.getFlow || !assist.getFlowById) return unsupported('login flows');
  const flowId = strField(d, 'flowId');
  const adapter = strField(d, 'adapter');
  const endpointKey = strField(d, 'endpointKey');
  if (flowId) {
    const flow = assist.getFlowById(flowId);
    // A flow id names one Endpoint; a scoped caller cannot read another Endpoint's flow by id.
    if (flow && ((adapter && flow.adapter !== adapter) || (endpointKey && flow.endpointKey !== endpointKey))) {
      return { data: { flow: null } };
    }
    return { data: { flow: flow ?? null } };
  }
  if (!adapter || !endpointKey) return { error: 'flowId or adapter and endpointKey are required' };
  return { data: { flow: assist.getFlow(adapter, endpointKey) ?? null } };
}

/** `login.relogin` / `login.refresh { adapter, endpointKey }` through the Endpoint's login port. */
export async function controlLogin(
  type: typeof LOGIN_RPC.RELOGIN | typeof LOGIN_RPC.REFRESH,
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const adapter = strField(d, 'adapter');
  const endpointKey = strField(d, 'endpointKey');
  if (!adapter || !endpointKey) return { error: 'adapter and endpointKey are required' };
  const relogin = type === LOGIN_RPC.RELOGIN;
  const label = relogin ? 'relogin' : 'refresh challenge';
  if (!ctx.withEndpointLogin) return unsupported(label);
  const result = await ctx.withEndpointLogin(adapter, endpointKey, async (login: ConsoleEndpointLoginAccess) => {
    const declared = relogin ? login.declaration?.relogin === true : login.declaration?.refreshQr === true;
    const run = relogin ? login.control?.relogin : login.control?.refreshChallenge;
    if (!declared || !run) return unsupported(label, adapter);
    await run.call(login.control, {});
    return { data: { accepted: true } } satisfies ExtendedRpcResult;
  });
  return result ?? { error: `Endpoint not found: ${adapter}/${endpointKey}` };
}

/**
 * Audit detail of a login RPC reply: the result category only (never values, never messages).
 * `undefined` for other RPCs.
 */
export function loginAuditDetail(type: unknown, data: unknown): Readonly<Record<string, string>> | undefined {
  if (type !== LOGIN_RPC.SUBMIT && type !== LOGIN_RPC.CANCEL && type !== LOGIN_RPC.RELOGIN && type !== LOGIN_RPC.REFRESH) return undefined;
  if (!data || typeof data !== 'object') return undefined;
  const record = data as { outcome?: { result?: unknown; code?: unknown }; pending?: unknown; accepted?: unknown; success?: unknown; code?: unknown };
  if (typeof record.code === 'string') return Object.freeze({ result: record.code });
  if (record.outcome && typeof record.outcome.result === 'string') {
    return Object.freeze({ result: record.outcome.result, ...(typeof record.outcome.code === 'string' ? { code: record.outcome.code } : {}) });
  }
  if (record.pending === true) return Object.freeze({ result: 'pending' });
  if (record.accepted === true || record.success === true) return Object.freeze({ result: 'accepted' });
  return undefined;
}

// ---------------------------------------------------------------- helpers

function unsupported(what: string, adapter?: string): ExtendedRpcResult {
  return {
    error: `${CONSOLE_LOGIN_UNSUPPORTED}: ${adapter ? `${adapter} does not support ${what}` : `${what} not available on this host`}`,
    data: { code: CONSOLE_LOGIN_UNSUPPORTED },
  };
}

/** When the caller names an Endpoint (scoped permission), the task must belong to it. */
function checkTaskTarget(d: Record<string, unknown>, ctx: ConsoleRpcExtendedCtx, id: string): ExtendedRpcResult | undefined {
  const adapter = strField(d, 'adapter');
  const endpointKey = strField(d, 'endpointKey');
  if (!adapter && !endpointKey) return undefined;
  const task = ctx.loginAssist?.listPending().find((item) => item.id === id);
  if (!task || (adapter && task.adapter !== adapter) || (endpointKey && task.endpointKey !== endpointKey)) {
    return { error: `login task not found: ${id}` };
  }
  return undefined;
}

function readSubmitValue(raw: unknown): string | Record<string, unknown> | false {
  if (raw === undefined || raw === null) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (typeof raw !== 'object' || Array.isArray(raw)) return false;
  const record = raw as Record<string, unknown>;
  if (record.action === undefined) return record;
  if (typeof record.action !== 'string' || !record.action || record.action.length > 64) return false;
  if (record.values !== undefined && (!record.values || typeof record.values !== 'object' || Array.isArray(record.values))) return false;
  const values: Record<string, string> = {};
  for (const [key, item] of Object.entries((record.values ?? {}) as Record<string, unknown>)) {
    if (typeof item !== 'string' && typeof item !== 'number') return false;
    values[key] = String(item);
  }
  return { action: record.action, values };
}

function readEndpointIdentity(value: unknown): { readonly canonicalId: string; readonly instanceId: string; readonly epoch: number; readonly incarnationId: string } | false | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const identity = value as Record<string, unknown>;
  if (Object.keys(identity).length !== 4 || typeof identity.canonicalId !== 'string' || !identity.canonicalId
    || typeof identity.instanceId !== 'string' || !identity.instanceId || typeof identity.incarnationId !== 'string' || !identity.incarnationId || !Number.isSafeInteger(identity.epoch) || Number(identity.epoch) < 1) return false;
  return { canonicalId: identity.canonicalId, instanceId: identity.instanceId, epoch: Number(identity.epoch), incarnationId: identity.incarnationId };
}
