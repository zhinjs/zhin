import type { AuthorizedPackage, InstallPackageKind } from './allowlist.js';
import type { PackageManagerOutput } from './package-manager.js';

/** The part of `PluginManagementWorkflow` / `PluginManagementPort` installation uses. */
export interface PackageInstallPort {
  inspect?(packageName: string): Promise<{ readonly installed: boolean }>;
  install(spec: string, expectedRevision?: string, expectedProjectRevision?: string, options?: { readonly enable?: boolean }): Promise<{ readonly restartRequired: boolean }>;
  uninstall?(packageName: string): Promise<unknown>;
}

export type InstallEvent =
  | { readonly type: 'start'; readonly packages: readonly { readonly name: string; readonly spec: string; readonly kind: InstallPackageKind }[] }
  | { readonly type: 'package-start'; readonly name: string; readonly spec: string }
  | { readonly type: 'output'; readonly name: string; readonly stream: 'stdout' | 'stderr'; readonly chunk: string }
  | { readonly type: 'package-done'; readonly name: string; readonly restartRequired: boolean }
  | { readonly type: 'package-failed'; readonly name: string; readonly error: string; readonly completedStages: readonly string[] }
  | { readonly type: 'rollback'; readonly name: string; readonly ok: boolean; readonly error?: string }
  | { readonly type: 'done'; readonly report: InstallReport };

export interface InstallReport {
  readonly ok: boolean;
  readonly installed: readonly string[];
  readonly failed?: { readonly name: string; readonly error: string; readonly completedStages: readonly string[] };
  /** Packages this batch added and then removed again after a failure. */
  readonly rolledBack: readonly string[];
  /** Rollback attempts that failed; those packages remain and need manual cleanup. */
  readonly rollbackFailed: readonly { readonly name: string; readonly error: string }[];
  /** Packages that were already installed and therefore never rolled back. */
  readonly preexisting: readonly string[];
  readonly restartRequired: boolean;
}

export type InstallListener = (event: InstallEvent) => void;

/** Routes package-manager output to whichever install is running (installs are serialized). */
export class InstallOutputRelay {
  #listener: PackageManagerOutput | undefined;
  readonly output: PackageManagerOutput = (stream, chunk) => this.#listener?.(stream, chunk);
  attach(listener: PackageManagerOutput): () => void {
    this.#listener = listener;
    return () => { if (this.#listener === listener) this.#listener = undefined; };
  }
}

export interface InstallPackagesOptions {
  readonly port: PackageInstallPort;
  readonly onEvent?: InstallListener;
  readonly relay?: InstallOutputRelay;
  /** Remove packages this batch added when a later one fails (default true). */
  readonly rollback?: boolean;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function completedStages(error: unknown): readonly string[] {
  const stages = (error as { completedStages?: unknown } | undefined)?.completedStages;
  return Array.isArray(stages) ? Object.freeze(stages.filter((stage): stage is string => typeof stage === 'string')) : Object.freeze([]);
}

/**
 * Installs already-authorized packages one at a time through the plugin-management workflow.
 * Stops at the first failure and, when possible, removes what this batch added (reported, never assumed).
 */
export async function installPackages(packages: readonly AuthorizedPackage[], options: InstallPackagesOptions): Promise<InstallReport> {
  const emit = (event: InstallEvent) => { try { options.onEvent?.(event); } catch { /* listeners never break installs */ } };
  emit({ type: 'start', packages: packages.map(({ name, spec, kind }) => ({ name, spec, kind })) });
  const installed: string[] = [];
  const added: string[] = [];
  const preexisting: string[] = [];
  let restartRequired = false;
  let failed: InstallReport['failed'];
  for (const item of packages) {
    let existed: boolean | undefined;
    try { existed = options.port.inspect ? (await options.port.inspect(item.name)).installed : undefined; }
    catch { existed = undefined; }
    if (existed) preexisting.push(item.name);
    emit({ type: 'package-start', name: item.name, spec: item.spec });
    const detach = options.relay?.attach((stream, chunk) => emit({ type: 'output', name: item.name, stream, chunk }));
    try {
      // Drivers and AI stack packages are plain dependencies; adapters and market plugins get declared.
      const enable = item.kind === 'adapter' || item.kind === 'market';
      const result = await options.port.install(item.spec, undefined, undefined, { enable });
      restartRequired ||= result.restartRequired;
      installed.push(item.name);
      // Only packages proven absent beforehand are ours to remove.
      if (existed === false) added.push(item.name);
      emit({ type: 'package-done', name: item.name, restartRequired: result.restartRequired });
    } catch (error) {
      const stages = completedStages(error);
      failed = Object.freeze({ name: item.name, error: message(error), completedStages: stages });
      if (existed === false && stages.includes('dependency-install')) added.push(item.name);
      emit({ type: 'package-failed', ...failed });
      break;
    } finally {
      detach?.();
    }
  }
  const rolledBack: string[] = [];
  const rollbackFailed: { name: string; error: string }[] = [];
  if (failed && options.rollback !== false) {
    for (const name of [...added].reverse()) {
      if (!options.port.uninstall) {
        rollbackFailed.push({ name, error: 'uninstall unavailable' });
        emit({ type: 'rollback', name, ok: false, error: 'uninstall unavailable' });
        continue;
      }
      try {
        await options.port.uninstall(name);
        rolledBack.push(name);
        emit({ type: 'rollback', name, ok: true });
      } catch (error) {
        rollbackFailed.push({ name, error: message(error) });
        emit({ type: 'rollback', name, ok: false, error: message(error) });
      }
    }
  }
  const report: InstallReport = Object.freeze({
    ok: !failed,
    installed: Object.freeze(installed.filter(name => !rolledBack.includes(name))),
    ...(failed ? { failed } : {}),
    rolledBack: Object.freeze(rolledBack),
    rollbackFailed: Object.freeze(rollbackFailed.map(entry => Object.freeze(entry))),
    preexisting: Object.freeze(preexisting),
    restartRequired: restartRequired && installed.some(name => !rolledBack.includes(name)),
  });
  emit({ type: 'done', report });
  return report;
}

/** Adapts a listener-based run into an async iterator of its events (ends after the run settles). */
export function streamEvents<E, T>(run: (emit: (event: E) => void) => Promise<T>): AsyncIterableIterator<E> & { readonly result: Promise<T> } {
  const queue: E[] = [];
  let wake: (() => void) | undefined;
  let settled = false;
  const result = run(event => { queue.push(event); wake?.(); }).finally(() => { settled = true; wake?.(); });
  result.catch(() => { /* surfaced through next() */ });
  const iterator = {
    result,
    async next(): Promise<IteratorResult<E>> {
      for (;;) {
        if (queue.length) return { value: queue.shift()!, done: false };
        if (settled) {
          await result;
          return { value: undefined, done: true };
        }
        await new Promise<void>(resolveWake => { wake = resolveWake; });
        wake = undefined;
      }
    },
    [Symbol.asyncIterator]() { return iterator; },
  };
  return iterator as AsyncIterableIterator<E> & { readonly result: Promise<T> };
}
