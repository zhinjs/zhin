import type { ImRuntime } from '@zhin.js/core/runtime';
import type {
  AuthenticatedTokenPrincipal,
  AuthScope,
  ConsoleEventHub,
} from '@zhin.js/host-http';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import type { DatabaseHost, SnapshotReader } from '@zhin.js/plugin-runtime';
import type { PluginLifecycleStore } from '../plugin-lifecycle-store.js';

export interface ConsoleRpcComposition {
  readonly consoleRuntime: ConsoleRuntime;
  readonly projectRoot: string;
  readonly hub: ConsoleEventHub;
  readonly pluginLifecycleFile: string;
  readonly pluginLifecycleStore: PluginLifecycleStore;
  readonly configuration: ConsoleRpcConfigurationPort;
  readonly im?: ImRuntime;
  readonly onRestart?: () => void;
  readonly databaseHost?: DatabaseHost;
  readonly scheduleHost?: unknown;
  readonly snapshots?: SnapshotReader;
}

export interface ConsoleRpcConfigurationPort {
  readSource(): Promise<Readonly<{
    source: string;
    format: 'yaml' | 'json';
    revision: string;
    configKeys: readonly string[];
  }>>;
  readDocument(): Promise<Record<string, unknown>>;
  replaceSource(source: string, expectedRevision: string): Promise<{ readonly revision: string }>;
  setKey(pluginName: string, data: unknown): Promise<{ restartRequired: boolean }>;
  readEnvironmentFile(filename: string): Promise<string>;
  writeEnvironmentFile(filename: string, content: string): Promise<void>;
  readSchema(pluginName?: string): Promise<unknown>;
  readAllSchemas(): Promise<Record<string, unknown>>;
  listKeys(): Promise<string[]>;
}

export interface ConsoleRpcRequestIdentity {
  readonly authScope: AuthScope;
  readonly authenticatedPrincipal?: AuthenticatedTokenPrincipal;
}
