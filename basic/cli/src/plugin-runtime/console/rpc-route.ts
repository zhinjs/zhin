import type { ImRuntime } from '@zhin.js/core/runtime';
import {
  buildProjectFileTree,
  dispatchRuntimeConsoleRpc,
  HttpBodyError,
  listEnvFiles,
  pickRpcReply,
  readJsonBody,
  readProjectFile,
  saveProjectFile,
  type ConsoleEventHub,
  type HttpHost,
} from '@zhin.js/host-http';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import type { DatabaseHost, SnapshotReader } from '@zhin.js/plugin-runtime';
import type { RuntimeConfigDocument } from '@zhin.js/runtime';
import type { WorkroomDefinition } from '@zhin.js/agent';
import { acquireGenerationAgentConsole } from './agent-console.js';
import { ConsoleConfigurationStore } from './configuration.js';
import { writeJson } from './http-response.js';
import { listPages } from './entry-projection.js';
import { readDeclaredPlugins, type PluginLifecycleStore } from '../plugin-lifecycle-store.js';

export interface RegisterConsoleRpcRouteOptions {
  readonly http: HttpHost;
  readonly base: string;
  readonly consoleRuntime: ConsoleRuntime;
  readonly projectRoot: string;
  readonly hub: ConsoleEventHub;
  readonly pluginLifecycleFile: string;
  readonly pluginLifecycleStore: PluginLifecycleStore;
  readonly configuration: ConsoleConfigurationStore;
  readonly im?: ImRuntime;
  readonly onRestart?: () => void;
  readonly databaseHost?: DatabaseHost;
  readonly scheduleHost?: unknown;
  readonly primaryConfigDocument?: RuntimeConfigDocument;
  readonly snapshots?: SnapshotReader;
}

export function registerConsoleRpcRoute(options: RegisterConsoleRpcRouteOptions): void {
  const {
    http,
    base,
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
    snapshots,
  } = options;

  http.route('POST', `${base}/console/request`, async (
    request, response, _url, authScope, authenticatedPrincipal,
  ) => {
    try {
      const message = (await readJsonBody<Record<string, unknown>>(request)) ?? {};
      const agentLease = acquireGenerationAgentConsole(snapshots);
      let payloads: Awaited<ReturnType<typeof dispatchRuntimeConsoleRpc>>;
      try {
        payloads = await dispatchRuntimeConsoleRpc(message, {
          authScope,
          listPages: () => listPages(consoleRuntime),
          readConfigYaml: () => configuration.readYaml(),
          // Config reads share the persisted file as their single source. The running Bot keeps
          // its generation snapshot until restart/reload, and placeholders stay unexpanded.
          readConfigDocument: () => configuration.readDocument(),
          writeConfigYaml: (yaml) => configuration.writeYaml(yaml),
          setConfigKey: (pluginName, data) => configuration.setKey(pluginName, data),
          setPluginEnabled: async (instanceKey, enabled) => pluginLifecycleStore.setPluginEnabled(
            pluginLifecycleFile,
            instanceKey,
            enabled,
            await readDeclaredPlugins(projectRoot),
          ),
          readWorkroomCatalog: async () => {
            const catalog = agentLease?.value?.workroomCatalog;
            if (!catalog) throw new Error('Workroom Catalog Runtime 未就绪');
            const snapshot = await catalog.read();
            const bindings = agentLease?.value?.listBindings() ?? [];
            return Object.freeze({
              agents: Object.fromEntries(bindings.map(binding => [binding.name, Object.freeze({
                provider: binding.providerAlias,
                model: binding.model,
                ...(binding.nickname ? { nickname: binding.nickname } : {}),
              })])),
              workrooms: snapshot.definitions,
              revision: snapshot.revision,
              ...(authenticatedPrincipal
                ? { principalId: authenticatedPrincipal.principalId }
                : {}),
            });
          },
          setWorkroomCatalog: async (workrooms, expectedRevision) => {
            const catalog = agentLease?.value?.workroomCatalog;
            if (!catalog) throw new Error('Workroom Catalog Runtime 未就绪');
            const agents = (agentLease?.value?.listBindings() ?? []).map(binding => binding.name);
            const { validateWorkroomDefinitions } = await import('@zhin.js/agent');
            const errors = validateWorkroomDefinitions(
              workrooms,
              agents,
              new Set((im?.listEndpoints() ?? []).map(endpoint => `${endpoint.adapter}:${endpoint.name}`)),
            );
            if (errors.length > 0) throw new Error(`Invalid Workroom Catalog: ${errors.join('; ')}`);
            const snapshot = await catalog.replace(
              recordValue(workrooms) as Record<string, WorkroomDefinition>,
              expectedRevision,
            );
            return Object.freeze({ revision: snapshot.revision, restartRequired: false as const });
          },
          listProjectFiles: () => buildProjectFileTree(projectRoot),
          readProjectFile: filePath => readProjectFile(projectRoot, filePath),
          saveProjectFile: (filePath, content) => saveProjectFile(projectRoot, filePath, content),
          listEnvFiles: () => listEnvFiles(projectRoot),
          readEnvFile: filename => configuration.readEnvironmentFile(filename),
          writeEnvFile: (filename, content) => configuration.writeEnvironmentFile(filename, content),
          getSchema: pluginName => configuration.readSchema(pluginName),
          getAllSchemas: () => configuration.readAllSchemas(),
          listEndpoints: im
            ? async () => im.listEndpoints()
            : undefined,
          getEndpoint: im
            ? async (adapter, endpointKey) => im.getEndpoint(adapter, endpointKey)
            : undefined,
          sendEndpointMessage: im
            ? async input => im.sendEndpointMessage(input)
            : undefined,
          requestRestart: onRestart
            ? () => { onRestart(); }
            : undefined,
          dbInfo: databaseHost
            ? () => ({
              dialect: databaseHost.dialect,
              connected: databaseHost.started,
              tables: databaseHost.tables().length,
            })
            : undefined,
          dbTables: databaseHost
            ? () => databaseHost.tables()
            : undefined,
          database: databaseHost?.console,
          extended: {
            projectRoot,
            scheduleHost,
            withEndpointManagement: im
              ? (adapter, endpointKey, run) => im.withEndpointManagement(adapter, endpointKey, run)
              : undefined,
            databaseHost: databaseHost
              ? { models: databaseHost.models }
              : undefined,
            resolveScheduleEngine: () => {
              const jobs = agentLease?.value?.assistant?.jobs;
              if (!jobs) return null;
              return {
                listJobs: async () => [...await jobs.list()],
                addJob: job => jobs.add(job as Parameters<typeof jobs.add>[0]),
                removeJob: id => jobs.remove(id),
                pauseJob: id => jobs.pause(id),
                resumeJob: id => jobs.resume(id),
              };
            },
            loginAssist: im?.loginAssist,
            authenticatedPrincipal: authenticatedPrincipal
              ? Object.freeze({ principalId: authenticatedPrincipal.principalId })
              : undefined,
            workroomProfileControl: agentLease?.value?.workroomProfiles,
            workroomKnowledgeControl: agentLease?.value?.workroomKnowledge,
          },
          listPluginKeys: () => configuration.listKeys(primaryConfigDocument),
          publishEvent: (type, data) => hub.publish(type, data),
        });
      } finally {
        agentLease?.release();
      }
      const match = pickRpcReply(message, payloads);
      if (!match) {
        writeJson(response, 500, { success: false, error: 'No response' });
        return;
      }
      if (match.error) {
        writeJson(response, 400, {
          success: false,
          error: match.error,
          requestId: match.requestId,
        });
        return;
      }
      writeJson(response, 200, {
        success: true,
        data: match.data,
        type: match.type,
        requestId: match.requestId,
      });
    } catch (error) {
      if (error instanceof HttpBodyError) {
        writeJson(response, error.statusCode, { success: false, error: error.message });
        return;
      }
      writeJson(response, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, {
    summary: 'Console RPC',
    tags: ['console'],
    description: 'Plugin Runtime Console request envelope: `{ type, data?, requestId? }`.',
  });
}

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value as Record<string, unknown> };
}
