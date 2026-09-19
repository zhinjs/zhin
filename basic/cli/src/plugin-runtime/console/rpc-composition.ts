import type { ImRuntime } from '@zhin.js/core/runtime';
import type {
  AuthenticatedTokenPrincipal,
  AuthScope,
  ConsoleEventHub,
} from '@zhin.js/host-http';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import type { DatabaseHost, SnapshotReader } from '@zhin.js/plugin-runtime';
import type { RuntimeConfigDocument } from '@zhin.js/runtime';
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
  readonly primaryConfigDocument?: RuntimeConfigDocument;
  readonly snapshots?: SnapshotReader;
}

export interface ConsoleRpcConfigurationPort {
  readYaml(): Promise<string>;
  readDocument(): Promise<Record<string, unknown>>;
  writeYaml(yaml: string): Promise<void>;
  setKey(pluginName: string, data: unknown): Promise<{ restartRequired: boolean }>;
  readEnvironmentFile(filename: string): Promise<string>;
  writeEnvironmentFile(filename: string, content: string): Promise<void>;
  readSchema(pluginName?: string): Promise<unknown>;
  readAllSchemas(): Promise<Record<string, unknown>>;
  listKeys(primaryConfigDocument?: RuntimeConfigDocument): Promise<string[]>;
}

export interface ConsoleRpcRequestIdentity {
  readonly authScope: AuthScope;
  readonly authenticatedPrincipal?: AuthenticatedTokenPrincipal;
}
