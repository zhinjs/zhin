import { resolve } from 'node:path';
import type { ConsolePrincipal } from '@zhin.js/host-http';
import { CONSOLE_PERMISSIONS, grantsAllow } from '@zhin.js/console-protocol';
import { loadProjectConfig } from '@zhin.js/scaffold-wizard';
import { PluginManagementWorkflow, type PluginManagementOptions } from '../plugin-management/workflow.js';
import {
  authorizeInstall,
  createInstallAllowlist,
  type InstallAllowlist,
  type InstallPrincipal,
  type MarketCatalogEntry,
} from './allowlist.js';
import { OnboardingError } from './errors.js';
import {
  InstallOutputRelay,
  installPackages,
  streamEvents,
  type InstallEvent,
  type InstallListener,
  type InstallReport,
  type PackageInstallPort,
} from './install.js';
import { createStreamingPackageManager } from './package-manager.js';
import {
  applyDetection,
  detectConfiguredSteps,
  emptyOnboardingState,
  OnboardingStateStore,
  ONBOARDING_STEPS,
  type OnboardingState,
  type OnboardingStep,
  type OnboardingStepStatus,
} from './state-store.js';

export interface OnboardingStatus extends OnboardingState {
  /** True until `complete()` ran. */
  readonly required: boolean;
}

export interface OnboardingServiceOptions {
  readonly projectRoot: string;
  /** True once an enabled global owner exists (IAM). */
  readonly hasOwner: () => boolean | Promise<boolean>;
  /** Root config document used for auto-detection; defaults to the project's YAML/JSON config. */
  readonly readConfig?: () => Readonly<Record<string, unknown>> | Promise<Readonly<Record<string, unknown>>>;
  readonly store?: OnboardingStateStore;
  /** Plugin-market entries joining the install allowlist (re-read on every install). */
  readonly marketCatalog?: () => readonly MarketCatalogEntry[] | Promise<readonly MarketCatalogEntry[]>;
  /**
   * Installation port; defaults to a `PluginManagementWorkflow` on the project root whose
   * package manager streams through `relay`.
   */
  readonly installer?: PackageInstallPort;
  /** Options for the default workflow (activity guard, snapshots, restart request). */
  readonly workflow?: Omit<PluginManagementOptions, 'installDependencies'>;
  readonly now?: () => Date;
}

export interface MarkStepOptions {
  /** When given (Web / RPC), the step's credential rule is enforced; the CLI is trusted locally. */
  readonly principal?: ConsolePrincipal;
}

const OPTIONAL_STEPS: ReadonlySet<OnboardingStep> = new Set(['database', 'ai', 'adapters']);

/** Permissions a step needs besides `plugin.manage` (ADR 0053 §2). */
const STEP_PERMISSIONS: Readonly<Partial<Record<OnboardingStep, string>>> = Object.freeze({
  ai: CONSOLE_PERMISSIONS.AGENT_CONFIGURE,
  adapters: CONSOLE_PERMISSIONS.ENDPOINT_MANAGE,
});

/**
 * The one onboarding service (ADR 0053 §2/§5): Console and `zhin setup` / `zhin console init`
 * call the same methods. Transport-independent; routes / RPC wrap it.
 */
export class OnboardingService {
  readonly #options: OnboardingServiceOptions;
  readonly #store: OnboardingStateStore;
  readonly relay = new InstallOutputRelay();
  #installer: PackageInstallPort | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  // Installs queue separately so status reads are not blocked by a long install.
  #installQueue: Promise<unknown> = Promise.resolve();

  constructor(options: OnboardingServiceOptions) {
    this.#options = options;
    this.#store = options.store ?? new OnboardingStateStore(options.projectRoot);
    this.#installer = options.installer;
  }

  /** Serializes state read-modify-write cycles within this process. */
  #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(operation, operation);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  #exclusiveInstall<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#installQueue.then(operation, operation);
    this.#installQueue = next.catch(() => undefined);
    return next;
  }

  async #readConfig(): Promise<Readonly<Record<string, unknown>>> {
    if (this.#options.readConfig) return this.#options.readConfig();
    const loaded = loadProjectConfig(resolve(this.#options.projectRoot));
    return loaded.status === 'loaded' ? loaded.config : {};
  }

  /** Stored state with auto-detection applied; persisted only when detection changed it. */
  async #current(): Promise<OnboardingState> {
    const stored = await this.#store.read();
    const detected = new Set(detectConfiguredSteps(await this.#readConfig()));
    if (await this.#options.hasOwner()) detected.add('owner');
    const next = applyDetection(stored ?? emptyOnboardingState(), detected);
    if (!stored || next !== stored) await this.#store.write(next);
    return next;
  }

  #view(state: OnboardingState): OnboardingStatus {
    return Object.freeze({ ...state, required: !state.completedAt });
  }

  status(): Promise<OnboardingStatus> {
    return this.#exclusive(async () => this.#view(await this.#current()));
  }

  /** Marks database / ai / adapters as done or skipped. The owner step is derived from IAM. */
  async markStep(step: unknown, value: unknown, options: MarkStepOptions = {}): Promise<OnboardingStatus> {
    if (typeof step !== 'string' || !(ONBOARDING_STEPS as readonly string[]).includes(step)) {
      throw new OnboardingError('invalid_input', '未知的引导步骤');
    }
    if (value !== 'done' && value !== 'skipped') throw new OnboardingError('invalid_input', '步骤状态只能是 done 或 skipped');
    if (!OPTIONAL_STEPS.has(step as OnboardingStep)) {
      throw new OnboardingError('invalid_input', '所有者步骤在创建第一个所有者后自动完成，不能手动标记');
    }
    return this.#exclusive(async () => {
      if (options.principal) await this.#authorizeStep(step as OnboardingStep, options.principal);
      const state = await this.#current();
      const steps = { ...state.steps, [step]: value as OnboardingStepStatus };
      const next: OnboardingState = Object.freeze({ ...state, steps: Object.freeze(steps) });
      await this.#store.write(next);
      return this.#view(next);
    });
  }

  /** Step 5: requires an owner; remaining pending optional steps stay pending (can be resumed later). */
  complete(options: MarkStepOptions = {}): Promise<OnboardingStatus> {
    return this.#exclusive(async () => {
      if (options.principal) this.#requireManager(options.principal);
      const state = await this.#current();
      if (state.steps.owner !== 'done') throw new OnboardingError('conflict', '请先创建所有者');
      if (state.completedAt) return this.#view(state);
      const next: OnboardingState = Object.freeze({ ...state, completedAt: (this.#options.now?.() ?? new Date()).toISOString() });
      await this.#store.write(next);
      return this.#view(next);
    });
  }

  async #authorizeStep(step: OnboardingStep, principal: ConsolePrincipal): Promise<void> {
    // Database (step 1) is a bootstrap-token step until an owner exists; later steps need an owner session.
    if (step === 'database' && principal.kind === 'bootstrap') {
      if (await this.#options.hasOwner()) throw new OnboardingError('forbidden', '已创建所有者：初始化令牌已失效');
      return;
    }
    this.#requireManager(principal);
    const extra = STEP_PERMISSIONS[step];
    if (extra && (principal.kind === 'bootstrap' || !grantsAllow(principal.grants, extra))) {
      throw new OnboardingError('forbidden', `需要 ${extra} 权限`);
    }
  }

  #requireManager(principal: ConsolePrincipal): void {
    if (principal.kind === 'bootstrap' || !grantsAllow(principal.grants, CONSOLE_PERMISSIONS.PLUGIN_MANAGE)) {
      throw new OnboardingError('forbidden', `需要 ${CONSOLE_PERMISSIONS.PLUGIN_MANAGE} 权限`);
    }
  }

  /** The current install allowlist (official catalogs + market entries). */
  async allowlist(): Promise<InstallAllowlist> {
    return createInstallAllowlist({ market: await this.#options.marketCatalog?.() ?? [] });
  }

  #port(): PackageInstallPort {
    this.#installer ??= new PluginManagementWorkflow(this.#options.projectRoot, {
      ...this.#options.workflow,
      installDependencies: createStreamingPackageManager(this.relay.output),
    });
    return this.#installer;
  }

  /** Authorizes then installs; progress goes to `onEvent`. Authorization errors throw before any work. */
  installPackages(packages: readonly unknown[], principal: InstallPrincipal | undefined, onEvent?: InstallListener): Promise<InstallReport> {
    return this.#exclusiveInstall(async () => {
      const authorized = authorizeInstall(packages, principal, await this.allowlist(), {
        ownerExists: await this.#options.hasOwner(),
      });
      return installPackages(authorized, { port: this.#port(), relay: this.relay, ...(onEvent ? { onEvent } : {}) });
    });
  }

  /** Same as `installPackages`, as an async iterator of progress events (ends with `done`). */
  streamInstall(packages: readonly unknown[], principal: InstallPrincipal | undefined): AsyncIterableIterator<InstallEvent> & { readonly result: Promise<InstallReport> } {
    return streamEvents<InstallEvent, InstallReport>(emit => this.installPackages(packages, principal, emit));
  }
}
