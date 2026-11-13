/**
 * CLI access to the project's gateway over the local control socket (ADR 0054 §6), and the
 * fallbacks used when no gateway runs.
 */
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  GatewayInstanceStatus,
  GatewayPackageEvent,
  GatewayPackageOperation,
  GatewayPackageTransactionResult,
  GatewayPluginConfigurationNeed,
} from '@zhin.js/console-protocol';
import { GATEWAY_RPC } from '@zhin.js/console-protocol';
import {
  gatewayLogFile,
  LocalGatewayClient,
  LocalGatewayClientError,
  LocalGatewayRpcError,
  probeLocalGateway,
  type LocalGatewayInfoResult,
} from '@zhin.js/gateway/local';
import { GatewayPackageService } from '@zhin.js/gateway/packages';
import { supervisedNodeArguments } from '@zhin.js/gateway/supervisor';
import { consoleLink } from '@zhin.js/gateway/server';
import { isProcessRunning } from './process.js';

export interface GatewayTarget {
  readonly root: string;
  /** Socket owner check override (tests). */
  readonly uid?: () => number | undefined;
}

/** A gateway error with an actionable message (not-owner, unreachable, protocol). */
export function describeGatewayError(error: unknown): string {
  if (error instanceof LocalGatewayClientError) {
    if (error.code === 'not_owner') return `${error.message}`;
    if (error.code === 'unreachable') return `网关无响应：${error.message}。可用 zhin status 查看，必要时结束网关进程后删除 .zhin/gateway.sock`;
    return error.message;
  }
  if (error instanceof LocalGatewayRpcError) return `网关拒绝请求（${error.code}）：${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

/** The running gateway, or undefined. Not-owner / unreachable are thrown. */
export function probeGateway(target: GatewayTarget): Promise<LocalGatewayInfoResult | undefined> {
  return probeLocalGateway({ root: target.root, ...(target.uid ? { uid: target.uid } : {}) });
}

export async function withGateway<T>(target: GatewayTarget, use: (client: LocalGatewayClient) => Promise<T>): Promise<T> {
  const client = await LocalGatewayClient.connect({ root: target.root, ...(target.uid ? { uid: target.uid } : {}) });
  try { return await use(client); } finally { client.close(); }
}

// ---- output ----

export interface Output {
  out(text: string): void;
  err(text: string): void;
}

export const processOutput: Output = {
  out: (text) => { process.stdout.write(text); },
  err: (text) => { process.stderr.write(text); },
};

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d${hours % 24}h`;
}

export function describeInstance(status: GatewayInstanceStatus): string {
  const parts: string[] = [];
  if (status.pid) parts.push(`pid ${status.pid}`);
  if (status.generation !== undefined) parts.push(`generation ${status.generation}`);
  if (status.startedAt) parts.push(`已运行 ${formatDuration(Date.now() - status.startedAt)}`);
  if (status.state !== 'running' && status.lastExitCode !== null) parts.push(`最近退出码 ${status.lastExitCode}`);
  if (status.recentRestarts) parts.push(`近一分钟重启 ${status.recentRestarts} 次`);
  return `${status.state}${parts.length ? `（${parts.join('，')}）` : ''}`;
}

export function renderStatus(result: LocalGatewayInfoResult, now = Date.now()): string[] {
  const { gateway, instance } = result;
  const lines = [
    `网关：运行中（pid ${gateway.pid}，${gateway.mode}，v${gateway.version}，已运行 ${formatDuration(now - gateway.startedAt)}）`,
  ];
  for (const origin of gateway.origins) lines.push(`  HTTP：${origin}`);
  if (gateway.origins[0]) lines.push(`  Console：${consoleLink(gateway.origins[0])}`);
  if (!result.consoleInitialized) lines.push('  Console 尚未初始化：用 .env 的 HTTP_TOKEN（初始化令牌）登录，或运行 zhin console init');
  lines.push(`实例：${describeInstance(instance)}`);
  if (instance.lastFailure && instance.state !== 'running') {
    lines.push(`  最近失败：${instance.lastFailure.message}`);
    for (const line of instance.lastFailure.logTail.slice(-10)) lines.push(`    ${line}`);
  }
  return lines;
}

const PHASE_LABELS: Readonly<Record<string, string>> = {
  snapshot: '备份项目文件',
  'stop-instance': '停止实例',
  'package-manager': '执行包管理器',
  configure: '写入插件声明与配置',
  'start-instance': '启动实例',
  rollback: '回滚',
  'restore-files': '恢复项目文件',
  reinstall: '重新安装依赖',
  'restart-instance': '重新启动旧版本实例',
  done: '完成',
};

/** Prints transaction progress; returns the event printer. */
export function packageEventPrinter(output: Output = processOutput): (event: GatewayPackageEvent) => void {
  return (event) => {
    if (event.type === 'start') output.out(`→ ${event.operation} ${event.packages.map((item) => item.spec).join(' ') || '(全部依赖)'}\n`);
    else if (event.type === 'phase') output.out(`  · ${PHASE_LABELS[event.phase] ?? event.phase}\n`);
    else if (event.type === 'output') (event.stream === 'stderr' ? output.err : output.out)(event.chunk);
  };
}

export function renderTransactionResult(result: GatewayPackageTransactionResult): string[] {
  const names = result.packages.map((item) => item.spec).join(' ') || '(全部依赖)';
  if (result.ok && result.plugin) {
    const { instanceKey, packageName, enabled, changed } = result.plugin;
    const state = enabled ? '启用' : '停用';
    return [changed
      ? `✓ 已${state}插件实例 ${instanceKey}（${packageName}），已更新 disable_plugins（实例 ${result.instance.before} → ${result.instance.after}）`
      : `✓ 插件实例 ${instanceKey}（${packageName}）已是${state}状态，未改动配置，实例未重启`];
  }
  if (result.ok) return [`✓ ${result.operation} 完成：${names}（实例 ${result.instance.before} → ${result.instance.after}）`,
    ...configurationHints(result.needsConfiguration ?? [])];
  const lines = [
    result.status === 'rolledBack'
      ? `✗ ${result.operation} 失败（阶段 ${result.failedPhase ?? '?'}），已回滚：${result.error ?? ''}`
      : `✗ ${result.operation} 失败且回滚未完成：${result.error ?? ''}；回滚错误：${result.rollbackError ?? ''}`,
  ];
  if (result.logTail?.length) {
    lines.push('实例日志尾部：');
    for (const line of result.logTail.slice(-20)) lines.push(`  ${line}`);
  }
  return lines;
}

/** Hints for plugins installed but left undeclared until their configuration is complete. */
export function configurationHints(needs: readonly GatewayPluginConfigurationNeed[]): string[] {
  return needs.map((need) => {
    const missing = [...need.missing, ...need.missingEnv.map((name) => `环境变量 ${name}`)].join('、') || '必填配置';
    return `! ${need.name} 已安装但未启用：需要先配置 ${missing}。请在 Console 的插件配置中填写后声明（gateway.plugins.declare），`
      + `或在配置文件中添加 plugins.${need.instanceKey}: ${need.name} 与 ${need.instanceKey} 配置段，再运行 zhin restart`;
  });
}

export interface PackageOperationRequest {
  readonly operation: GatewayPackageOperation;
  readonly packages: readonly string[] | 'all';
  readonly enable?: boolean;
  readonly removeDependency?: boolean;
}

function rpcData(request: PackageOperationRequest): Record<string, unknown> {
  return {
    packages: request.packages,
    ...(request.enable === undefined || request.operation !== 'install' ? {} : { enable: request.enable }),
    ...(request.removeDependency === undefined || request.operation !== 'uninstall' ? {} : { removeDependency: request.removeDependency }),
  };
}

const RPC_BY_OPERATION = {
  install: GATEWAY_RPC.INSTALL,
  uninstall: GATEWAY_RPC.UNINSTALL,
  update: GATEWAY_RPC.UPDATE,
} as const;

/** Runs a dependency transaction through the running gateway, streaming its progress. */
export async function runPackageOperationViaGateway(
  target: GatewayTarget,
  request: PackageOperationRequest,
  output: Output = processOutput,
): Promise<GatewayPackageTransactionResult> {
  const print = packageEventPrinter(output);
  const result = await withGateway(target, (client) => client.request<GatewayPackageTransactionResult>(
    RPC_BY_OPERATION[request.operation], rpcData(request), { onEvent: print },
  ));
  for (const line of renderTransactionResult(result)) (result.ok ? output.out : output.err)(`${line}\n`);
  return result;
}

export interface PluginEnablementRequest {
  /** Instance key, or the package name of a package declared once. */
  readonly plugin: string;
  readonly enabled: boolean;
}

/** `zhin enable` / `zhin disable` through the running gateway (configuration-only transaction). */
export async function runPluginEnablementViaGateway(
  target: GatewayTarget,
  request: PluginEnablementRequest,
  output: Output = processOutput,
): Promise<GatewayPackageTransactionResult> {
  const print = packageEventPrinter(output);
  const result = await withGateway(target, (client) => client.request<GatewayPackageTransactionResult>(
    request.enabled ? GATEWAY_RPC.ENABLE : GATEWAY_RPC.DISABLE, { plugin: request.plugin }, { onEvent: print },
  ));
  for (const line of renderTransactionResult(result)) (result.ok ? output.out : output.err)(`${line}\n`);
  return result;
}

/** The same transaction without a gateway (no instance to stop / start). */
export async function runPackageOperationDirect(
  target: GatewayTarget,
  request: PackageOperationRequest,
  output: Output = processOutput,
  service: GatewayPackageService = new GatewayPackageService({ projectRoot: target.root }),
): Promise<GatewayPackageTransactionResult> {
  const onEvent = packageEventPrinter(output);
  const options = { principal: 'local' as const, onEvent };
  const result = request.operation === 'update'
    ? await service.update(request.packages, options)
    : request.packages === 'all'
      ? (() => { throw new Error('只有 update 可以作用于全部依赖'); })()
      : request.operation === 'install'
        ? await service.install(request.packages, { ...options, ...(request.enable === undefined ? {} : { enable: request.enable }) })
        : await service.uninstall(request.packages, { ...options, ...(request.removeDependency === undefined ? {} : { removeDependency: request.removeDependency }) });
  for (const line of renderTransactionResult(result)) (result.ok ? output.out : output.err)(`${line}\n`);
  return result;
}

// ---- background start ----

export interface StartDaemonOptions {
  readonly root: string;
  /** Start options for the instance (`--mode production …`). */
  readonly args: readonly string[];
  /** CLI script; default `process.argv[1]`. */
  readonly entry?: string;
  readonly timeoutMs?: number;
  readonly uid?: () => number | undefined;
}

export interface StartDaemonResult {
  readonly pid: number;
  readonly status: LocalGatewayInfoResult;
  readonly logFile: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Last `lines` lines of a text file ('' when missing). */
export function readFileTail(file: string, lines: number): string[] {
  try {
    const size = statSync(file).size;
    const text = readFileSync(file, 'utf8').slice(size > 4 * 1024 * 1024 ? -4 * 1024 * 1024 : 0);
    const all = text.split('\n');
    if (all.at(-1) === '') all.pop();
    return all.slice(-lines);
  } catch { return []; }
}

/**
 * Starts the gateway as a detached background process (`zhin runtime start --daemon …`) with
 * its own output in `.zhin/logs/gateway.log`, and waits until its control socket answers.
 */
export async function startGatewayDaemon(options: StartDaemonOptions): Promise<StartDaemonResult> {
  const entry = options.entry ?? process.argv[1];
  if (!entry) throw new Error('无法确定 zhin 可执行文件路径');
  const logFile = gatewayLogFile(options.root);
  mkdirSync(dirname(logFile), { recursive: true });
  const fd = openSync(logFile, 'a', 0o600);
  let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  let child;
  try {
    child = spawn(process.execPath, [...supervisedNodeArguments(), entry, 'runtime', 'start', '--daemon', ...options.args], {
      cwd: options.root,
      detached: true,
      stdio: ['ignore', fd, fd],
      env: process.env,
      windowsHide: true,
    });
  } finally {
    closeSync(fd);
  }
  child.once('exit', (code, signal) => { exit = { code, signal }; });
  const pid = child.pid;
  if (pid === undefined) throw new Error('无法启动网关进程');
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  try {
    let status: LocalGatewayInfoResult | undefined;
    while (!status) {
      if (exit) throw new Error(`网关进程已退出（code ${exit.code ?? 'none'}${exit.signal ? `, ${exit.signal}` : ''}）。日志 ${logFile}：\n${readFileTail(logFile, 20).join('\n')}`);
      if (Date.now() > deadline) throw new Error(`网关在 ${options.timeoutMs ?? 30_000} ms 内没有就绪；查看 ${logFile}`);
      try {
        const probed = await probeGateway({ root: options.root, ...(options.uid ? { uid: options.uid } : {}) });
        if (probed?.gateway.pid === pid) status = probed;
      } catch (error) {
        // Not answering yet (handler not installed, socket being replaced): keep waiting.
        const transient = error instanceof LocalGatewayRpcError
          || (error instanceof LocalGatewayClientError && error.code === 'unreachable');
        if (!transient) throw error;
      }
      if (!status) await sleep(150);
    }
    // Give the instance a moment to come up so the summary is useful.
    while (status.instance.state === 'starting' && Date.now() < deadline) {
      await sleep(250);
      status = (await probeGateway({ root: options.root, ...(options.uid ? { uid: options.uid } : {}) })) ?? status;
    }
    return { pid, status, logFile };
  } finally {
    child.removeAllListeners('exit');
    child.unref();
  }
}

/** Waits until the gateway's socket stops answering and its process is gone. */
export async function waitForGatewayExit(target: GatewayTarget, pid: number, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let live: LocalGatewayInfoResult | undefined;
    try { live = await probeGateway(target); } catch { live = undefined; }
    if (!live && !isProcessRunning(pid)) return true;
    await sleep(150);
  }
  return false;
}
