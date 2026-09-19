import type {
  PluginRegisterHostApi,
  RuntimeEnv,
} from '@zhin.js/contract';
import type * as React from 'react';
import { ConsoleApp, createConsoleApp } from './app.js';
import { ConsoleTransport } from './transport/console-transport.js';
import type {
  ConsoleTransportCallbacks,
  ConsoleTransportConfig,
} from './transport/types.js';

export interface ConsoleClientOptions {
  readonly getRuntimeEnv?: () => RuntimeEnv;
  readonly app?: ConsoleApp;
  readonly transport?: ConsoleTransport;
  readonly transportConfig?: ConsoleTransportConfig;
  readonly transportCallbacks?: ConsoleTransportCallbacks;
}

/** Owns all mutable browser-side state for one Remote Console mount. */
export class ConsoleClient {
  readonly app: ConsoleApp;
  readonly transport: ConsoleTransport;
  readonly #getRuntimeEnv: () => RuntimeEnv;
  #disposed = false;

  constructor(options: ConsoleClientOptions = {}) {
    this.app = options.app ?? createConsoleApp();
    this.transport = options.transport ?? new ConsoleTransport(
      options.transportConfig,
      options.transportCallbacks,
    );
    this.#getRuntimeEnv = options.getRuntimeEnv ?? (() => 'production');
  }

  getRuntimeEnv(): RuntimeEnv {
    this.#assertActive();
    return this.#getRuntimeEnv();
  }

  createPluginRegisterHostApi(ReactRuntime: typeof React): PluginRegisterHostApi {
    this.#assertActive();
    return {
      React: ReactRuntime,
      addRoute: (input) => this.app.addRoute(input),
      addTool: (input) => this.app.addTool(input),
    };
  }

  connect(): void {
    this.#assertActive();
    this.transport.connect();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.transport.dispose();
    this.app.dispose();
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('ConsoleClient has been disposed');
  }
}

export function createConsoleClient(options?: ConsoleClientOptions): ConsoleClient {
  return new ConsoleClient(options);
}
