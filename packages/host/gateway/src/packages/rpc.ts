/**
 * Transport-independent dispatcher for the gateway's own RPC (`gateway.packages.*`,
 * `gateway.instance.*`, ADR 0054 §4 / §5). The HTTP server maps envelopes onto it; the permission
 * map in `@zhin.js/console-protocol` is checked here, then each service applies its own rules.
 */
import {
  GATEWAY_RPC,
  GATEWAY_RPC_PERMISSIONS,
  type GatewayInstanceLogs,
  type GatewayInstanceStatus,
  type GatewayPackageOperation,
  type GatewayRpcRequest,
  type GatewayRpcResponse,
  type GatewayRpcType,
} from '@zhin.js/console-protocol';
import { OnboardingError } from '../onboarding/errors.js';
import type { InstanceStatus, InstanceStopOptions } from '../supervisor/instance-supervisor.js';
import type { InstanceLogLine } from '../supervisor/instance-logs.js';
import { gatewayPrincipalAllows, type GatewayPrincipal } from './authorization.js';
import { GatewayError } from './errors.js';
import type { GatewayPackageService } from './service.js';

/** The part of `InstanceSupervisor` the lifecycle RPC uses. */
export interface GatewayRpcInstance {
  start(): Promise<void>;
  stop(options?: InstanceStopOptions): Promise<void>;
  restart(options?: Omit<InstanceStopOptions, 'force'>): Promise<void>;
  status(): InstanceStatus;
  readonly logs: { tail(limit?: number): readonly InstanceLogLine[] };
}

export interface GatewayRpcDependencies {
  readonly packages?: GatewayPackageService;
  readonly instance?: GatewayRpcInstance;
}

export type GatewayRpcDispatcher = (request: GatewayRpcRequest, principal: GatewayPrincipal | undefined) => Promise<GatewayRpcResponse>;

const GATEWAY_TYPES: ReadonlySet<string> = new Set(Object.values(GATEWAY_RPC));
const DEFAULT_LOG_LINES = 200;
const MAX_LOG_LINES = 1_000;

export function isGatewayRpcType(type: unknown): type is GatewayRpcType {
  return typeof type === 'string' && GATEWAY_TYPES.has(type);
}

export function createGatewayRpcDispatcher(dependencies: GatewayRpcDependencies): GatewayRpcDispatcher {
  return (request, principal) => dispatchGatewayRpc(request, principal, dependencies);
}

/** Dispatches one gateway RPC; never throws (errors become `{ ok: false }`). */
export async function dispatchGatewayRpc(
  request: GatewayRpcRequest,
  principal: GatewayPrincipal | undefined,
  dependencies: GatewayRpcDependencies,
): Promise<GatewayRpcResponse> {
  try {
    const type = request?.type;
    if (!isGatewayRpcType(type)) throw new GatewayError('unmapped', `RPC "${String(type ?? '').slice(0, 64)}" 未登记权限`);
    if (!principal) throw new GatewayError('forbidden', '未登录');
    const packageMutation = type === GATEWAY_RPC.PLAN || type === GATEWAY_RPC.INSTALL;
    // The bootstrap token reaches plan / install only, where the service limits it to database drivers.
    const bootstrapDelegated = principal !== 'local' && principal.kind === 'bootstrap' && packageMutation;
    if (!bootstrapDelegated && !gatewayPrincipalAllows(principal, GATEWAY_RPC_PERMISSIONS[type])) {
      throw new GatewayError('forbidden', `缺少权限 ${GATEWAY_RPC_PERMISSIONS[type]}`);
    }
    const data = record(request.data);
    return Object.freeze({ ok: true, data: await handle(type, data, principal, dependencies) });
  } catch (error) {
    return failure(error);
  }
}

async function handle(type: GatewayRpcType, data: Readonly<Record<string, unknown>>, principal: GatewayPrincipal, deps: GatewayRpcDependencies): Promise<unknown> {
  switch (type) {
    case 'gateway.packages.list': return packagesOf(deps).list(principal);
    case 'gateway.packages.plan': {
      const operation = data.operation;
      if (operation !== 'install' && operation !== 'uninstall' && operation !== 'update') throw new GatewayError('invalid_input', 'operation 只能是 install / uninstall / update');
      return packagesOf(deps).plan(operation as GatewayPackageOperation, packageList(data, operation === 'update'), principal);
    }
    case 'gateway.packages.install':
      return packagesOf(deps).install(packageList(data, false) as readonly unknown[], {
        principal, ...optionalBoolean(data, 'enable'), ...optionalBoolean(data, 'startInstance'),
      });
    case 'gateway.packages.uninstall':
      return packagesOf(deps).uninstall(packageList(data, false) as readonly unknown[], {
        principal, ...optionalBoolean(data, 'startInstance'), ...optionalBoolean(data, 'removeDependency'),
      });
    case 'gateway.packages.update':
      return packagesOf(deps).update(packageList(data, true), { principal, ...optionalBoolean(data, 'startInstance') });
    case 'gateway.plugins.declare': {
      if (data.config !== undefined && (!data.config || typeof data.config !== 'object' || Array.isArray(data.config))) {
        throw new GatewayError('invalid_input', 'config 必须是对象');
      }
      return packagesOf(deps).declare({ package: data.package, instanceKey: data.instanceKey, config: data.config }, {
        principal, ...optionalBoolean(data, 'startInstance'),
      });
    }
    case 'gateway.plugins.enable':
    case 'gateway.plugins.disable':
      return packagesOf(deps).setEnabled({ plugin: data.plugin }, type === 'gateway.plugins.enable', {
        principal, ...optionalBoolean(data, 'startInstance'),
      });
    case 'gateway.instance.status': return instanceStatus(instanceOf(deps).status());
    case 'gateway.instance.logs': {
      const lines = data.lines === undefined ? DEFAULT_LOG_LINES : data.lines;
      if (typeof lines !== 'number' || !Number.isInteger(lines) || lines < 1 || lines > MAX_LOG_LINES) {
        throw new GatewayError('invalid_input', `lines 必须是 1–${MAX_LOG_LINES} 的整数`);
      }
      const result: GatewayInstanceLogs = Object.freeze({
        lines: Object.freeze(instanceOf(deps).logs.tail(lines).map(line => Object.freeze({ seq: line.seq, time: line.time, stream: line.stream, line: line.line }))),
      });
      return result;
    }
    case 'gateway.instance.start':
    case 'gateway.instance.stop':
    case 'gateway.instance.restart': {
      const instance = instanceOf(deps);
      // A dependency transaction owns the instance until it ends.
      if (deps.packages?.activeTransaction) throw new GatewayError('conflict', '依赖事务进行中，实例由事务停启');
      try {
        if (type === 'gateway.instance.start') await instance.start();
        else if (type === 'gateway.instance.stop') await instance.stop({ reason: 'console' });
        else await instance.restart({ reason: 'console' });
      } catch (error) {
        throw new GatewayError('unavailable', error instanceof Error ? error.message : String(error), { cause: error });
      }
      return instanceStatus(instance.status());
    }
  }
}

function packagesOf(deps: GatewayRpcDependencies): GatewayPackageService {
  if (!deps.packages) throw new GatewayError('unavailable', '依赖管理不可用');
  return deps.packages;
}

function instanceOf(deps: GatewayRpcDependencies): GatewayRpcInstance {
  if (!deps.instance) throw new GatewayError('unavailable', '网关未管理实例');
  return deps.instance;
}

export function instanceStatus(status: InstanceStatus): GatewayInstanceStatus {
  return Object.freeze({
    instanceId: 'default' as const,
    state: status.state,
    ...(status.pid === undefined ? {} : { pid: status.pid }),
    ...(status.startedAt === undefined ? {} : { startedAt: status.startedAt }),
    ...(status.generation === undefined ? {} : { generation: status.generation }),
    ...(status.protocolVersion === undefined ? {} : { protocolVersion: status.protocolVersion }),
    lastExitCode: status.lastExitCode,
    lastExitSignal: status.lastExitSignal,
    ...(status.lastFailure ? { lastFailure: Object.freeze({ ...status.lastFailure }) } : {}),
    recentRestarts: status.recentRestarts,
  });
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new GatewayError('invalid_input', 'data 必须是对象');
  return value as Record<string, unknown>;
}

function packageList(data: Readonly<Record<string, unknown>>, allowAll: boolean): readonly unknown[] | 'all' {
  const value = data.packages;
  if (allowAll && value === 'all') return 'all';
  if (!Array.isArray(value)) throw new GatewayError('invalid_input', allowAll ? 'packages 必须是数组或 "all"' : 'packages 必须是数组');
  return value;
}

function optionalBoolean<K extends string>(data: Readonly<Record<string, unknown>>, key: K): Partial<Record<K, boolean>> {
  const value = data[key];
  if (value === undefined) return {};
  if (typeof value !== 'boolean') throw new GatewayError('invalid_input', `${key} 必须是布尔值`);
  return { [key]: value } as Partial<Record<K, boolean>>;
}

function failure(error: unknown): GatewayRpcResponse {
  const known = error instanceof GatewayError ? error
    : error instanceof OnboardingError ? new GatewayError(error.code, error.message)
      : undefined;
  const code = known?.code ?? 'internal';
  // Unexpected errors are not echoed: they may carry paths or package-manager output.
  const message = known?.message ?? '网关内部错误';
  return Object.freeze({ ok: false, error: Object.freeze({ code, message, status: known?.status ?? 500, ...known?.details }) });
}
