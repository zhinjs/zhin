import type { ImRuntime } from '@zhin.js/core/runtime';
import {
  buildProjectFileTree,
  listEnvFiles,
  readProjectFile,
  saveProjectFile,
  type AuthenticatedTokenPrincipal,
  type AuthScope,
  type ConsoleEventHub,
  type ConsoleRpcExtendedCtx,
  type ConsoleScheduleEngine,
  type RuntimeConsoleRpcContext,
  type RuntimeEndpointSendInput,
} from '@zhin.js/host-http';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import type { DatabaseHost, SnapshotReader } from '@zhin.js/plugin-runtime';
import type { RuntimeConfigDocument } from '@zhin.js/runtime';
import type { WorkroomDefinition } from '@zhin.js/agent';
import {
  acquireGenerationAgentConsole,
  type AgentConsolePort,
} from './agent-console.js';
import { listPages } from './entry-projection.js';
import {
  readDeclaredPlugins,
  type PluginLifecycleStore,
} from '../plugin-lifecycle-store.js';

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
    scheduleHost,
    primaryConfigDocument,
  } = composition;
  const principal = identity.authenticatedPrincipal
    ? Object.freeze({ principalId: identity.authenticatedPrincipal.principalId })
    : undefined;

  const withEndpointManagement: ConsoleRpcExtendedCtx['withEndpointManagement'] = im
    ? (adapter, endpointKey, run) => im.withEndpointManagement(adapter, endpointKey, run)
    : undefined;
  const resolveScheduleEngine = (): ConsoleScheduleEngine | null => {
    const jobs = agent?.assistant?.jobs;
    if (!jobs) return null;
    return {
      listJobs: async () => [...await jobs.list()],
      addJob: job => jobs.add(job),
      removeJob: id => jobs.remove(id),
      pauseJob: id => jobs.pause(id),
      resumeJob: id => jobs.resume(id),
    };
  };
  const extended: Omit<ConsoleRpcExtendedCtx, 'fullScope'> = Object.freeze({
    projectRoot,
    scheduleHost,
    withEndpointManagement,
    databaseHost: databaseHost ? { models: databaseHost.models } : undefined,
    resolveScheduleEngine,
    loginAssist: im?.loginAssist,
    authenticatedPrincipal: principal,
    workroomProfileControl: agent?.workroomProfiles,
    workroomKnowledgeControl: agent?.workroomKnowledge,
  });
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
    readWorkroomCatalog: () => readWorkroomCatalog(agent, principal),
    setWorkroomCatalog: (workrooms: unknown, expectedRevision: string) =>
      setWorkroomCatalog(agent, im, workrooms, expectedRevision),
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
    extended,
    listPluginKeys: () => configuration.listKeys(primaryConfigDocument),
    publishEvent: (type: string, data: unknown) => hub.publish(type, data),
  };
  return Object.freeze(context);
}

async function readWorkroomCatalog(
  agent: AgentConsolePort | null,
  principal: Readonly<{ principalId: string }> | undefined,
): Promise<Readonly<{
  agents: Readonly<Record<string, unknown>>;
  workrooms: Readonly<Record<string, unknown>>;
  revision: string;
  principalId?: string;
}>> {
  const catalog = agent?.workroomCatalog;
  if (!catalog) throw new Error('Workroom Catalog Runtime 未就绪');
  const snapshot = await catalog.read();
  return Object.freeze({
    agents: Object.fromEntries(agent.listBindings().map(binding => [binding.name, Object.freeze({
      provider: binding.providerAlias,
      model: binding.model,
      ...(binding.nickname ? { nickname: binding.nickname } : {}),
    })])),
    workrooms: snapshot.definitions,
    revision: snapshot.revision,
    ...(principal ? { principalId: principal.principalId } : {}),
  });
}

async function setWorkroomCatalog(
  agent: AgentConsolePort | null,
  im: ImRuntime | undefined,
  workrooms: unknown,
  expectedRevision: string,
): Promise<Readonly<{ revision: string; restartRequired: false }>> {
  const catalog = agent?.workroomCatalog;
  if (!catalog) throw new Error('Workroom Catalog Runtime 未就绪');
  const { validateWorkroomDefinitions } = await import('@zhin.js/agent');
  const errors = validateWorkroomDefinitions(
    workrooms,
    agent.listBindings().map(binding => binding.name),
    new Set((im?.listEndpoints() ?? []).map(endpoint => `${endpoint.adapter}:${endpoint.name}`)),
  );
  if (errors.length > 0) throw new Error(`Invalid Workroom Catalog: ${errors.join('; ')}`);
  const snapshot = await catalog.replace(
    recordValue(workrooms) as Record<string, WorkroomDefinition>,
    expectedRevision,
  );
  return Object.freeze({ revision: snapshot.revision, restartRequired: false as const });
}

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value as Record<string, unknown> };
}
