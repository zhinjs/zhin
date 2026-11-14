import { pathToFileURL } from 'node:url';
import type { Dispose } from '@zhin.js/plugin-runtime';
import type { ClientModuleRequest } from '@zhin.js/feature-kit';

export interface ModuleWatchRoot {
  readonly root: string;
  readonly source: 'workspace' | 'local';
}

export interface ModuleRuntime {
  load<T = unknown>(source: string): Promise<T>;
  /** Optional compiler/manifest adapter for browser modules such as Page and Layout. */
  loadClientModule?<T = unknown>(source: string, request: ClientModuleRequest): Promise<T>;
  invalidate?(source: string): Promise<void> | void;
  affectedSources?(source: string): readonly string[];
  /**
   * Loaded entries that import the source but keep their old module instance after a reload
   * (#1250 `hmr-stale-cross-package-import`): e.g. a package-name import of a package that is
   * not a mounted local Plugin. Reported as possibly stale dependents; empty when unknown.
   */
  staleDependents?(source: string): readonly string[];
  /** Mounted local Plugin package roots whose package-name imports reload with their importer (#1250). */
  updateRevisionableRoots?(roots: readonly string[]): void;
  /** True when this adapter cannot invalidate the complete importer closure safely. */
  requiresProcessRestart?(source: string): boolean;
  /** Starts staging module metadata for a generation transaction. */
  beginGeneration?(): void;
  /** Commits staged metadata and the active module set after the generation commits. */
  commitGeneration?(sources: readonly string[]): void;
  /** Discards metadata staged by a failed generation transaction. */
  rollbackGeneration?(): void;
  /** Replaces the local package roots after a generation commits. */
  updateWatchRoots?(roots: readonly ModuleWatchRoot[]): void;
  watch?(listener: (source: string) => void): Dispose;
  close(): Promise<void>;
}

export class EsmModuleRuntime implements ModuleRuntime {
  async load<T>(source: string): Promise<T> {
    return import(pathToFileURL(source).href) as Promise<T>;
  }

  async close(): Promise<void> {}
}
