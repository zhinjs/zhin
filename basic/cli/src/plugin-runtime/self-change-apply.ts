import * as path from 'node:path';
import type {
  SelfChangeApplyPorts,
  SelfChangeConfigOperation,
  SelfChangeConfigPort,
  SelfChangeHealth,
  SelfChangeHealthInput,
  SelfChangeRecord,
} from '@zhin.js/agent';
import type { ConsoleConfigPatchRequest, ConsoleConfigPatchResult } from '@zhin.js/console-protocol';
import { HOST_CONFIG_KEYS } from '@zhin.js/runtime';

/**
 * Process-owned host side of ADR 0040 §5 / §6 (slice E2): the ports a {@link import('@zhin.js/agent').SelfChangeApplier}
 * needs that only the Root process can provide.
 *
 * - `reload`: `RootHost.reloadSources()` — the same HMR path as file watching, also under `--no-watch`.
 * - `requestRestart`: the controlled exit 75 the supervisor turns into a fresh process.
 * - `health`: the committed generation is up, the plugins owning the changed files are assembled, and no
 *   runtime error was reported since the change started applying (after a restart: since this process started).
 * - `config`: field patches and whole-source rollback through `ConsoleConfigurationStore`.
 *
 * Agent generations come and go (every reload builds a new one); the newest binds its applier here. Applies are
 * serialized across generations, and `recover()` runs once per process after the first generation has started.
 */
export interface SelfChangeConfigurationSource {
  readSource(): Promise<Readonly<{ source: string; revision: string }>>;
  patch(request: ConsoleConfigPatchRequest): Promise<ConsoleConfigPatchResult>;
  replaceSource(source: string, expectedRevision: string): Promise<Readonly<{ revision: string; restartRequired: boolean }>>;
}

export interface SelfChangeApplyHostOptions {
  readonly projectRoot: string;
  /** `RootHost.reloadSources` (absolute paths). */
  readonly reload: (sources: readonly string[]) => Promise<'reloaded' | 'restart'>;
  /** Controlled exit 75. */
  readonly restart: () => void;
  /** Committed Root snapshot; throws / undefined while none is committed. */
  readonly snapshot: () => Readonly<{ generation: number; tree: ReadonlyMap<string, unknown> }> | undefined;
  readonly ownership?: () => Readonly<{ ownersForPath(source: string): readonly string[] }> | undefined;
  readonly configuration?: SelfChangeConfigurationSource;
  /** Absolute root config file; reloaded with a change that carries a config patch. */
  readonly configFile?: string;
}

/** What the Agent generation contributes: the control plane and the IM. */
export type SelfChangeGenerationPorts = Pick<SelfChangeApplyPorts, 'emergencyStop' | 'report'>;

/** The slice of {@link import('@zhin.js/agent').SelfChangeApplier} the host drives. */
export interface SelfChangeApplierHandle {
  apply(id: string): Promise<unknown>;
  recover(): Promise<number>;
}

export class HostSelfChangeApply {
  readonly #options: SelfChangeApplyHostOptions;
  #applier: SelfChangeApplierHandle | undefined;
  #listApproved: (() => Promise<readonly string[]>) | undefined;
  #tail: Promise<unknown> = Promise.resolve();
  #active = 0;
  #deferredRestart: (() => void) | undefined;
  #errors = 0;
  readonly #errorBaseline = new Map<string, number>();
  #started = false;
  #recovered = false;

  constructor(options: SelfChangeApplyHostOptions) {
    this.#options = options;
  }

  /** An approved change is being applied (or recovered): HMR restart requests are left to the applier. */
  get active(): boolean {
    return this.#active > 0;
  }

  /**
   * File watching asked for a restart while a change is applying: hold it until the apply flow is done (it may
   * restart by itself after persisting `verifying`; a second request is harmless). Runs now when idle.
   */
  deferRestart(restart: () => void): void {
    if (this.#active === 0) {
      restart();
      return;
    }
    this.#deferredRestart = restart;
  }

  /** Root reported a runtime error (HMR / control); a change applying now is unhealthy. */
  noteError(): void {
    this.#errors += 1;
  }

  /** Full applier ports for one Agent generation. */
  ports(generation: SelfChangeGenerationPorts): SelfChangeApplyPorts {
    const config = this.#options.configuration ? createSelfChangeConfigPort(this.#options.configuration) : undefined;
    const ports: SelfChangeApplyPorts = {
      ...(config ? { config } : {}),
      reload: ({ record, changed }) => this.#options.reload(this.#sources(record, changed)),
      requestRestart: () => this.#options.restart(),
      health: input => this.#health(input),
      emergencyStop: generation.emergencyStop,
      report: generation.report,
    };
    return Object.freeze(ports);
  }

  /**
   * The newest Agent generation binds its applier; the returned function unbinds it on dispose.
   * `listApproved` lists changes approved but never applied (the process ended in between); they are applied
   * once after `recover()`.
   */
  bind(applier: SelfChangeApplierHandle, listApproved?: () => Promise<readonly string[]>): () => void {
    this.#applier = applier;
    this.#listApproved = listApproved;
    if (this.#started) void this.#recover();
    return () => {
      if (this.#applier !== applier) return;
      this.#applier = undefined;
      this.#listApproved = undefined;
    };
  }

  /** `onApproved`: apply one change. Serialized across generations; never throws. */
  apply(id: string, onError: (error: unknown) => void = () => undefined): Promise<void> {
    return this.#run(async () => {
      const applier = this.#applier;
      if (!applier) throw new Error(`no Agent generation is bound to apply change ${id}`);
      this.#errorBaseline.set(id, this.#errors);
      try {
        await applier.apply(id);
      } finally {
        this.#errorBaseline.delete(id);
      }
    }).catch(onError);
  }

  /** The first generation has started: resume `applying` / `verifying` changes once (§6 `recover()`). */
  started(): Promise<void> {
    this.#started = true;
    return this.#recover();
  }

  #recover(): Promise<void> {
    if (this.#recovered || !this.#applier) return Promise.resolve();
    this.#recovered = true;
    const applier = this.#applier;
    const listApproved = this.#listApproved;
    return this.#run(async () => {
      await applier.recover();
      for (const id of await listApproved?.() ?? []) {
        this.#errorBaseline.set(id, this.#errors);
        try {
          await applier.apply(id);
        } finally {
          this.#errorBaseline.delete(id);
        }
      }
    });
  }

  #run<T>(task: () => Promise<T>): Promise<T> {
    this.#active += 1;
    const run = this.#tail.then(task, task).finally(() => {
      this.#active -= 1;
      const restart = this.#active === 0 ? this.#deferredRestart : undefined;
      this.#deferredRestart = undefined;
      restart?.();
    });
    this.#tail = run.catch(() => undefined);
    return run;
  }

  #sources(record: SelfChangeRecord, changed: readonly string[]): string[] {
    const root = path.resolve(this.#options.projectRoot);
    const sources = changed.map(file => path.join(root, ...file.split('/')));
    if (record.configPatch && this.#options.configFile) sources.push(path.resolve(this.#options.configFile));
    return sources;
  }

  async #health({ record, restarted }: SelfChangeHealthInput): Promise<SelfChangeHealth> {
    let snapshot: ReturnType<SelfChangeApplyHostOptions['snapshot']>;
    try {
      snapshot = this.#options.snapshot();
    } catch (error) {
      return { ok: false, error: `no committed generation: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (!snapshot) return { ok: false, error: 'no committed generation' };
    // After a restart this process is new: every error it reported counts.
    const baseline = restarted ? 0 : this.#errorBaseline.get(record.id) ?? this.#errors;
    const errors = this.#errors - baseline;
    if (errors > 0) return { ok: false, error: `${errors} runtime error(s) reported since the change was applied` };
    const ownership = this.#options.ownership?.();
    if (ownership) {
      const root = path.resolve(this.#options.projectRoot);
      for (const file of record.files) {
        if (file.op !== 'write') continue;
        const missing = ownership.ownersForPath(path.join(root, ...file.path.split('/'))).filter(owner => !snapshot.tree.has(owner));
        if (missing.length > 0) return { ok: false, error: `plugin ${missing.join(', ')} owning ${file.path} is not assembled` };
      }
    }
    return { ok: true };
  }
}

/**
 * `configPatch` → Console `config:patch`, one request per top-level section: Host sections use the Host
 * allowlist, every other section is scoped to its plugin instance. Revisions chain; the first non-`saved`
 * result stops (the applier then rolls back from the snapshot source).
 */
export function createSelfChangeConfigPort(configuration: SelfChangeConfigurationSource): SelfChangeConfigPort {
  return Object.freeze({
    async read() {
      const source = await configuration.readSource();
      return Object.freeze({ source: source.source, revision: source.revision });
    },
    async patch(expectedRevision: string, patches: readonly SelfChangeConfigOperation[]) {
      const groups = new Map<string, SelfChangeConfigOperation[]>();
      for (const patch of patches) {
        const section = patch.path[0] ?? '';
        const list = groups.get(section) ?? [];
        list.push(patch);
        groups.set(section, list);
      }
      let revision = expectedRevision;
      let restartRequired = false;
      for (const [section, group] of groups) {
        const host = (HOST_CONFIG_KEYS as readonly string[]).includes(section);
        const result = await configuration.patch({
          ...(host ? {} : { instanceKey: section }),
          expectedRevision: revision,
          patches: group,
        });
        if (result.status !== 'saved') return Object.freeze({ status: result.status, message: result.message });
        revision = result.revision;
        restartRequired ||= result.restartRequired;
      }
      return Object.freeze({ status: 'saved' as const, revision, restartRequired });
    },
    restore: (source: string, expectedRevision: string) => configuration.replaceSource(source, expectedRevision),
  });
}
