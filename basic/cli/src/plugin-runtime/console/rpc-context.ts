import {
  buildProjectFileTree,
  listEnvFiles,
  readProjectFile,
  saveProjectFile,
  type RuntimeConsoleRpcContext,
  type RuntimeEndpointSendInput,
} from '@zhin.js/host-http';
import {
  acquireGenerationAgentConsole,
  type AgentConsolePort,
} from './agent-console.js';
import { listPages } from './entry-projection.js';
import { createExtendedConsoleRpcContext } from './rpc-extended-context.js';
import type {
  ConsoleRpcComposition,
  ConsoleRpcRequestIdentity,
} from './rpc-composition.js';
import { createWorkroomCatalogRpcContext } from './workroom-catalog-rpc.js';
import { readDeclaredPlugins } from '../plugin-lifecycle-store.js';

/** Owns the generation lease and capability context for one Console RPC request. */
export class ConsoleRpcRequestScope {
  readonly context: RuntimeConsoleRpcContext;
  readonly #lease: ReturnType<typeof acquireGenerationAgentConsole>;
  #closed = false;

  constructor(
    composition: ConsoleRpcComposition,
    identity: ConsoleRpcRequestIdentity,
  ) {
    this.#lease = acquireGenerationAgentConsole(composition.snapshots);
    this.context = createRpcContext(composition, identity, this.#lease?.value ?? null);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#lease?.release();
  }
}

function createRpcContext(
  composition: ConsoleRpcComposition,
  identity: ConsoleRpcRequestIdentity,
  agent: AgentConsolePort | null,
): RuntimeConsoleRpcContext {
  const {
    consoleRuntime,
    projectRoot,
    hub,
    pluginLifecycleFile,
    pluginLifecycleStore,
    configuration,
    im,
    onRestart,
    databaseHost,
    primaryConfigDocument,
  } = composition;
  const principal = identity.authenticatedPrincipal
    ? Object.freeze({ principalId: identity.authenticatedPrincipal.principalId })
    : undefined;
  const context: RuntimeConsoleRpcContext = {
    authScope: identity.authScope,
    listPages: () => listPages(consoleRuntime),
    readConfigYaml: () => configuration.readYaml(),
    readConfigDocument: () => configuration.readDocument(),
    writeConfigYaml: (yaml: string) => configuration.writeYaml(yaml),
    setConfigKey: (pluginName: string, data: unknown) => configuration.setKey(pluginName, data),
    setPluginEnabled: async (instanceKey: string, enabled: boolean) =>
      pluginLifecycleStore.setPluginEnabled(
        pluginLifecycleFile,
        instanceKey,
        enabled,
        await readDeclaredPlugins(projectRoot),
      ),
    ...createWorkroomCatalogRpcContext(agent, im, principal),
    listProjectFiles: () => buildProjectFileTree(projectRoot),
    readProjectFile: (filePath: string) => readProjectFile(projectRoot, filePath),
    saveProjectFile: (filePath: string, content: string) =>
      saveProjectFile(projectRoot, filePath, content),
    listEnvFiles: () => listEnvFiles(projectRoot),
    readEnvFile: (filename: string) => configuration.readEnvironmentFile(filename),
    writeEnvFile: (filename: string, content: string) =>
      configuration.writeEnvironmentFile(filename, content),
    getSchema: (pluginName?: string) => configuration.readSchema(pluginName),
    getAllSchemas: () => configuration.readAllSchemas(),
    listEndpoints: im ? async () => im.listEndpoints() : undefined,
    getEndpoint: im
      ? async (adapter: string, endpointKey: string) => im.getEndpoint(adapter, endpointKey)
      : undefined,
    sendEndpointMessage: im
      ? async (input: RuntimeEndpointSendInput) => im.sendEndpointMessage(input)
      : undefined,
    requestRestart: onRestart ? () => { onRestart(); } : undefined,
    dbInfo: databaseHost
      ? () => ({
          dialect: databaseHost.dialect,
          connected: databaseHost.started,
          tables: databaseHost.tables().length,
        })
      : undefined,
    dbTables: databaseHost ? () => databaseHost.tables() : undefined,
    database: databaseHost?.console,
    extended: createExtendedConsoleRpcContext(composition, agent, principal),
    listPluginKeys: () => configuration.listKeys(primaryConfigDocument),
    publishEvent: (type: string, data: unknown) => hub.publish(type, data),
  };
  return Object.freeze(context);
}
