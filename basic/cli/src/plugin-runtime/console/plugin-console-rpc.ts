import { adapterFeatureId, isAdapterIndex } from '@zhin.js/adapter';
import type { ConsoleAccess } from '@zhin.js/host-http';
import { parsePluginConsoleRpcType } from '@zhin.js/console-protocol';
import { ConsoleCatalog } from '@zhin.js/pagemanager/plugin-runtime';
import {
  GenerationAdmissionGate,
  PluginConsoleRpcError,
  generationAdmissionSource,
  pluginConsoleRpcToken,
  type NormalizedPluginConsoleRpcMethod,
  type PluginConsoleRpc,
  type PluginConsoleRpcCall,
  type PluginId,
  type RuntimeSnapshot,
  type SnapshotLease,
  type SnapshotReader,
} from '@zhin.js/plugin-runtime';

/** Conservative bounds: Console pages need small status shapes, not dumps. */
export const PLUGIN_CONSOLE_RPC_INPUT_LIMIT = 64 * 1024;
export const PLUGIN_CONSOLE_RPC_OUTPUT_LIMIT = 256 * 1024;
export const PLUGIN_CONSOLE_RPC_TIMEOUT_MS = 10_000;

export type PluginConsoleRpcFailureCode =
  | 'forbidden' | 'invalid_input' | 'conflict' | 'not_found' | 'unsupported' | 'unavailable' | 'timeout' | 'failed' | 'commit_unknown';

export type PluginConsoleRpcResult =
  | { readonly status: 200; readonly body: { readonly success: true; readonly data: unknown; readonly requestId?: unknown } }
  | { readonly status: number; readonly body: { readonly success: false; readonly code: PluginConsoleRpcFailureCode; readonly error: string; readonly requestId?: unknown } };

const publicAccess = Object.freeze({ permissions: [] as string[], roles: [] as string[] });

export interface PluginConsoleRpcRequestOptions {
  readonly snapshots?: SnapshotReader;
  /** Caller access from its bearer token (`TokenRegistry.resolveAccess`). */
  readonly access: ConsoleAccess;
  readonly timeoutMs?: number;
  /**
   * Host-owned methods answered as `plugin.root.<name>` (for example the Agent's 群聊插话 and
   * 技能助手 views). They live for the whole process, so no generation admission applies, and they
   * take precedence over the same name on the root plugin's own provider.
   */
  readonly hostRpc?: PluginConsoleRpc;
  /** @internal Test seam; defaults to the generation's Console Page catalog. */
  readonly pagesOwnedBy?: (snapshot: RuntimeSnapshot, owner: PluginId) => ReturnType<ConsoleCatalog['pagesOwnedBy']>;
}

const catalogPagesOwnedBy = (snapshot: RuntimeSnapshot, owner: PluginId) =>
  new ConsoleCatalog(snapshot, publicAccess).pagesOwnedBy(owner);

const failureStatus: Readonly<Record<PluginConsoleRpcFailureCode, number>> = {
  forbidden: 403, invalid_input: 400, conflict: 409, not_found: 404,
  unsupported: 400, unavailable: 503, timeout: 504, failed: 500, commit_unknown: 504,
};

class Failure extends Error {
  constructor(readonly code: PluginConsoleRpcFailureCode, message: string) { super(message); }
}

/**
 * Handles `plugin.<pluginId>.<method>` Console RPC. Returns undefined for any other type so the
 * caller falls through to the built-in dispatcher.
 */
export async function dispatchPluginConsoleRpcRequest(
  message: Readonly<Record<string, unknown>>,
  options: PluginConsoleRpcRequestOptions,
): Promise<PluginConsoleRpcResult | undefined> {
  const address = parsePluginConsoleRpcType(message.type);
  if (!address) return undefined;
  const requestId = message.requestId;
  let lease: SnapshotLease | undefined;
  const releases: Array<() => void> = [];
  try {
    const input = parseInput(message.data);
    lease = acquire(options.snapshots);
    const snapshot = lease.value;
    const pluginId = address.pluginId as PluginId;
    if (!snapshot.tree.has(pluginId)) throw new Failure('not_found', '插件未加载');
    const hostMethod = pluginId === snapshot.root ? options.hostRpc?.methods.get(address.method) : undefined;
    const provider = hostMethod ? undefined : ownProvider(snapshot, pluginId);
    const method = hostMethod ?? provider?.methods.get(address.method);
    if (!method) throw new Failure('not_found', '插件未提供该操作');
    authorize(snapshot, pluginId, method, options.access, options.pagesOwnedBy ?? catalogPagesOwnedBy);
    if (provider) releases.push(...admit(provider));
    const runtime: NonNullable<PluginConsoleRpcCall['runtime']> = Object.freeze({
      owner: pluginId, generation: snapshot.generation, operator: options.access.unrestricted,
      project(feature) {
        if (feature !== adapterFeatureId) throw new PluginConsoleRpcError('unsupported', '该运行投影未授权');
        const projection = snapshot.projections.get(adapterFeatureId);
        if (!isAdapterIndex(projection)) throw new PluginConsoleRpcError('unsupported', '账号运行目录不可用');
        return projection.forOwner(pluginId);
      },
    });
    const output = await callWithTimeout(method, input, options.timeoutMs ?? PLUGIN_CONSOLE_RPC_TIMEOUT_MS, runtime);
    return { status: 200, body: { success: true, data: output, ...(requestId === undefined ? {} : { requestId }) } };
  } catch (error) {
    const failure = toFailure(error);
    return {
      status: failureStatus[failure.code],
      body: { success: false, code: failure.code, error: failure.message, ...(requestId === undefined ? {} : { requestId }) },
    };
  } finally {
    releases.reverse().forEach((release) => release());
    lease?.release();
  }
}

/**
 * A method's requirements are its Page's `requiredPermissions` / `requiredRoles` plus its own.
 * - The operator (full scope, or a Host without tokens) passes everything.
 * - Any other token may call read-only methods (`status`, queries) when it holds every required
 *   permission and role (plus at least one `anyOfPermissions` when the method lists any). One with no requirements at all is open to such tokens only with `demo: true`.
 * - Actions are open to such tokens only when the action declares its own requirements and the
 *   token holds them all (page ones included); an action without its own requirements is admin-only.
 */
function authorize(
  snapshot: RuntimeSnapshot,
  pluginId: PluginId,
  method: NormalizedPluginConsoleRpcMethod,
  access: ConsoleAccess,
  pagesOwnedBy: NonNullable<PluginConsoleRpcRequestOptions['pagesOwnedBy']>,
): void {
  const permissions = new Set(method.requiredPermissions);
  const roles = new Set(method.requiredRoles);
  if (method.page !== undefined) {
    const page = pagesOwnedBy(snapshot, pluginId).find((candidate) => candidate.localName === method.page);
    // Fail closed: a method bound to a missing page must not become unguarded.
    if (!page) throw new Failure('unavailable', '该操作对应的页面未加载');
    page.requiredPermissions.forEach((permission) => permissions.add(permission));
    page.requiredRoles.forEach((role) => roles.add(role));
  }
  if (access.unrestricted) return;
  const held = new Set(access.permissions);
  const heldRoles = new Set(access.roles);
  const anyOf = method.anyOfPermissions ?? [];
  const satisfied = [...permissions].every((permission) => held.has(permission))
    && [...roles].every((role) => heldRoles.has(role))
    && (anyOf.length === 0 || anyOf.some((permission) => held.has(permission)));
  const guarded = permissions.size > 0 || roles.size > 0 || anyOf.length > 0;
  if (!method.readOnly) {
    // An action opens to non-admin tokens only through its own permission or role, so viewing a
    // page never grants its actions; the page's requirements still apply on top.
    if (method.requiredPermissions.length === 0 && method.requiredRoles.length === 0 && anyOf.length === 0) {
      throw new Failure('forbidden', '需要管理员令牌');
    }
    if (!satisfied) throw new Failure('forbidden', '没有操作权限');
    return;
  }
  if (!satisfied || (!guarded && !method.demo)) throw new Failure('forbidden', '没有查看权限');
}

function acquire(snapshots?: SnapshotReader): SnapshotLease {
  if (!snapshots) throw new Failure('unavailable', '运行时未就绪');
  try { return snapshots.acquire(); } catch { throw new Failure('unavailable', '运行时未就绪'); }
}

/** Scope snapshots flatten inherited bindings; only the declaring owner answers. */
function ownProvider(snapshot: RuntimeSnapshot, owner: PluginId): PluginConsoleRpc | undefined {
  const value = snapshot.resources.get(owner)?.get(pluginConsoleRpcToken.id);
  if (value === undefined) return undefined;
  let parent = snapshot.tree.get(owner)?.parent;
  while (parent) {
    if (snapshot.resources.get(parent)?.get(pluginConsoleRpcToken.id) === value) return undefined;
    parent = snapshot.tree.get(parent)?.parent;
  }
  if (!value || typeof value !== 'object' || !((value as PluginConsoleRpc).methods instanceof Map)) {
    throw new Failure('unavailable', '插件接口无效');
  }
  return value as PluginConsoleRpc;
}

function admit(provider: PluginConsoleRpc): Array<() => void> {
  const gates = provider[generationAdmissionSource];
  if (!Array.isArray(gates) || !gates.length || !gates.every((gate) => gate instanceof GenerationAdmissionGate)) {
    throw new Failure('unavailable', '插件接口无效');
  }
  const releases: Array<() => void> = [];
  try {
    for (const gate of new Set(gates)) {
      const release = gate.acquire();
      if (!release) throw new Failure('conflict', '插件正在重载，请稍后重试');
      releases.push(release);
    }
    return releases;
  } catch (error) {
    releases.reverse().forEach((release) => release());
    throw error;
  }
}

function parseInput(value: unknown): Readonly<Record<string, unknown>> {
  if (value === undefined || value === null) return Object.freeze({});
  if (typeof value !== 'object' || Array.isArray(value)) throw new Failure('invalid_input', 'data 必须是对象');
  let encoded: string;
  try { encoded = JSON.stringify(value); } catch { throw new Failure('invalid_input', 'data 必须是 JSON'); }
  if (encoded.length > PLUGIN_CONSOLE_RPC_INPUT_LIMIT) throw new Failure('invalid_input', 'data 过大');
  return Object.freeze(JSON.parse(encoded) as Record<string, unknown>);
}

async function callWithTimeout(
  method: NormalizedPluginConsoleRpcMethod,
  input: Readonly<Record<string, unknown>>,
  timeoutMs: number,
  runtime: NonNullable<PluginConsoleRpcCall['runtime']>,
): Promise<unknown> {
  const controller = new AbortController();
  let commitStarted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(commitStarted
        ? new Failure('commit_unknown', '提交结果尚未确认，请刷新状态，勿重复提交')
        : new Failure('timeout', '插件响应超时'));
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => method.handler(input as never, { signal: controller.signal, runtime, commitStarted: () => { commitStarted = true; } })),
      timeout,
    ]);
    return encodeOutput(result);
  } finally {
    clearTimeout(timer);
  }
}

/** Round-trips through JSON so only plain data leaves the plugin, and bounds its size. */
function encodeOutput(value: unknown): unknown {
  let encoded: string | undefined;
  try { encoded = JSON.stringify(value === undefined ? null : value); } catch { throw new Failure('failed', '插件返回了无效数据'); }
  if (encoded === undefined) throw new Failure('failed', '插件返回了无效数据');
  if (encoded.length > PLUGIN_CONSOLE_RPC_OUTPUT_LIMIT) throw new Failure('failed', '插件返回的数据过大');
  return JSON.parse(encoded) as unknown;
}

/** Only PluginConsoleRpcError messages are plugin-authored safe text; everything else is generic. */
function toFailure(error: unknown): Failure {
  if (error instanceof Failure) return error;
  if (error instanceof PluginConsoleRpcError) return new Failure(error.code, error.message);
  return new Failure('failed', '插件操作失败');
}
