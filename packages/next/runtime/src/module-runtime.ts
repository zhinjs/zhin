import { pathToFileURL } from 'node:url';
import type { Dispose } from '@zhin.js/next-kernel';

export interface ModuleRuntime {
  load<T = unknown>(source: string): Promise<T>;
  invalidate?(source: string): Promise<void> | void;
  affectedSources?(source: string): readonly string[];
  watch?(listener: (source: string) => void): Dispose;
  close(): Promise<void>;
}

export class EsmModuleRuntime implements ModuleRuntime {
  async load<T>(source: string): Promise<T> {
    return import(pathToFileURL(source).href) as Promise<T>;
  }

  async close(): Promise<void> {}
}
