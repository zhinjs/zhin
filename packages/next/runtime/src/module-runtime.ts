import { pathToFileURL } from 'node:url';

export interface ModuleRuntime {
  load<T = unknown>(source: string): Promise<T>;
  invalidate?(source: string): Promise<void> | void;
  close(): Promise<void>;
}

export class EsmModuleRuntime implements ModuleRuntime {
  async load<T>(source: string): Promise<T> {
    return import(pathToFileURL(source).href) as Promise<T>;
  }

  async close(): Promise<void> {}
}
