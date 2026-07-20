import type { Dispose } from '@zhin.js/plugin-runtime';
import type { ClientModuleRequest } from '@zhin.js/feature-kit';
import type { ModuleRuntime } from '@zhin.js/runtime';
import type { ClientModuleLoader } from './types.js';

/** Adds client artifact loading while preserving the server ModuleRuntime authority. */
export class ClientBuildModuleRuntime implements ModuleRuntime {
  constructor(
    private readonly server: ModuleRuntime,
    private readonly client: ClientModuleLoader,
  ) {}

  load<T = unknown>(source: string): Promise<T> {
    return this.server.load<T>(source);
  }

  loadClientModule<T = unknown>(source: string, request: ClientModuleRequest): Promise<T> {
    return this.client.load<T>(source, request);
  }

  invalidate(source: string): Promise<void> | void {
    return this.server.invalidate?.(source);
  }

  affectedSources(source: string): readonly string[] {
    return this.server.affectedSources?.(source) ?? [source];
  }

  watch(listener: (source: string) => void): Dispose {
    return this.server.watch?.(listener) ?? (() => undefined);
  }

  close(): Promise<void> {
    return this.server.close();
  }
}
