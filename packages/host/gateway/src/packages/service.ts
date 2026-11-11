/**
 * Dependency transactions of the management gateway (ADR 0054 §4): one at a time, the instance
 * stopped while the package manager runs, and a failed install / uninstall / update rolled back
 * to the captured project files and lockfile with the old instance started again.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  GatewayAuthorizedPackage,
  GatewayInstalledPackage,
  GatewayInstanceState,
  GatewayPackageEvent,
  GatewayPackageList,
  GatewayPackageOperation,
  GatewayPackagePhase,
  GatewayPackagePlan,
  GatewayPackageTransactionResult,
  GatewayPackageTransactionStatus,
} from '@zhin.js/console-protocol';
import { CONSOLE_PERMISSIONS } from '@zhin.js/console-protocol';
import { createInstallAllowlist, type InstallAllowlist, type MarketCatalogEntry } from '../onboarding/allowlist.js';
import { InstallOutputRelay, streamEvents } from '../onboarding/install.js';
import { createStreamingPackageManager, detectPackageManager, type PackageManagerOutput } from '../onboarding/package-manager.js';
import { PluginManagementOperationError, PluginManagementWorkflow, type PluginManagementOptions } from '../plugin-management/workflow.js';
import { InstanceStartError, type InstanceFailure, type InstanceState, type InstanceStatus, type InstanceStopOptions } from '../supervisor/instance-supervisor.js';
import type { InstanceLogLine } from '../supervisor/instance-logs.js';
import { authorizePackages, gatewayPrincipalAllows, type GatewayPackageAction, type GatewayPrincipal } from './authorization.js';
import { GatewayError } from './errors.js';
import { ProjectFileSnapshot } from './snapshot.js';

/** The part of `InstanceSupervisor` a transaction drives. */
export interface PackageTransactionInstance {
  readonly state: InstanceState;
  start(): Promise<void>;
  stop(options?: InstanceStopOptions): Promise<void>;
  status(): InstanceStatus;
  on(event: 'failure', listener: (failure: InstanceFailure) => void): unknown;
  off(event: 'failure', listener: (failure: InstanceFailure) => void): unknown;
  readonly logs?: { tail(limit?: number): readonly InstanceLogLine[] };
}

/** The part of `PluginManagementWorkflow` (`PluginManagementPort`) a transaction uses. */
export interface PackageWorkflowPort {
  inspect(request: string): Promise<{ readonly declared: boolean }>;
  install(spec: string, expectedRevision?: string, expectedProjectRevision?: string, options?: { readonly enable?: boolean }): Promise<unknown>;
  uninstall(request: string, expectedRevision?: string, expectedProjectRevision?: string, options?: { readonly removeDependency?: boolean }): Promise<unknown>;
  update(request: string, targetVersion: string): Promise<unknown>;
}

/**
 * Runs the package manager with pnpm-style args (`add|remove|update|install …`), streaming output.
 * The default spawns the project's detected manager without a shell.
 */
export type GatewayPackageManager = (args: readonly string[], projectRoot: string, output: PackageManagerOutput) => Promise<void>;

export type GatewayPackageListener = (event: GatewayPackageEvent) => void;

export interface GatewayPackageServiceOptions {
  readonly projectRoot: string;
  /** The supervised instance; omitted when no instance is managed (CLI without a running gateway). */
  readonly instance?: PackageTransactionInstance;
  readonly packageManager?: GatewayPackageManager;
  /** Defaults to a `PluginManagementWorkflow` on the project root using {@link packageManager}. */
  readonly workflow?: PackageWorkflowPort;
  /** Options for the default workflow. */
  readonly workflowOptions?: Omit<PluginManagementOptions, 'installDependencies'>;
  /** True once an owner exists (bootstrap token refused afterwards). Default: true (deny bootstrap). */
  readonly hasOwner?: () => boolean | Promise<boolean>;
  /** Plugin-market entries joining the non-owner allowlist. */
  readonly marketCatalog?: () => readonly MarketCatalogEntry[] | Promise<readonly MarketCatalogEntry[]>;
  /** Extra policy after the built-in rules; throw to deny. */
  readonly authorize?: (principal: GatewayPrincipal, action: GatewayPackageAction, packages: readonly GatewayAuthorizedPackage[]) => void | Promise<void>;
  /** Time the instance gets to report `ready` after a transaction. Default 60 s (`gateway.readyTimeout`). */
  readonly readyTimeoutMs?: number;
  /** After `ready`, a failure within this window (crash, crash storm) fails the transaction. Default 5 s. */
  readonly stableMs?: number;
  readonly now?: () => number;
}

export interface GatewayTransactionOptions {
  readonly principal: GatewayPrincipal | undefined;
  /** Start the instance afterwards even when it was not running before. */
  readonly startInstance?: boolean;
  readonly onEvent?: GatewayPackageListener;
}

export interface GatewayUninstallOptions extends GatewayTransactionOptions {
  /** Also remove the npm dependency when nothing else references it (default true). */
  readonly removeDependency?: boolean;
}

export interface GatewayInstallOptions extends GatewayTransactionOptions {
  /** Declare installed plugins in the root config (default true). */
  readonly enable?: boolean;
}

export const DEFAULT_PACKAGE_READY_TIMEOUT_MS = 60_000;
export const DEFAULT_PACKAGE_STABLE_MS = 5_000;
const LOCK_FILE = 'gateway-packages.lock';
const LOG_TAIL_LINES = 50;
const RUNNING_STATES: ReadonlySet<InstanceState> = new Set(['running', 'starting', 'backoff']);

interface TransactionContext {
  readonly workflow: PackageWorkflowPort;
  readonly run: (args: readonly string[]) => Promise<void>;
}

/** Thrown inside a transaction when the instance does not come up; carries its log tail. */
class InstanceStartFailure extends Error {
  constructor(message: string, readonly logTail: readonly string[]) { super(message); this.name = 'InstanceStartFailure'; }
}

export class GatewayPackageService {
  readonly #root: string;
  readonly #options: GatewayPackageServiceOptions;
  readonly #relay = new InstallOutputRelay();
  readonly #listeners = new Set<GatewayPackageListener>();
  readonly #packageManager: GatewayPackageManager;
  readonly #workflow: PackageWorkflowPort;
  #active: string | undefined;

  constructor(options: GatewayPackageServiceOptions) {
    this.#root = resolve(options.projectRoot);
    this.#options = options;
    const streaming = createStreamingPackageManager(this.#relay.output);
    this.#packageManager = options.packageManager ?? ((args, root) => streaming(args, root));
    this.#workflow = options.workflow ?? new PluginManagementWorkflow(this.#root, {
      ...options.workflowOptions,
      installDependencies: (args, root) => this.#packageManager(args, root, this.#relay.output),
    });
  }

  /** Id of the running transaction, if any. */
  get activeTransaction(): string | undefined { return this.#active; }

  /** Progress of every transaction (for `gateway.packages.progress`); returns an unsubscribe function. */
  subscribe(listener: GatewayPackageListener): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  async allowlist(): Promise<InstallAllowlist> {
    return createInstallAllowlist({ market: await this.#options.marketCatalog?.() ?? [] });
  }

  /** Authorizes one action; throws {@link GatewayError} (deny by default). */
  async authorize(principal: GatewayPrincipal | undefined, action: GatewayPackageAction, packages: readonly unknown[] | 'all' = []): Promise<readonly GatewayAuthorizedPackage[]> {
    if (action === 'list') {
      if (!gatewayPrincipalAllows(principal, CONSOLE_PERMISSIONS.FEATURE_VIEW)) throw new GatewayError('forbidden', `需要 ${CONSOLE_PERMISSIONS.FEATURE_VIEW} 权限`);
      await this.#options.authorize?.(principal!, action, []);
      return Object.freeze([]);
    }
    if (action === 'plan') throw new GatewayError('invalid_input', 'plan 需要具体操作');
    const authorized = authorizePackages(principal, action, packages, {
      allowlist: await this.allowlist(),
      ownerExists: await (this.#options.hasOwner?.() ?? true),
    });
    await this.#options.authorize?.(principal!, action, authorized);
    return authorized;
  }

  /** Declared dependencies with their installed versions. */
  async list(principal: GatewayPrincipal | undefined): Promise<GatewayPackageList> {
    await this.authorize(principal, 'list');
    const manifest = JSON.parse(await readFile(join(this.#root, 'package.json'), 'utf8')) as Record<string, unknown>;
    const allowlist = await this.allowlist();
    const packages: GatewayInstalledPackage[] = [];
    for (const dependencyType of ['dependencies', 'optionalDependencies', 'devDependencies'] as const) {
      const entries = manifest[dependencyType];
      if (!entries || typeof entries !== 'object') continue;
      for (const [name, range] of Object.entries(entries as Record<string, unknown>)) {
        if (typeof range !== 'string') continue;
        const catalog = allowlist.get(name)?.kind;
        packages.push(Object.freeze({ name, range, dependencyType, installedVersion: await this.#installedVersion(name), ...(catalog ? { catalog } : {}) }));
      }
    }
    packages.sort((a, b) => a.name.localeCompare(b.name));
    return Object.freeze({ packageManager: await detectPackageManager(this.#root), packages: Object.freeze(packages) });
  }

  /** What a transaction would do, after authorization; changes nothing. */
  async plan(operation: GatewayPackageOperation, packages: readonly unknown[] | 'all', principal: GatewayPrincipal | undefined): Promise<GatewayPackagePlan> {
    const authorized = await this.authorize(principal, operation, packages);
    const instanceState = this.#instanceState();
    return Object.freeze({
      operation,
      packages: authorized,
      all: packages === 'all',
      packageManager: await detectPackageManager(this.#root),
      instanceState,
      restartsInstance: instanceState !== 'unmanaged' && RUNNING_STATES.has(instanceState),
    });
  }

  install(packages: readonly unknown[], options: GatewayInstallOptions): Promise<GatewayPackageTransactionResult> {
    return this.#transaction('install', packages, options, async (ctx, authorized) => {
      for (const item of authorized) await ctx.workflow.install(item.spec, undefined, undefined, { enable: options.enable !== false });
    });
  }

  uninstall(packages: readonly unknown[], options: GatewayUninstallOptions): Promise<GatewayPackageTransactionResult> {
    return this.#transaction('uninstall', packages, options, async (ctx, authorized) => {
      for (const item of authorized) {
        if (options.removeDependency === false) await ctx.workflow.uninstall(item.name, undefined, undefined, { removeDependency: false });
        else await ctx.workflow.uninstall(item.name);
      }
    });
  }

  /** Exact versions go through the workflow (verified); bare names / `'all'` run the manager's update. */
  update(packages: readonly unknown[] | 'all', options: GatewayTransactionOptions): Promise<GatewayPackageTransactionResult> {
    return this.#transaction('update', packages, options, async (ctx, authorized) => {
      if (packages === 'all') { await ctx.run(['update']); return; }
      const ranged = authorized.filter(item => item.version === undefined).map(item => item.name);
      for (const item of authorized) {
        if (item.version === undefined) continue;
        const declared = await ctx.workflow.inspect(item.name).then(state => state.declared, () => false);
        if (declared) await ctx.workflow.update(item.name, item.version);
        else await ctx.workflow.install(item.spec, undefined, undefined, { enable: false });
      }
      if (ranged.length) await ctx.run(['update', ...ranged]);
    });
  }

  /** {@link install} / {@link uninstall} / {@link update} as an async iterator of its events. */
  stream(operation: GatewayPackageOperation, packages: readonly unknown[] | 'all', options: GatewayInstallOptions): AsyncIterableIterator<GatewayPackageEvent> & { readonly result: Promise<GatewayPackageTransactionResult> } {
    return streamEvents<GatewayPackageEvent, GatewayPackageTransactionResult>(emit => {
      const forward = { ...options, onEvent: (event: GatewayPackageEvent) => { emit(event); options.onEvent?.(event); } };
      if (operation === 'update') return this.update(packages, forward);
      if (packages === 'all') return Promise.reject(new GatewayError('invalid_input', '只有 update 可以作用于全部依赖'));
      return operation === 'install' ? this.install(packages, forward) : this.uninstall(packages, forward);
    });
  }

  async #transaction(
    operation: GatewayPackageOperation,
    packages: readonly unknown[] | 'all',
    options: GatewayTransactionOptions,
    execute: (ctx: TransactionContext, authorized: readonly GatewayAuthorizedPackage[]) => Promise<void>,
  ): Promise<GatewayPackageTransactionResult> {
    if (this.#active) throw new GatewayError('conflict', '另一个依赖事务正在进行，请等待它结束');
    const id = randomUUID();
    this.#active = id;
    try {
      const authorized = await this.authorize(options.principal, operation, packages);
      const release = await this.#lock();
      try {
        return await this.#run(id, operation, authorized, options, execute);
      } finally {
        await release();
      }
    } finally {
      this.#active = undefined;
    }
  }

  async #run(
    id: string,
    operation: GatewayPackageOperation,
    authorized: readonly GatewayAuthorizedPackage[],
    options: GatewayTransactionOptions,
    execute: (ctx: TransactionContext, authorized: readonly GatewayAuthorizedPackage[]) => Promise<void>,
  ): Promise<GatewayPackageTransactionResult> {
    const now = this.#options.now ?? Date.now;
    const startedAt = now();
    const emit = (event: GatewayPackageEvent): void => {
      for (const listener of [options.onEvent, ...this.#listeners]) {
        try { listener?.(event); } catch { /* listeners never break a transaction */ }
      }
    };
    let phase: GatewayPackagePhase = 'snapshot';
    const enter = (next: GatewayPackagePhase): void => { phase = next; emit({ type: 'phase', id, phase: next }); };
    const detach = this.#relay.attach((stream, chunk) => emit({ type: 'output', id, stream, chunk }));
    const instance = this.#options.instance;
    const before = this.#instanceState();
    const wasRunning = instance !== undefined && RUNNING_STATES.has(instance.state);
    const startAfter = instance !== undefined && (options.startInstance ?? wasRunning);
    const run = (args: readonly string[]) => this.#packageManager(args, this.#root, this.#relay.output);
    let snapshot: ProjectFileSnapshot | undefined;
    let mutated = false;
    let status: GatewayPackageTransactionStatus = 'succeeded';
    let failedPhase: GatewayPackagePhase | undefined;
    let failure: unknown;
    let rollbackFailure: unknown;
    let logTail: readonly string[] | undefined;
    emit({ type: 'start', id, operation, packages: authorized });
    try {
      try {
        enter('snapshot');
        snapshot = await ProjectFileSnapshot.capture(this.#root);
        if (instance && instance.state !== 'stopped') {
          enter('stop-instance');
          await instance.stop({ reason: `packages:${operation}` });
        }
        enter('package-manager');
        mutated = true;
        await execute({ workflow: this.#workflow, run }, authorized);
        if (startAfter) {
          enter('start-instance');
          await this.#startInstance(instance!);
        }
      } catch (error) {
        failure = error;
        failedPhase = phase;
        if (error instanceof InstanceStartFailure) logTail = error.logTail;
        status = 'rolledBack';
        enter('rollback');
        try {
          // Stopping also cancels a pending automatic restart of the broken instance.
          if (instance && instance.state !== 'stopped') await instance.stop({ reason: 'packages:rollback' });
          if (mutated && snapshot) {
            enter('restore-files');
            await snapshot.restore();
            enter('reinstall');
            await run(snapshot.hasLockfile ? ['install', '--frozen-lockfile'] : ['install']);
          }
          if (wasRunning) {
            enter('restart-instance');
            await this.#startInstance(instance!);
          }
        } catch (error) {
          status = 'rollbackFailed';
          rollbackFailure = error;
        }
      }
      enter('done');
      const result: GatewayPackageTransactionResult = Object.freeze({
        id,
        operation,
        packages: authorized,
        ok: status === 'succeeded',
        status,
        ...(failedPhase ? { failedPhase } : {}),
        ...(failure === undefined ? {} : { error: failureMessage(failure) }),
        ...(rollbackFailure === undefined ? {} : { rollbackError: failureMessage(rollbackFailure) }),
        ...(logTail?.length ? { logTail } : {}),
        instance: Object.freeze({ before, after: this.#instanceState() }),
        startedAt,
        finishedAt: now(),
      });
      emit({ type: 'result', id, result });
      return result;
    } finally {
      detach();
    }
  }

  /** Starts the instance, waits for `ready` within the timeout, then for the stability window. */
  async #startInstance(instance: PackageTransactionInstance): Promise<void> {
    const readyTimeoutMs = this.#options.readyTimeoutMs ?? DEFAULT_PACKAGE_READY_TIMEOUT_MS;
    const stableMs = this.#options.stableMs ?? DEFAULT_PACKAGE_STABLE_MS;
    const tail = (): readonly string[] => {
      const failureTail = instance.status().lastFailure?.logTail;
      if (failureTail?.length) return failureTail;
      return Object.freeze((instance.logs?.tail(LOG_TAIL_LINES) ?? []).map(line => line.line));
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const starting = instance.start();
    starting.catch(() => undefined);
    try {
      await Promise.race([
        starting,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Instance did not become ready within ${readyTimeoutMs} ms`)), readyTimeoutMs);
        }),
      ]);
    } catch (error) {
      const failureTail = error instanceof InstanceStartError ? error.failure.logTail : [];
      throw new InstanceStartFailure(failureMessage(error), failureTail.length ? failureTail : tail());
    } finally {
      clearTimeout(timer);
    }
    if (stableMs <= 0) return;
    await new Promise<void>((resolvePromise, reject) => {
      const onFailure = (failure: InstanceFailure): void => {
        cleanup();
        reject(new InstanceStartFailure(`Instance failed after ready: ${failure.message}`, failure.logTail.length ? failure.logTail : tail()));
      };
      const cleanup = (): void => { clearTimeout(stable); instance.off('failure', onFailure); };
      const stable = setTimeout(() => {
        cleanup();
        if (instance.state === 'running') resolvePromise();
        else reject(new InstanceStartFailure(`Instance is ${instance.state} after ready`, tail()));
      }, stableMs);
      instance.on('failure', onFailure);
    });
  }

  #instanceState(): GatewayInstanceState | 'unmanaged' {
    return this.#options.instance?.state ?? 'unmanaged';
  }

  async #installedVersion(name: string): Promise<string | null> {
    try {
      const manifest = JSON.parse(await readFile(join(this.#root, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')) as { name?: unknown; version?: unknown };
      return manifest.name === name && typeof manifest.version === 'string' ? manifest.version : null;
    } catch { return null; }
  }

  /** Cross-process exclusion (CLI and gateway); separate from the workflow's own lock file. */
  async #lock(): Promise<() => Promise<void>> {
    const directory = join(this.#root, '.zhin');
    await mkdir(directory, { recursive: true });
    const file = join(directory, LOCK_FILE);
    let handle;
    try { handle = await open(file, 'wx', 0o600); }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      let detail = '另一进程正在执行依赖事务';
      try {
        const previous = JSON.parse(await readFile(file, 'utf8')) as { pid: number };
        try { process.kill(previous.pid, 0); }
        catch (probe) { if (probe instanceof Error && 'code' in probe && probe.code === 'ESRCH') detail = `上一次依赖事务进程 ${previous.pid} 已退出；确认没有安装进程后删除 ${file} 再重试`; }
      } catch { /* an incomplete lock is not safe to take over */ }
      throw new GatewayError('conflict', detail, { cause: error });
    }
    const marker = JSON.stringify({ pid: process.pid, nonce: randomUUID() });
    try { await handle.writeFile(marker); }
    catch (error) { await handle.close(); await rm(file, { force: true }); throw error; }
    return async () => {
      await handle.close();
      if (await readFile(file, 'utf8').catch(() => '') === marker) await rm(file, { force: true });
    };
  }
}

/** The workflow's own error says files were not rolled back; the gateway does roll back, so report the cause. */
function failureMessage(error: unknown): string {
  const cause = error instanceof PluginManagementOperationError ? error.cause : error;
  return cause instanceof Error ? cause.message : String(cause);
}
