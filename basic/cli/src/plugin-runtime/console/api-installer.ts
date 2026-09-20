import {
  consoleEventHubToken,
  createConsoleEventHub,
  httpHostToken,
  type ConsoleEventHub,
} from '@zhin.js/host-http';
import type { ImRuntime } from '@zhin.js/core/runtime';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import {
  runtimeEventPublisherToken,
  type DatabaseHost,
  type RuntimeSnapshot,
  type SnapshotReader,
} from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import {
  resolvePluginLifecycleFile,
  type PluginLifecycleStore,
} from '../plugin-lifecycle-store.js';
import { registerConsoleRoutes } from './api-routes.js';
import { ConsoleConfigurationStore } from './configuration.js';
import { normalizeBase } from './http-response.js';
import { ConsoleLoginAssistBindings } from './login-assist-binding.js';
import { ConsoleMessageBindings } from './message-bindings.js';

export interface InstallConsoleApiOptions {
  readonly console: ConsoleRuntime;
  readonly projectRoot: string;
  readonly apiBase?: string;
  readonly im?: ImRuntime;
  readonly databaseHost?: DatabaseHost;
  readonly snapshot?: () => RuntimeSnapshot | undefined;
  readonly snapshots?: SnapshotReader;
  readonly scheduleHost?: unknown;
  readonly onRestart?: () => void;
  readonly pluginLifecycleFile?: string;
  readonly pluginLifecycleStore: PluginLifecycleStore;
  readonly eventHub?: ConsoleEventHub;
  readonly configuration: ConsoleConfigurationStore;
}

export function installConsoleApi(options: InstallConsoleApiOptions): RootResourceInstaller {
  const apiBase = normalizeBase(options.apiBase ?? '/api');
  const hub = options.eventHub ?? createConsoleEventHub();
  const configuration = options.configuration;
  const loginAssistBindings = new ConsoleLoginAssistBindings();
  const messageBindings = new ConsoleMessageBindings({
    hub,
    databaseHost: options.databaseHost,
  });

  return ({ resources, lifecycle }) => {
    const http = resources.use(httpHostToken);
    resources.provide(runtimeEventPublisherToken, hub);
    resources.provide(consoleEventHubToken, hub);

    if (options.im) lifecycle.add(messageBindings.acquire(options.im));
    const loginAssist = options.im?.loginAssist;
    if (loginAssist) lifecycle.add(loginAssistBindings.acquire(loginAssist, hub));

    registerConsoleRoutes({
      http,
      consoleRuntime: options.console,
      projectRoot: options.projectRoot,
      apiBase,
      im: options.im,
      onRestart: options.onRestart,
      databaseHost: options.databaseHost,
      snapshot: options.snapshot,
      scheduleHost: options.scheduleHost,
      eventHub: hub,
      snapshots: options.snapshots,
      pluginLifecycleFile: options.pluginLifecycleFile
        ?? resolvePluginLifecycleFile(options.projectRoot),
      pluginLifecycleStore: options.pluginLifecycleStore,
      configuration,
    });
  };
}
