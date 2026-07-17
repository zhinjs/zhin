import { pathToFileURL } from 'node:url';
import type { Dispose } from '@zhin.js/plugin-runtime';
import type { ClientModuleRequest } from '@zhin.js/feature-kit';

export interface ModuleRuntime {
  load<T = unknown>(source: string): Promise<T>;
  /** Optional compiler/manifest adapter for browser modules such as Page and Layout. */
  loadClientModule?<T = unknown>(source: string, request: ClientModuleRequest): Promise<T>;
  invalidate?(source: string): Promise<void> | void;
  affectedSources?(source: string): readonly string[];
  /** True when this adapter cannot invalidate the complete importer closure safely. */
  requiresProcessRestart?(source: string): boolean;
  watch?(listener: (source: string) => void): Dispose;
  close(): Promise<void>;
}

export class EsmModuleRuntime implements ModuleRuntime {
  async load<T>(source: string): Promise<T> {
    return import(pathToFileURL(source).href) as Promise<T>;
  }

  async close(): Promise<void> {}
}
