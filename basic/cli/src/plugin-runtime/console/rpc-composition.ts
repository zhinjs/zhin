import type { ImRuntime } from '@zhin.js/core/runtime';
import type {
  AuthenticatedTokenPrincipal,
  AuthScope,
  ConsoleAccess,
  ConsoleEventHub,
  PluginManagementPort,
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
  readonly pluginManagement?: PluginManagementPort;
  readonly im?: ImRuntime;
  readonly onRestart?: () => void;
  readonly databaseHost?: DatabaseHost;
  readonly scheduleHost?: unknown;
  readonly snapshots?: SnapshotReader;
  /** Host-owned Console methods resolved from each request's captured Root lease. */
  readonly hostConsoleRpc?: import('./plugin-console-rpc.js').HostConsoleRpcFactory;
}

export interface ConsoleRpcConfigurationPort {
  readSource(): Promise<import('@zhin.js/console-protocol').ConsoleConfigSource>;
  readDocument(): Promise<Record<string, unknown>>;
  apply?(expectedRevision: string): Promise<import('@zhin.js/console-protocol').ConsoleConfigApplyResult>;
  replaceSource(
    source: string,
    expectedRevision: string,
  ): Promise<{ readonly revision: string; readonly restartRequired: boolean } & import('@zhin.js/console-protocol').ConsoleConfigApplicationStatus>;
  setKey(pluginName: string, data: unknown): Promise<{ restartRequired: boolean } & import('@zhin.js/console-protocol').ConsoleConfigApplicationStatus>;
  patch(request: import('@zhin.js/console-protocol').ConsoleConfigPatchRequest): Promise<import('@zhin.js/console-protocol').ConsoleConfigPatchResult>;
  patchProject?(request: Omit<import('@zhin.js/console-protocol').ConsoleConfigPatchRequest, 'instanceKey'>): Promise<import('@zhin.js/console-protocol').ConsoleConfigProjectPatchResult>;
  removeKey(pluginName: string): Promise<{ restartRequired: boolean } & import('@zhin.js/console-protocol').ConsoleConfigApplicationStatus>;
  readEnvironmentFile(filename: string): Promise<string>;
  writeEnvironmentFile(filename: string, content: string): Promise<void>;
  readSchema(pluginName?: string): Promise<unknown>;
  readAllSchemas(): Promise<Record<string, unknown>>;
  validatePluginConfig(pluginName: string, data: unknown): Promise<import('@zhin.js/host-http').PluginConfigValidation>;
  listKeys(): Promise<string[]>;
}

export interface ConsoleRpcRequestIdentity {
  readonly authScope: AuthScope;
  /** Page/RPC access of the bearer token; omitted means public access. */
  readonly access?: ConsoleAccess;
  readonly authenticatedPrincipal?: AuthenticatedTokenPrincipal;
}
