/**
 * Dependency transactions of the management gateway (ADR 0054 §4): one at a time, the instance
 * stopped while the package manager runs, and a failed install / uninstall / update rolled back
 * to the captured project files and lockfile with the old instance started again.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type {
  GatewayAuthorizedPackage,
  GatewayInstalledPackage,
  GatewayInstalledPackageKind,
  GatewayInstanceState,
  GatewayPackageEvent,
  GatewayPackageList,
  GatewayPackageOperation,
  GatewayPackagePhase,
  GatewayPackagePlan,
  GatewayPackageTransactionResult,
  GatewayPackageTransactionStatus,
  GatewayPluginConfigurationNeed,
  GatewayPluginEnablement,
  GatewayPluginRestartReason,
  GatewayTransactionOperation,
} from '@zhin.js/console-protocol';
import { CONSOLE_PERMISSIONS } from '@zhin.js/console-protocol';
import { createInstallAllowlist, type InstallAllowlist, type MarketCatalogEntry } from '../onboarding/allowlist.js';
import { InstallOutputRelay, streamEvents } from '../onboarding/install.js';
import { createStreamingPackageManager, detectPackageManager, type PackageManagerOutput } from '../onboarding/package-manager.js';
import { dependenciesInPlace, IGNORED_BUILDS_OUTPUT_LIMIT, parseIgnoredBuilds } from '../onboarding/ignored-builds.js';
import { PluginDeclarationError, PluginEnablementError, PluginManagementOperationError, PluginManagementWorkflow, type PluginManagementOptions } from '../plugin-management/workflow.js';
import { InstanceStartError, type InstanceFailure, type InstancePluginApplyResult, type InstanceState, type InstanceStatus, type InstanceStopOptions } from '../supervisor/instance-supervisor.js';
import type { InstanceLogLine } from '../supervisor/instance-logs.js';
import { authorizePackages, gatewayPrincipalAllows, type GatewayPackageAction, type GatewayPrincipal } from './authorization.js';
import { GatewayError } from './errors.js';
import { declaredDependencyNames } from './declared.js';
import { ProjectFileSnapshot } from './snapshot.js';
import { formatOverrideChanges, isZhinPackageName, pinZhinOverrides, readZhinOverrides, releaseZhinOverrides } from '../plugin-management/zhin-overrides.js';

/** The part of `InstanceSupervisor` a transaction drives. */
export interface PackageTransactionInstance {
  readonly state: InstanceState;
  start(): Promise<void>;
  stop(options?: InstanceStopOptions): Promise<void>;
  status(): InstanceStatus;
  on(event: 'failure', listener: (failure: InstanceFailure) => void): unknown;
  off(event: 'failure', listener: (failure: InstanceFailure) => void): unknown;
  readonly logs?: { tail(limit?: number): readonly InstanceLogLine[] };
  /** The running instance applies plugin enable / disable in place (zhinjs/zhin#1250). */
  readonly supportsPluginApply?: boolean;
  /** Applies an enable / disable already written to the configuration, without a restart. */
  applyPlugin?(request: { readonly instanceKey: string; readonly enabled: boolean; readonly revision: string }): Promise<InstancePluginApplyResult>;
}

/** The part of `PluginManagementWorkflow` (`PluginManagementPort`) a transaction uses. */
export interface PackageWorkflowPort {
  inspect(request: string): Promise<{ readonly declared: boolean }>;
  install(spec: string, expectedRevision?: string, expectedProjectRevision?: string, options?: { readonly enable?: boolean }): Promise<unknown>;
  uninstall(request: string, expectedRevision?: string, expectedProjectRevision?: string, options?: { readonly removeDependency?: boolean }): Promise<unknown>;
  update(request: string, targetVersion: string): Promise<unknown>;
  /** Validates a declaration without writing (throws `PluginDeclarationError`). */
  planDeclaration?(request: string, config?: unknown, options?: { readonly instanceKey?: string }): Promise<unknown>;
  declare?(request: string, config?: unknown, options?: { readonly instanceKey?: string }): Promise<unknown>;
  /** Validates an enable / disable without writing (throws `PluginEnablementError`). */
  planSetEnabled?(request: string, enabled: boolean): Promise<{ readonly packageName: string; readonly instanceKey: string; readonly changed: boolean }>;
  /** Resolves with `{ revision }` (the configuration revision after the write) when it wrote. */
  setEnabled?(request: string, enabled: boolean): Promise<unknown>;
  /** Why toggling this instance in a running instance must restart it; `undefined` → in place. */
  hotToggleBlocker?(instanceKey: string, startedAt?: number): Promise<{ readonly reason: GatewayPluginRestartReason; readonly detail: string } | undefined>;
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
  /**
   * Time the instance gets to report `ready` after a transaction. Default 60 s
   * (`gateway.readyTimeout`). A function is read at each start, after {@link beforeTransaction}.
   */
  readonly readyTimeoutMs?: number | (() => number | undefined);
  /** Runs at the start of every transaction (the gateway re-reads `gateway.readyTimeout`). */
  readonly beforeTransaction?: () => Promise<void>;
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

export interface GatewayDeclareRequest {
  readonly package: unknown;
  readonly instanceKey?: unknown;
  readonly config?: unknown;
}

export interface GatewaySetEnabledRequest {
  /** A declared instance key, or the package name of a package declared exactly once. */
  readonly plugin: unknown;
}

export const DEFAULT_PACKAGE_READY_TIMEOUT_MS = 60_000;
export const DEFAULT_PACKAGE_STABLE_MS = 5_000;
const LOCK_FILE = 'gateway-packages.lock';
const LOG_TAIL_LINES = 50;
const RUNNING_STATES: ReadonlySet<InstanceState> = new Set(['running', 'starting', 'backoff']);

/** Fields a successful transaction adds to its result. */
interface TransactionExtras {
  readonly needsConfiguration?: readonly GatewayPluginConfigurationNeed[];
  readonly plugin?: GatewayPluginEnablement;
}

/** Transactions that only write the configuration file: no package manager, no reinstall on rollback. */
const CONFIG_ONLY_OPERATIONS: ReadonlySet<GatewayTransactionOperation> = new Set(['declare', 'enable', 'disable']);

type TransactionBody = (ctx: TransactionContext, authorized: readonly GatewayAuthorizedPackage[]) => Promise<TransactionExtras | void>;

/**
 * A plugin enable / disable that a running instance may apply in place (zhinjs/zhin#1250): the
 * transaction writes the configuration without stopping the instance, then asks it to apply.
 * Any reason to restart — decided before the write ({@link check}) or reported by the instance —
 * falls back to stop → start, with the usual rollback when the instance does not come up.
 */
interface HotPluginApply {
  readonly instanceKey: string;
  readonly enabled: boolean;
  check(): Promise<{ readonly reason: GatewayPluginRestartReason; readonly detail: string } | undefined>;
  /** The configuration revision the body wrote. */
  revision(): string | undefined;
}

const MAX_RESTART_DETAIL = 512;

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
  /** Packages whose build scripts pnpm skipped during the running transaction (#1250). */
  #ignoredBuilds: Set<string> | undefined;

  constructor(options: GatewayPackageServiceOptions) {
    this.#root = resolve(options.projectRoot);
    this.#options = options;
    const streaming = createStreamingPackageManager(this.#relay.output);
    this.#packageManager = this.#tolerateIgnoredBuilds(options.packageManager ?? ((args, root) => streaming(args, root)));
    this.#workflow = options.workflow ?? new PluginManagementWorkflow(this.#root, {
      ...options.workflowOptions,
      installDependencies: (args, root) => this.#packageManager(args, root, this.#relay.output),
    });
  }

  /**
   * pnpm 11 exits 1 with `ERR_PNPM_IGNORED_BUILDS` after a complete install whose dependency build
   * scripts were not allowed. With the dependencies in place that exit is recorded (reported as
   * `ignoredBuilds` with an allowBuilds hint) instead of failing — and rolling back — the transaction.
   */
  #tolerateIgnoredBuilds(manager: GatewayPackageManager): GatewayPackageManager {
    return async (args, root, output) => {
      let captured = '';
      const tee: PackageManagerOutput = (stream, chunk) => {
        captured = (captured + chunk).slice(-IGNORED_BUILDS_OUTPUT_LIMIT);
        output(stream, chunk);
      };
      try {
        await manager(args, root, tee);
      } catch (error) {
        const detail = error && typeof error === 'object'
          ? ['message', 'stdout', 'stderr'].map(key => Reflect.get(error, key)).filter((value): value is string => typeof value === 'string').join('\n')
          : String(error);
        const ignored = parseIgnoredBuilds(`${captured}\n${detail}`);
        if (!ignored || !await dependenciesInPlace(root, args)) throw error;
        this.#ignoredBuilds ??= new Set();
        for (const name of ignored) this.#ignoredBuilds.add(name);
      }
    };
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
    return this.inventory();
  }

  /**
   * {@link list} without authorization, for gateway services that authorize on their own (the
   * version check, `status.view`). Never hand its result to a caller that was not authorized.
   */
  async inventory(): Promise<GatewayPackageList> {
    const manifest = JSON.parse(await readFile(join(this.#root, 'package.json'), 'utf8')) as Record<string, unknown>;
    const allowlist = await this.allowlist();
    const packages: GatewayInstalledPackage[] = [];
    for (const dependencyType of ['dependencies', 'optionalDependencies', 'devDependencies'] as const) {
      const entries = manifest[dependencyType];
      if (!entries || typeof entries !== 'object') continue;
      for (const [name, range] of Object.entries(entries as Record<string, unknown>)) {
        if (typeof range !== 'string') continue;
        const catalog = allowlist.get(name)?.kind;
        const installed = await this.#installedManifest(name);
        packages.push(Object.freeze({
          name, range, dependencyType, installedVersion: installed?.version ?? null,
          ...(installed ? { kind: installed.kind } : {}),
          ...(catalog ? { catalog } : {}),
        }));
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
      const needs: GatewayPluginConfigurationNeed[] = [];
      for (const item of authorized) {
        const need = configurationNeed(await ctx.workflow.install(item.spec, undefined, undefined, { enable: options.enable !== false }));
        if (need) needs.push(need);
      }
      return needs.length ? { needsConfiguration: Object.freeze(needs) } : undefined;
    });
  }

  /**
   * `gateway.plugins.declare`: declares an installed plugin with its first configuration (schema
   * validated before the instance is touched), then restarts the instance; a failed start rolls
   * the configuration file back and starts the previous instance again.
   */
  async declare(request: GatewayDeclareRequest, options: GatewayTransactionOptions): Promise<GatewayPackageTransactionResult> {
    const workflow = this.#workflow;
    if (!workflow.planDeclaration || !workflow.declare) throw new GatewayError('unavailable', '插件声明不可用');
    if (typeof request.package !== 'string') throw new GatewayError('invalid_input', 'package 必须是包名');
    if (request.instanceKey !== undefined && typeof request.instanceKey !== 'string') throw new GatewayError('invalid_input', 'instanceKey 必须是字符串');
    const config = request.config ?? {};
    const declareOptions = request.instanceKey === undefined ? {} : { instanceKey: request.instanceKey };
    // Authorization first, then validation: nothing is stopped for a request that cannot succeed.
    await this.authorize(options.principal, 'declare', [request.package]);
    try { await workflow.planDeclaration(request.package, config, declareOptions); }
    catch (error) { throw declarationError(error); }
    return this.#transaction('declare', [request.package], options, async (ctx, authorized) => {
      await ctx.workflow.declare!(authorized[0]!.name, config, declareOptions);
    });
  }

  /**
   * `gateway.plugins.enable` / `gateway.plugins.disable`: rewrites `disable_plugins` for one
   * declared instance, then restarts the instance (a failed start restores the configuration file
   * and starts the previous instance again). Validation runs before the instance is touched; an
   * instance already in the requested state succeeds without stopping anything or writing.
   */
  async setEnabled(request: GatewaySetEnabledRequest, enabled: boolean, options: GatewayTransactionOptions): Promise<GatewayPackageTransactionResult> {
    const workflow = this.#workflow;
    if (!workflow.planSetEnabled || !workflow.setEnabled) throw new GatewayError('unavailable', '插件启停不可用');
    const operation = enabled ? 'enable' : 'disable';
    // Permission before anything about the project is read.
    if (!options.principal || options.principal !== 'local' && options.principal.kind === 'bootstrap'
      || !gatewayPrincipalAllows(options.principal, CONSOLE_PERMISSIONS.PLUGIN_MANAGE)) {
      throw new GatewayError('forbidden', `需要 ${CONSOLE_PERMISSIONS.PLUGIN_MANAGE} 权限`);
    }
    if (typeof request.plugin !== 'string' || !request.plugin.trim() || request.plugin.length > 256) {
      throw new GatewayError('invalid_input', 'plugin 必须是插件包名或 instanceKey');
    }
    let plan: { readonly packageName: string; readonly instanceKey: string; readonly changed: boolean };
    try { plan = await workflow.planSetEnabled(request.plugin, enabled); }
    catch (error) { throw enablementError(error); }
    const plugin: GatewayPluginEnablement = Object.freeze({ instanceKey: plan.instanceKey, packageName: plan.packageName, enabled, changed: plan.changed });
    if (!plan.changed) return this.#unchanged(operation, await this.authorize(options.principal, operation, [plan.packageName]), Object.freeze({ ...plugin, apply: 'none' as const }), options);
    let revision: string | undefined;
    const hot: HotPluginApply = {
      instanceKey: plan.instanceKey,
      enabled,
      check: async () => {
        const instance = this.#options.instance;
        if (!instance?.applyPlugin || !instance.supportsPluginApply) {
          return { reason: 'instance-unsupported', detail: '运行中的实例不支持热启停插件（zhin.js 版本较旧），改为重启实例' };
        }
        return workflow.hotToggleBlocker?.(plan.instanceKey, instance.status().startedAt);
      },
      revision: () => revision,
    };
    return this.#transaction(operation, [plan.packageName], options, async (ctx) => {
      // The exact instance key: the declaration may not be re-resolved to another instance.
      const written = await ctx.workflow.setEnabled!(plan.instanceKey, enabled);
      const value = written && typeof written === 'object' ? (written as { readonly revision?: unknown }).revision : undefined;
      revision = typeof value === 'string' ? value : undefined;
      return { plugin };
    }, hot);
  }

  /** The result of an enable / disable that found nothing to change (instance untouched). */
  #unchanged(operation: GatewayTransactionOperation, authorized: readonly GatewayAuthorizedPackage[], plugin: GatewayPluginEnablement, options: GatewayTransactionOptions): GatewayPackageTransactionResult {
    const now = (this.#options.now ?? Date.now)();
    const id = randomUUID();
    const state = this.#instanceState();
    const result: GatewayPackageTransactionResult = Object.freeze({
      id, operation, packages: authorized, ok: true, status: 'succeeded' as const, plugin,
      instance: Object.freeze({ before: state, after: state }), startedAt: now, finishedAt: now,
    });
    for (const event of [{ type: 'start', id, operation, packages: authorized }, { type: 'phase', id, phase: 'done' }, { type: 'result', id, result }] as GatewayPackageEvent[]) {
      for (const listener of [options.onEvent, ...this.#listeners]) {
        try { listener?.(event); } catch { /* listeners never break a request */ }
      }
    }
    return result;
  }

  uninstall(packages: readonly unknown[], options: GatewayUninstallOptions): Promise<GatewayPackageTransactionResult> {
    return this.#transaction('uninstall', packages, options, async (ctx, authorized) => {
      for (const item of authorized) {
        if (options.removeDependency === false) await ctx.workflow.uninstall(item.name, undefined, undefined, { removeDependency: false });
        else await ctx.workflow.uninstall(item.name);
      }
    });
  }

  /**
   * Exact versions go through the workflow (verified); bare names / `'all'` run the manager's update.
   * In a pnpm workspace (`pnpm-workspace.yaml` lists `packages`) the manager's update runs with `-r`,
   * so local workspace packages (e.g. `plugins/*`) move with the root (#1250).
   */
  update(packages: readonly unknown[] | 'all', options: GatewayTransactionOptions): Promise<GatewayPackageTransactionResult> {
    // #1250: a bare name nobody declares would "succeed" without changing anything; refused
    // before the instance is stopped. Exact versions of undeclared names still install (below).
    const precheck = packages === 'all' ? undefined : async (authorized: readonly GatewayAuthorizedPackage[]) => {
      const declared = await declaredDependencyNames(this.#root);
      const unknown = authorized.filter(item => item.version === undefined && !declared.has(item.name)).map(item => item.name);
      if (unknown.length) {
        throw new GatewayError('invalid_input', `${unknown.join(', ')} 不是本项目的依赖，没有可更新的内容；安装请用 zhin install ${unknown.join(' ')}`);
      }
    };
    return this.#transaction('update', packages, options, async (ctx, authorized) => {
      const recursive = await isPnpmWorkspace(this.#root) ? ['-r'] : [];
      // #1250 update-overrides-not-synced: pnpm overrides that pin Zhin packages move with them.
      // Only pnpm reads `pnpm.overrides` / pnpm-workspace.yaml: other managers leave them alone.
      const overrides = (packages === 'all' || authorized.some(item => isZhinPackageName(item.name)))
        && await detectPackageManager(this.#root) === 'pnpm'
        ? readZhinOverrides(this.#root)
        : undefined;
      const syncing = overrides?.entries.some(entry => entry.class.kind === 'sync') === true;
      const release = overrides && syncing ? await releaseZhinOverrides(this.#root, overrides) : undefined;
      if (packages === 'all') await ctx.run(['update', ...recursive]);
      else {
        const ranged = authorized.filter(item => item.version === undefined).map(item => item.name);
        for (const item of authorized) {
          if (item.version === undefined) continue;
          const declared = await ctx.workflow.inspect(item.name).then(state => state.declared, () => false);
          if (declared) await ctx.workflow.update(item.name, item.version);
          else await ctx.workflow.install(item.spec, undefined, undefined, { enable: false });
        }
        if (ranged.length) await ctx.run(['update', ...recursive, ...ranged]);
      }
      if (!overrides?.entries.length) return;
      const say = (line: string, stream: 'stdout' | 'stderr' = 'stdout') => this.#relay.output(stream, `${line}\n`);
      // `name@x.y.z` the user asked for: an override must not pin it back (#1250).
      const requested = packages === 'all' ? [] : authorized.flatMap(item => item.version !== undefined && isZhinPackageName(item.name) ? [{ name: item.name, version: item.version }] : []);
      const synced = await pinZhinOverrides(this.#root, overrides, { ...(release ? { release } : {}), requested });
      for (const line of formatOverrideChanges(synced.changes)) say(`同步 overrides：${line}`);
      for (const line of synced.manual) say(line, 'stderr');
      if (!syncing || !synced.written) return;
      // The update ran without the released overrides: install once with them for the lockfile.
      // The lockfile changes on purpose, so a CI environment's frozen lockfile must not refuse it.
      await ctx.run(['install', '--no-frozen-lockfile']);
      // What the reinstall actually resolved: a request the overrides moved fails (and rolls back).
      for (const item of requested) {
        const installed = await this.#installedManifest(item.name);
        if (installed?.version !== item.version) {
          throw new GatewayError('conflict', `${item.name} 请求的是 ${item.version}，同步 overrides 并重装后实际安装的是 ${installed?.version ?? '（未安装）'}；已回滚。请检查 package.json 的 pnpm.overrides 与 pnpm-workspace.yaml 的 overrides 中关于 ${item.name} 的条目，或改为升级 zhin.js`);
        }
      }
    }, undefined, precheck);
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
    operation: GatewayTransactionOperation,
    packages: readonly unknown[] | 'all',
    options: GatewayTransactionOptions,
    execute: TransactionBody,
    hot?: HotPluginApply,
    /** Runs after authorization, before the lock and the instance stop; a throw changes nothing. */
    precheck?: (authorized: readonly GatewayAuthorizedPackage[]) => Promise<void>,
  ): Promise<GatewayPackageTransactionResult> {
    if (this.#active) throw new GatewayError('conflict', '另一个依赖事务正在进行，请等待它结束');
    const id = randomUUID();
    this.#active = id;
    try {
      const authorized = await this.authorize(options.principal, operation, packages);
      await precheck?.(authorized);
      const release = await this.#lock();
      try {
        await this.#options.beforeTransaction?.().catch(() => undefined);
        return await this.#run(id, operation, authorized, options, execute, hot);
      } finally {
        await release();
      }
    } finally {
      this.#active = undefined;
    }
  }

  async #run(
    id: string,
    operation: GatewayTransactionOperation,
    authorized: readonly GatewayAuthorizedPackage[],
    options: GatewayTransactionOptions,
    execute: TransactionBody,
    hot?: HotPluginApply,
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
    // Rollback log tails only show what this transaction's instances printed.
    const logMark = instance?.logs?.tail(1).at(-1)?.seq ?? -1;
    // A declaration only writes the configuration file: no package manager, no reinstall on rollback.
    const configOnly = CONFIG_ONLY_OPERATIONS.has(operation);
    let extras: TransactionExtras | void = undefined;
    let snapshot: ProjectFileSnapshot | undefined;
    let mutated = false;
    let status: GatewayPackageTransactionStatus = 'succeeded';
    let failedPhase: GatewayPackagePhase | undefined;
    let failure: unknown;
    let rollbackFailure: unknown;
    let restartFailure: unknown;
    let logTail: readonly string[] | undefined;
    // Hot plugin enable / disable (#1250): how the change took effect, and why it restarted.
    let applyMode: GatewayPluginEnablement['apply'] = wasRunning || startAfter ? 'restart' : 'none';
    let restart: { reason: GatewayPluginRestartReason; detail: string } | undefined;
    // True while an in-place apply has left the running instance alone: a failure then only
    // restores the files; the instance keeps (or never left) its previous generation.
    let untouched = false;
    this.#ignoredBuilds = undefined;
    emit({ type: 'start', id, operation, packages: authorized });
    try {
      try {
        enter('snapshot');
        snapshot = await ProjectFileSnapshot.capture(this.#root);
        // Decided before the write: a plugin that must restart never runs the in-place attempt.
        let inPlace = false;
        if (hot && instance && wasRunning && instance.state === 'running') {
          restart = await hot.check().catch((error: unknown) => ({ reason: 'hot-apply-failed' as const, detail: failureMessage(error) }));
          inPlace = restart === undefined;
          untouched = inPlace;
        }
        if (!inPlace && instance && instance.state !== 'stopped') {
          enter('stop-instance');
          await instance.stop({ reason: `packages:${operation}` });
        }
        enter(configOnly ? 'configure' : 'package-manager');
        mutated = true;
        extras = await execute({ workflow: this.#workflow, run }, authorized);
        if (inPlace) {
          enter('apply-hot');
          const outcome = await this.#applyHot(instance!, hot!);
          if (outcome) {
            // Fall back to stop → start on the written configuration; a failed start rolls back.
            restart = outcome;
            untouched = false;
            enter('stop-instance');
            await instance!.stop({ reason: `packages:${operation}:hot-fallback` });
            enter('start-instance');
            await this.#startInstance(instance!, logMark);
          } else applyMode = 'hot';
        } else if (startAfter) {
          enter('start-instance');
          await this.#startInstance(instance!, logMark);
        }
      } catch (error) {
        failure = error;
        failedPhase = phase;
        if (error instanceof InstanceStartFailure) logTail = error.logTail;
        status = 'rolledBack';
        enter('rollback');
        try {
          // Stopping also cancels a pending automatic restart of the broken instance.
          if (!untouched && instance && instance.state !== 'stopped') await instance.stop({ reason: 'packages:rollback' });
          if (mutated && snapshot) {
            enter('restore-files');
            await snapshot.restore();
            if (!configOnly) {
              enter('reinstall');
              await run(snapshot.hasLockfile ? ['install', '--frozen-lockfile'] : ['install']);
            }
          }
        } catch (error) {
          status = 'rollbackFailed';
          rollbackFailure = error;
        }
        // A running instance is brought back even when restoring the files or dependencies failed
        // (#1250): leaving the bot stopped is worse than starting it on what is on disk. A failed
        // start is reported on its own.
        if (wasRunning && !untouched) {
          enter('restart-instance');
          try {
            await this.#startInstance(instance!, logMark);
          } catch (error) {
            status = 'rollbackFailed';
            restartFailure = error;
            if (error instanceof InstanceStartFailure && !logTail?.length) logTail = error.logTail;
          }
        }
      }
      enter('done');
      const ignoredBuilds = this.#ignoredBuilds ? Object.freeze([...this.#ignoredBuilds]) : undefined;
      const result: GatewayPackageTransactionResult = Object.freeze({
        id,
        operation,
        packages: authorized,
        ok: status === 'succeeded',
        status,
        ...(failedPhase ? { failedPhase } : {}),
        ...(failure === undefined ? {} : { error: failureMessage(failure), ...declarationDetails(failure) }),
        ...(rollbackFailure === undefined ? {} : { rollbackError: failureMessage(rollbackFailure) }),
        ...(restartFailure === undefined ? {} : { restartError: failureMessage(restartFailure) }),
        ...(ignoredBuilds ? { ignoredBuilds } : {}),
        ...(logTail?.length ? { logTail } : {}),
        ...(status === 'succeeded' && extras?.needsConfiguration?.length ? { needsConfiguration: extras.needsConfiguration } : {}),
        ...(status === 'succeeded' && extras?.plugin ? { plugin: Object.freeze({
          ...extras.plugin, apply: applyMode,
          ...(applyMode === 'restart' && restart ? { restartReason: restart.reason, restartDetail: restart.detail.slice(0, MAX_RESTART_DETAIL) } : {}),
        }) } : {}),
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

  /**
   * Asks the running instance to apply the written enable / disable. `undefined` when the committed
   * generation has it; otherwise why the transaction falls back to a restart.
   */
  async #applyHot(instance: PackageTransactionInstance, hot: HotPluginApply): Promise<{ reason: GatewayPluginRestartReason; detail: string } | undefined> {
    const revision = hot.revision();
    if (revision === undefined) return { reason: 'hot-apply-failed', detail: '未取得写入后的配置修订，无法确认热应用' };
    let outcome: InstancePluginApplyResult;
    try {
      outcome = await instance.applyPlugin!({ instanceKey: hot.instanceKey, enabled: hot.enabled, revision });
    } catch (error) {
      return { reason: 'hot-apply-failed', detail: `热应用失败，改为重启实例：${failureMessage(error)}` };
    }
    if (outcome.outcome === 'applied') return undefined;
    if (outcome.outcome === 'unsupported') return { reason: 'instance-unsupported', detail: '运行中的实例不支持热启停插件，改为重启实例' };
    if (outcome.outcome === 'restart-required') {
      return { reason: 'runtime-requires-restart', detail: `实例要求重启才能生效（${(outcome.reasons ?? []).join('、') || '未说明原因'}）` };
    }
    return { reason: 'hot-apply-failed', detail: `热应用失败，改为重启实例：${outcome.message ?? '未知错误'}` };
  }

  /** Starts the instance, waits for `ready` within the timeout, then for the stability window. */
  async #startInstance(instance: PackageTransactionInstance, logMark: number): Promise<void> {
    const configured = this.#options.readyTimeoutMs;
    const readyTimeoutMs = (typeof configured === 'function' ? configured() : configured) ?? DEFAULT_PACKAGE_READY_TIMEOUT_MS;
    const stableMs = this.#options.stableMs ?? DEFAULT_PACKAGE_STABLE_MS;
    // With the log collector, only lines captured since the transaction started (the supervisor's
    // failure tail also holds earlier runs); without it, the failure's own tail.
    const tail = (fallback?: readonly string[]): readonly string[] => {
      if (instance.logs) {
        return Object.freeze(instance.logs.tail().filter(line => line.seq > logMark).slice(-LOG_TAIL_LINES).map(line => line.line));
      }
      const failureTail = fallback?.length ? fallback : instance.status().lastFailure?.logTail;
      return Object.freeze([...(failureTail ?? [])]);
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
      throw new InstanceStartFailure(failureMessage(error), tail(error instanceof InstanceStartError ? error.failure.logTail : undefined));
    } finally {
      clearTimeout(timer);
    }
    if (stableMs <= 0) return;
    await new Promise<void>((resolvePromise, reject) => {
      const onFailure = (failure: InstanceFailure): void => {
        cleanup();
        reject(new InstanceStartFailure(`Instance failed after ready: ${failure.message}`, tail(failure.logTail)));
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

  /**
   * Installed version plus what the package is to Zhin (#1250): `package.json#zhin.type` `plugin`
   * → `plugin`, `feature` → `feature`, no `zhin` manifest → `library`. Undefined when not installed.
   */
  async #installedManifest(name: string): Promise<{ version: string; kind: GatewayInstalledPackageKind } | undefined> {
    try {
      const manifest = JSON.parse(await readFile(join(this.#root, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')) as { name?: unknown; version?: unknown; zhin?: unknown };
      if (manifest.name !== name || typeof manifest.version !== 'string') return undefined;
      return { version: manifest.version, kind: installedPackageKind(manifest.zhin) };
    } catch { return undefined; }
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

/** Reads the configuration need a workflow `install` result reports, if any. */
function configurationNeed(result: unknown): GatewayPluginConfigurationNeed | undefined {
  const need = (result as { needsConfiguration?: unknown } | undefined)?.needsConfiguration as Partial<GatewayPluginConfigurationNeed> | undefined;
  if (!need || typeof need.name !== 'string' || typeof need.instanceKey !== 'string') return undefined;
  const strings = (value: unknown) => Object.freeze(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
  return Object.freeze({ name: need.name, instanceKey: need.instanceKey, missing: strings(need.missing), missingEnv: strings(need.missingEnv) });
}

/** A refused declaration is the caller's input problem; anything else stays internal. */
function declarationError(error: unknown): unknown {
  return error instanceof PluginDeclarationError
    ? new GatewayError('invalid_input', error.message, { cause: error, details: { errors: error.errors, missingEnv: error.missingEnv } })
    : error;
}

/** A refused enable / disable is the caller's input problem; anything else stays internal. */
function enablementError(error: unknown): unknown {
  return error instanceof PluginEnablementError
    ? new GatewayError('invalid_input', error.message, { cause: error, details: { errors: error.errors, missingEnv: error.missingEnv } })
    : error;
}

/** Structured feedback of a declaration refused inside the transaction (config changed after preflight). */
function declarationDetails(error: unknown): { errors?: PluginDeclarationError['errors']; missingEnv?: PluginDeclarationError['missingEnv'] } {
  const cause = error instanceof PluginManagementOperationError ? error.cause : error;
  if (!(cause instanceof PluginDeclarationError) && !(cause instanceof PluginEnablementError)) return {};
  return {
    ...(cause.errors?.length ? { errors: cause.errors } : {}),
    ...(cause.missingEnv?.length ? { missingEnv: cause.missingEnv } : {}),
  };
}

/** The workflow's own error says files were not rolled back; the gateway does roll back, so report the cause. */
function failureMessage(error: unknown): string {
  const cause = error instanceof PluginManagementOperationError ? error.cause : error;
  return cause instanceof Error ? cause.message : String(cause);
}

/** `package.json#zhin` → what the dependency is to Zhin; anything without a Zhin manifest is a library. */
export function installedPackageKind(zhin: unknown): GatewayInstalledPackageKind {
  if (!zhin || typeof zhin !== 'object' || Array.isArray(zhin)) return 'library';
  const type = (zhin as { type?: unknown }).type;
  return type === 'plugin' ? 'plugin' : type === 'feature' ? 'feature' : 'library';
}

/** Whether `root` is a pnpm workspace with member packages (`pnpm-workspace.yaml#packages` non-empty). */
async function isPnpmWorkspace(root: string): Promise<boolean> {
  try {
    const parsed = parseYaml(await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8')) as { packages?: unknown } | null;
    return Array.isArray(parsed?.packages) && parsed.packages.some(entry => typeof entry === 'string' && entry.trim() !== '');
  } catch {
    return false;
  }
}
